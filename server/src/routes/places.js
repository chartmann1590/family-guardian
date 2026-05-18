import { z } from 'zod';
import { requireAuth } from '../auth.js';

const PlaceBody = z.object({
    name: z.string().min(1).max(64),
    address: z.string().max(256).optional(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radiusM: z.number().positive().max(50_000),
    alertsOnEnter: z.boolean().optional().default(true),
    alertsOnExit: z.boolean().optional().default(true),
});

const PlacePatch = PlaceBody.partial();

function assertMember(db, circleId, userId, reply) {
    const row = db
        .prepare('SELECT role FROM circle_members WHERE circle_id = ? AND user_id = ?')
        .get(circleId, userId);
    if (!row) {
        reply.code(403).send({ error: 'not_a_member' });
        return null;
    }
    return row;
}

function rowToPlace(r) {
    return {
        id: r.id,
        circleId: r.circle_id,
        name: r.name,
        address: r.address,
        lat: r.lat,
        lng: r.lng,
        radiusM: r.radius_m,
        alertsOnEnter: !!r.alerts_on_enter,
        alertsOnExit: !!r.alerts_on_exit,
        createdBy: r.created_by,
        createdAt: r.created_at,
    };
}

export default async function placeRoutes(fastify, { db }) {

    fastify.get('/api/circles/:id/places', { preHandler: requireAuth(db) }, async (req, reply) => {
        const circleId = Number(req.params.id);
        if (!Number.isInteger(circleId)) return reply.code(400).send({ error: 'invalid_circle' });
        if (!assertMember(db, circleId, req.auth.userId, reply)) return;
        const rows = db
            .prepare('SELECT * FROM places WHERE circle_id = ? ORDER BY name COLLATE NOCASE ASC')
            .all(circleId);
        return { places: rows.map(rowToPlace) };
    });

    fastify.post('/api/circles/:id/places', { preHandler: requireAuth(db) }, async (req, reply) => {
        const circleId = Number(req.params.id);
        if (!Number.isInteger(circleId)) return reply.code(400).send({ error: 'invalid_circle' });
        if (!assertMember(db, circleId, req.auth.userId, reply)) return;
        const parsed = PlaceBody.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
        }
        const p = parsed.data;
        const result = db
            .prepare(
                `INSERT INTO places
                 (circle_id, name, address, lat, lng, radius_m, alerts_on_enter, alerts_on_exit, created_by, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                circleId,
                p.name,
                p.address ?? null,
                p.lat,
                p.lng,
                p.radiusM,
                p.alertsOnEnter ? 1 : 0,
                p.alertsOnExit ? 1 : 0,
                req.auth.userId,
                Date.now(),
            );
        const row = db.prepare('SELECT * FROM places WHERE id = ?').get(result.lastInsertRowid);
        return rowToPlace(row);
    });

    fastify.patch('/api/places/:id', { preHandler: requireAuth(db) }, async (req, reply) => {
        const placeId = Number(req.params.id);
        if (!Number.isInteger(placeId)) return reply.code(400).send({ error: 'invalid_place' });
        const existing = db.prepare('SELECT * FROM places WHERE id = ?').get(placeId);
        if (!existing) return reply.code(404).send({ error: 'not_found' });
        if (!assertMember(db, existing.circle_id, req.auth.userId, reply)) return;
        const parsed = PlacePatch.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
        const p = parsed.data;
        const merged = {
            name:           p.name           ?? existing.name,
            address:        p.address        ?? existing.address,
            lat:            p.lat            ?? existing.lat,
            lng:            p.lng            ?? existing.lng,
            radius_m:       p.radiusM        ?? existing.radius_m,
            alerts_on_enter: p.alertsOnEnter !== undefined ? (p.alertsOnEnter ? 1 : 0) : existing.alerts_on_enter,
            alerts_on_exit:  p.alertsOnExit  !== undefined ? (p.alertsOnExit  ? 1 : 0) : existing.alerts_on_exit,
        };
        db.prepare(
            `UPDATE places SET
                name = @name, address = @address,
                lat = @lat, lng = @lng, radius_m = @radius_m,
                alerts_on_enter = @alerts_on_enter, alerts_on_exit = @alerts_on_exit
             WHERE id = @id`
        ).run({ ...merged, id: placeId });
        const row = db.prepare('SELECT * FROM places WHERE id = ?').get(placeId);
        return rowToPlace(row);
    });

    fastify.delete('/api/places/:id', { preHandler: requireAuth(db) }, async (req, reply) => {
        const placeId = Number(req.params.id);
        if (!Number.isInteger(placeId)) return reply.code(400).send({ error: 'invalid_place' });
        const existing = db.prepare('SELECT * FROM places WHERE id = ?').get(placeId);
        if (!existing) return reply.code(404).send({ error: 'not_found' });
        if (!assertMember(db, existing.circle_id, req.auth.userId, reply)) return;
        db.prepare('DELETE FROM places WHERE id = ?').run(placeId);
        return { ok: true };
    });
}
