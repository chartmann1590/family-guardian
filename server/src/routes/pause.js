import { z } from 'zod';
import { requireAuth, getUserCircleId } from '../auth.js';
import { publish } from '../hub.js';

const PauseBody = z.object({
    durationMinutes: z.number().int().min(1).max(1440),
    reason: z.string().max(140).optional(),
});

function readPauseRow(db, userId) {
    const row = db
        .prepare('SELECT paused_until AS pausedUntil, pause_reason AS reason FROM users WHERE id = ?')
        .get(userId);
    if (!row) return { pausedUntil: null, reason: null };
    // Treat expired rows as cleared even if the scheduler hasn't swept yet.
    if (row.pausedUntil && row.pausedUntil < Date.now()) {
        return { pausedUntil: null, reason: null };
    }
    return { pausedUntil: row.pausedUntil ?? null, reason: row.reason ?? null };
}

function broadcastChange(db, userId, pausedUntil, reason) {
    const circleId = getUserCircleId(db, userId);
    if (!circleId) return;
    publish(circleId, {
        type: 'pause_changed',
        userId,
        pausedUntil: pausedUntil ?? null,
        reason: reason ?? null,
    });
}

export default async function pauseRoutes(fastify, { db }) {
    fastify.get('/api/users/me/pause', { preHandler: requireAuth(db) }, async (req) => {
        return readPauseRow(db, req.auth.userId);
    });

    fastify.post('/api/users/me/pause', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
    }, async (req, reply) => {
        const parsed = PauseBody.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
        }
        const { durationMinutes, reason } = parsed.data;
        const pausedUntil = Date.now() + durationMinutes * 60_000;
        const trimmedReason = reason?.trim() || null;

        db.prepare('UPDATE users SET paused_until = ?, pause_reason = ? WHERE id = ?')
            .run(pausedUntil, trimmedReason, req.auth.userId);

        broadcastChange(db, req.auth.userId, pausedUntil, trimmedReason);
        return { pausedUntil, reason: trimmedReason };
    });

    fastify.delete('/api/users/me/pause', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
    }, async (req) => {
        db.prepare('UPDATE users SET paused_until = NULL, pause_reason = NULL WHERE id = ?')
            .run(req.auth.userId);
        broadcastChange(db, req.auth.userId, null, null);
        return { pausedUntil: null, reason: null };
    });
}
