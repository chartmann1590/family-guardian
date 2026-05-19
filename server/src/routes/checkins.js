import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { publish } from '../hub.js';

const CheckinBody = z.object({
    status: z.enum(['safe_home', 'out_safe', 'heading_home']),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    note: z.string().max(500).optional(),
});

function rowToJson(r) {
    return {
        id: r.id,
        userId: r.user_id,
        circleId: r.circle_id,
        displayName: r.display_name,
        status: r.status,
        lat: r.lat,
        lng: r.lng,
        note: r.note,
        createdAt: r.created_at,
    };
}

function assertMember(db, circleId, userId, reply) {
    const m = db
        .prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?')
        .get(circleId, userId);
    if (!m) { reply.code(403).send({ error: 'not_a_member' }); return false; }
    return true;
}

export default async function checkinRoutes(fastify, { db }) {

    fastify.post('/api/checkins', { preHandler: requireAuth(db) }, async (req, reply) => {
        const parsed = CheckinBody.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });

        const circleRow = db
            .prepare(
                `SELECT cm.circle_id FROM circle_members cm WHERE cm.user_id = ? LIMIT 1`
            )
            .get(req.auth.userId);
        if (!circleRow) return reply.code(403).send({ error: 'no_circle' });

        const now = Date.now();
        const result = db.prepare(
            `INSERT INTO check_ins (user_id, circle_id, status, lat, lng, note, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(req.auth.userId, circleRow.circle_id, parsed.data.status, parsed.data.lat ?? null, parsed.data.lng ?? null, parsed.data.note ?? null, now);

        const row = db.prepare(
            `SELECT c.*, u.display_name FROM check_ins c
             JOIN users u ON u.id = c.user_id WHERE c.id = ?`
        ).get(result.lastInsertRowid);

        const event = rowToJson(row);
        publish(circleRow.circle_id, { type: 'check_in', ...event });
        return event;
    });

    fastify.get('/api/circles/:id/checkins', { preHandler: requireAuth(db) }, async (req, reply) => {
        const circleId = Number(req.params.id);
        if (!Number.isInteger(circleId)) return reply.code(400).send({ error: 'invalid_circle' });
        if (!assertMember(db, circleId, req.auth.userId, reply)) return;

        const limit = Math.min(Number(req.query.limit) || 50, 500);
        const rows = db.prepare(
            `SELECT c.*, u.display_name FROM check_ins c
             JOIN users u ON u.id = c.user_id
             WHERE c.circle_id = ?
             ORDER BY c.created_at DESC LIMIT ?`
        ).all(circleId, limit);

        return { checkins: rows.map(rowToJson) };
    });
}
