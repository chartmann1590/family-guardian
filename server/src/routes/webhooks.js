import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { createHmac } from 'node:crypto';

const WebhookBody = z.object({
    url: z.string().url(),
    events: z.string().min(1),
    active: z.boolean().optional().default(true),
});

function rowToJson(r) {
    return {
        id: r.id,
        circleId: r.circle_id,
        url: r.url,
        events: r.events,
        active: !!r.active,
        createdAt: r.created_at,
        lastDispatchedAt: r.last_dispatched_at,
        lastError: r.last_error,
    };
}

function assertAdmin(db, circleId, userId, reply) {
    const row = db.prepare(
        'SELECT role FROM circle_members WHERE circle_id = ? AND user_id = ?'
    ).get(circleId, userId);
    if (!row) { reply.code(403).send({ error: 'not_a_member' }); return false; }
    if (row.role !== 'admin') { reply.code(403).send({ error: 'admin_only' }); return false; }
    return true;
}

export default async function webhookRoutes(fastify, { db }) {

    fastify.get('/api/circles/:id/webhooks', { preHandler: requireAuth(db) }, async (req, reply) => {
        const circleId = Number(req.params.id);
        if (!assertAdmin(db, circleId, req.auth.userId, reply)) return;
        const rows = db.prepare('SELECT * FROM webhooks WHERE circle_id = ? ORDER BY created_at DESC').all(circleId);
        return { webhooks: rows.map(rowToJson) };
    });

    fastify.post('/api/circles/:id/webhooks', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    }, async (req, reply) => {
        const circleId = Number(req.params.id);
        if (!assertAdmin(db, circleId, req.auth.userId, reply)) return;
        const parsed = WebhookBody.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

        const secret = createHmac('sha256', 'seed').digest('hex');
        const now = Date.now();
        const result = db.prepare(
            'INSERT INTO webhooks (circle_id, url, secret, events, active, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(circleId, parsed.data.url, secret, parsed.data.events, parsed.data.active ? 1 : 0, now);

        const row = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(result.lastInsertRowid);
        return rowToJson(row);
    });

    fastify.patch('/api/webhooks/:id', {
        preHandler: requireAuth(db),
    }, async (req, reply) => {
        const id = Number(req.params.id);
        const existing = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id);
        if (!existing) return reply.code(404).send({ error: 'not_found' });
        if (!assertAdmin(db, existing.circle_id, req.auth.userId, reply)) return;

        const patch = z.object({
            url: z.string().url().optional(),
            events: z.string().min(1).optional(),
            active: z.boolean().optional(),
        }).safeParse(req.body);
        if (!patch.success) return reply.code(400).send({ error: 'invalid_body' });

        const merged = {
            url: patch.data.url ?? existing.url,
            events: patch.data.events ?? existing.events,
            active: patch.data.active !== undefined ? (patch.data.active ? 1 : 0) : existing.active,
        };
        db.prepare('UPDATE webhooks SET url = ?, events = ?, active = ? WHERE id = ?')
            .run(merged.url, merged.events, merged.active, id);

        const row = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id);
        return rowToJson(row);
    });

    fastify.delete('/api/webhooks/:id', { preHandler: requireAuth(db) }, async (req, reply) => {
        const id = Number(req.params.id);
        const existing = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id);
        if (!existing) return reply.code(404).send({ error: 'not_found' });
        if (!assertAdmin(db, existing.circle_id, req.auth.userId, reply)) return;
        db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
        return { ok: true };
    });

    fastify.post('/api/webhooks/:id/test', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    }, async (req, reply) => {
        const id = Number(req.params.id);
        const existing = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id);
        if (!existing) return reply.code(404).send({ error: 'not_found' });
        if (!assertAdmin(db, existing.circle_id, req.auth.userId, reply)) return;

        const payload = JSON.stringify({ type: 'webhook_test', sentAt: Date.now() });
        const signature = createHmac('sha256', existing.secret).update(payload).digest('hex');

        try {
            const testRes = await fetch(existing.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-FG-Signature': `sha256=${signature}`,
                    'X-FG-Event': 'webhook_test',
                },
                body: payload,
            });
            return { ok: true, status: testRes.status };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    });
}
