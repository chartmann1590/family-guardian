import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { isWebPushDisabled, getPublicKey } from '../webPush.js';

const SubBody = z.object({
    endpoint: z.string().url(),
    keys: z.object({
        p256dh: z.string().min(1),
        auth: z.string().min(1),
    }),
});

export default async function webPushRoutes(fastify, { db }) {

    fastify.get('/api/web-push/public-key', async (req, reply) => {
        const key = getPublicKey();
        if (!key) return reply.code(503).send({ error: 'web_push_disabled' });
        return { publicKey: key };
    });

    fastify.post('/api/web-push/subscriptions', { preHandler: requireAuth(db) }, async (req, reply) => {
        if (isWebPushDisabled()) return reply.code(503).send({ error: 'web_push_disabled' });
        const parsed = SubBody.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

        const { endpoint, keys } = parsed.data;
        const now = Date.now();
        const ua = req.headers['user-agent'] ?? null;

        db.prepare(`
            INSERT INTO web_push_subscriptions (user_id, endpoint, p256dh, auth, ua, created_at, last_seen_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(endpoint) DO UPDATE SET
                p256dh = excluded.p256dh,
                auth = excluded.auth,
                ua = excluded.ua,
                last_seen_at = excluded.last_seen_at
        `).run(req.auth.userId, endpoint, keys.p256dh, keys.auth, ua, now, now);

        return { ok: true };
    });

    fastify.delete('/api/web-push/subscriptions', { preHandler: requireAuth(db) }, async (req, reply) => {
        const body = z.object({ endpoint: z.string() }).safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: 'invalid_body' });

        db.prepare('DELETE FROM web_push_subscriptions WHERE endpoint = ? AND user_id = ?')
            .run(body.data.endpoint, req.auth.userId);

        return { ok: true };
    });
}
