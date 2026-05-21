import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { publish } from '../hub.js';
import { fanOut } from '../fcm.js';

const PostBody = z.object({
    body: z.string().min(1).max(2_000),
});

const ALLOWED_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function rowToMsg(r) {
    return {
        id: r.id,
        circleId: r.circle_id,
        userId: r.user_id,
        displayName: r.display_name,
        body: r.body,
        createdAt: r.created_at,
        reactions: [],
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

        const messages = rows.map(rowToMsg).reverse();

        const ids = messages.map((m) => m.id);
        if (ids.length > 0) {
            const placeholders = ids.map(() => '?').join(',');
            const rxRows = db.prepare(
                `SELECT message_id, user_id, emoji FROM message_reactions
                 WHERE message_id IN (${placeholders})`
            ).all(...ids);
            const grouped = new Map();
            for (const rx of rxRows) {
                const key = `${rx.message_id}:${rx.emoji}`;
                if (!grouped.has(key)) grouped.set(key, { emoji: rx.emoji, messageId: rx.message_id, userIds: [] });
                grouped.get(key).userIds.push(rx.user_id);
            }
            for (const g of grouped.values()) {
                const msg = messages.find((m) => m.id === g.messageId);
                if (msg) msg.reactions.push({ emoji: g.emoji, userIds: g.userIds });
            }
        }

        return { messages };
    });

    fastify.post('/api/messages/:id/reactions', { preHandler: requireAuth(db) }, async (req, reply) => {
        const messageId = Number(req.params.id);
        if (!Number.isInteger(messageId)) return reply.code(400).send({ error: 'invalid_message' });

        const msg = db.prepare('SELECT circle_id FROM messages WHERE id = ?').get(messageId);
        if (!msg) return reply.code(404).send({ error: 'not_found' });
        if (!assertMember(db, msg.circle_id, req.auth.userId, reply)) return;

        const emoji = req.body?.emoji;
        if (typeof emoji !== 'string' || !ALLOWED_EMOJIS.includes(emoji)) {
            return reply.code(400).send({ error: 'invalid_emoji', allowed: ALLOWED_EMOJIS });
        }

        db.prepare(
            'INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)'
        ).run(messageId, req.auth.userId, emoji, Date.now());

        publish(msg.circle_id, { type: 'reaction_added', messageId, userId: req.auth.userId, emoji });
        return reply.code(204).send();
    });

    fastify.delete('/api/messages/:id/reactions/:emoji', { preHandler: requireAuth(db) }, async (req, reply) => {
        const messageId = Number(req.params.id);
        if (!Number.isInteger(messageId)) return reply.code(400).send({ error: 'invalid_message' });
        const emoji = decodeURIComponent(req.params.emoji);

        const msg = db.prepare('SELECT circle_id FROM messages WHERE id = ?').get(messageId);
        if (!msg) return reply.code(404).send({ error: 'not_found' });

        db.prepare(
            'DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
        ).run(messageId, req.auth.userId, emoji);

        publish(msg.circle_id, { type: 'reaction_removed', messageId, userId: req.auth.userId, emoji });
        return reply.code(204).send();
    });
}
