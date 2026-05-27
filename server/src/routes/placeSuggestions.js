import { z } from 'zod';
import { requireAuth } from '../auth.js';

const KINDS = ['home', 'school', 'work', 'medical', 'social', 'gym', 'shopping', 'transit', 'other'];

function rowToJson(r) {
    return {
        id: r.id,
        userId: r.user_id,
        lat: r.lat,
        lng: r.lng,
        label: r.label,
        visitCount: r.visit_count,
        totalDwellMs: r.total_dwell_ms,
        firstSeen: r.first_seen,
        lastSeen: r.last_seen,
        status: r.status,
        createdAt: r.created_at,
    };
}

export default async function placeSuggestionRoutes(fastify, { db }) {

    fastify.get('/api/users/me/place-suggestions', { preHandler: requireAuth(db) }, async (req) => {
        const rows = db.prepare(
            `SELECT * FROM place_suggestions WHERE user_id = ? AND status = 'pending' ORDER BY visit_count DESC`
        ).all(req.auth.userId);
        return { suggestions: rows.map(rowToJson) };
    });

    fastify.post('/api/place-suggestions/:id/accept', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
    }, async (req, reply) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' });

        const body = z.object({
            name: z.string().min(1).max(64),
            kind: z.enum(KINDS).optional().default('other'),
            radiusM: z.number().positive().max(50_000).optional().default(100),
        }).safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: 'invalid_body' });

        const sug = db.prepare('SELECT * FROM place_suggestions WHERE id = ? AND user_id = ?').get(id, req.auth.userId);
        if (!sug) return reply.code(404).send({ error: 'not_found' });
        if (sug.status !== 'pending') return reply.code(409).send({ error: 'already_processed' });

        const circleRow = db.prepare(
            'SELECT circle_id FROM circle_members WHERE user_id = ? LIMIT 1'
        ).get(req.auth.userId);
        if (!circleRow) return reply.code(400).send({ error: 'no_circle' });

        const now = Date.now();
        const placeResult = db.prepare(
            `INSERT INTO places (circle_id, name, address, lat, lng, radius_m, alerts_on_enter, alerts_on_exit, kind, created_by, created_at)
             VALUES (?, ?, NULL, ?, ?, ?, 1, 1, ?, ?, ?)`
        ).run(circleRow.circle_id, body.data.name, sug.lat, sug.lng, body.data.radiusM, body.data.kind, req.auth.userId, now);

        db.prepare("UPDATE place_suggestions SET status = 'accepted' WHERE id = ?").run(id);

        return { ok: true, placeId: Number(placeResult.lastInsertRowid) };
    });

    fastify.post('/api/place-suggestions/:id/dismiss', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
    }, async (req, reply) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' });

        const sug = db.prepare('SELECT * FROM place_suggestions WHERE id = ? AND user_id = ?').get(id, req.auth.userId);
        if (!sug) return reply.code(404).send({ error: 'not_found' });
        if (sug.status !== 'pending') return reply.code(409).send({ error: 'already_processed' });

        db.prepare("UPDATE place_suggestions SET status = 'dismissed', dismissed_at = ? WHERE id = ?")
            .run(Date.now(), id);

        return { ok: true };
    });
}
