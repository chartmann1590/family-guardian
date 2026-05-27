import { z } from 'zod';
import { requireAuth } from '../auth.js';

const KINDS = ['home', 'school', 'work', 'medical', 'social', 'gym', 'shopping', 'transit', 'other'];

const PlaceBody = z.object({
    name: z.string().min(1).max(64),
    address: z.string().max(256).optional(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radiusM: z.number().positive().max(50_000),
    alertsOnEnter: z.boolean().optional().default(true),
    alertsOnExit: z.boolean().optional().default(true),
    kind: z.enum(KINDS).optional().default('other'),
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
        kind: r.kind || 'other',
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
                 (circle_id, name, address, lat, lng, radius_m, alerts_on_enter, alerts_on_exit, kind, created_by, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
                p.kind,
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
            kind:           p.kind           ?? existing.kind,
        };
        db.prepare(
            `UPDATE places SET
                name = @name, address = @address,
                lat = @lat, lng = @lng, radius_m = @radius_m,
                alerts_on_enter = @alerts_on_enter, alerts_on_exit = @alerts_on_exit,
                kind = @kind
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

    fastify.get('/api/places/:id/analytics', { preHandler: requireAuth(db) }, async (req, reply) => {
        const placeId = Number(req.params.id);
        if (!Number.isInteger(placeId)) return reply.code(400).send({ error: 'invalid_place' });
        const place = db.prepare('SELECT * FROM places WHERE id = ?').get(placeId);
        if (!place) return reply.code(404).send({ error: 'not_found' });
        if (!assertMember(db, place.circle_id, req.auth.userId, reply)) return;

        let days = parseInt(req.query.days, 10);
        if (isNaN(days)) days = 30;
        days = Math.max(1, Math.min(90, days));
        const sinceMs = Date.now() - days * 86400000;

        const rows = db.prepare(`
            SELECT v.user_id AS userId, u.display_name AS displayName,
                   COUNT(*) AS visitCount,
                   SUM(CASE WHEN v.ended_at IS NOT NULL THEN v.ended_at - v.started_at ELSE 0 END) AS totalDwellMs,
                   MAX(v.started_at) AS lastVisitAt,
                   AVG(CASE WHEN v.ended_at IS NOT NULL THEN v.ended_at - v.started_at ELSE NULL END) AS avgDwellMs,
                   MAX(CASE WHEN v.ended_at IS NOT NULL THEN v.ended_at - v.started_at ELSE 0 END) AS longestDwellMs
            FROM visits v
            JOIN users u ON u.id = v.user_id
            WHERE v.place_id = ? AND v.started_at >= ?
            GROUP BY v.user_id
        `).all(placeId, sinceMs);

        const now = Date.now();
        const lastWeekStart = now - 7 * 86400000;
        const prevWeekStart = now - 14 * 86400000;
        const lastWeekCount = db.prepare('SELECT COUNT(*) AS c FROM visits WHERE place_id = ? AND started_at >= ?').get(placeId, lastWeekStart).c;
        const prevWeekCount = db.prepare('SELECT COUNT(*) AS c FROM visits WHERE place_id = ? AND started_at >= ? AND started_at < ?').get(placeId, prevWeekStart, lastWeekStart).c;
        const deltaPct = prevWeekCount > 0 ? Math.round((lastWeekCount - prevWeekCount) / prevWeekCount * 1000) / 10 : 0;

        const perMember = rows.map((r) => ({
            userId: r.userId,
            displayName: r.displayName,
            visitCount: r.visitCount,
            totalDwellMs: r.totalDwellMs,
            lastVisitAt: r.lastVisitAt,
            avgDwellMs: r.avgDwellMs,
            longestDwellMs: r.longestDwellMs,
        }));

        return {
            placeId,
            placeName: place.name,
            days,
            perMember,
            weekOverWeek: { lastWeekCount, prevWeekCount, deltaPct },
        };
    });
}
