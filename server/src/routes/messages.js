import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { publish } from '../hub.js';
import { fanOut } from '../fcm.js';

const PostBody = z.object({
    body: z.string().min(1).max(2_000),
});

function rowToMsg(r) {
    return {
        id: r.id,
        circleId: r.circle_id,
        userId: r.user_id,
        displayName: r.display_name,
        body: r.body,
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

export default async function messageRoutes(fastify, { db }) {

    fastify.post('/api/circles/:id/messages', { preHandler: requireAuth(db) }, async (req, reply) => {
        const circleId = Number(req.params.id);
        if (!Number.isInteger(circleId)) return reply.code(400).send({ error: 'invalid_circle' });
        if (!assertMember(db, circleId, req.auth.userId, reply)) return;

        const parsed = PostBody.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

        const now = Date.now();
        const result = db.prepare(
            'INSERT INTO messages (circle_id, user_id, body, created_at) VALUES (?, ?, ?, ?)'
        ).run(circleId, req.auth.userId, parsed.data.body.trim(), now);

        const row = db.prepare(
            `SELECT m.*, u.display_name FROM messages m
             JOIN users u ON u.id = m.user_id WHERE m.id = ?`
        ).get(result.lastInsertRowid);

        const msg = rowToMsg(row);
        publish(circleId, { type: 'chat_message', ...msg });
        fanOut(circleId, { type: 'chat_message', ...msg }, db, req.auth.userId);
        return msg;
    });

    fastify.get('/api/circles/:id/messages', { preHandler: requireAuth(db) }, async (req, reply) => {
        const circleId = Number(req.params.id);
        if (!Number.isInteger(circleId)) return reply.code(400).send({ error: 'invalid_circle' });
        if (!assertMember(db, circleId, req.auth.userId, reply)) return;

        const before = Number(req.query.before) || Date.now() + 1;
        const limit = Math.min(Number(req.query.limit) || 50, 200);

        const rows = db.prepare(
            `SELECT m.*, u.display_name FROM messages m
             JOIN users u ON u.id = m.user_id
             WHERE m.circle_id = ? AND m.created_at < ?
             ORDER BY m.created_at DESC LIMIT ?`
        ).all(circleId, before, limit);

        // Return ASC (oldest first) for convenient append on the client.
        return { messages: rows.map(rowToMsg).reverse() };
    });
}
