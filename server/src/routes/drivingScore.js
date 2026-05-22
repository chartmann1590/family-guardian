import { requireAuth } from '../auth.js';
import { computeDrivingScore } from '../drivingScore.js';
import { logView } from '../audit.js';

export default async function drivingScoreRoutes(fastify, { db }) {
    fastify.get('/api/users/:userId/driving-score', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        const targetUserId = Number(req.params.userId);
        if (!Number.isInteger(targetUserId)) return reply.code(400).send({ error: 'invalid_id' });

        const requesterId = req.auth.userId;
        if (targetUserId !== requesterId) {
            const shared = db.prepare(
                `SELECT a.circle_id FROM circle_members a
                 JOIN circle_members b ON a.circle_id = b.circle_id
                 WHERE a.user_id = ? AND b.user_id = ? LIMIT 1`,
            ).get(requesterId, targetUserId);
            if (!shared) return reply.code(403).send({ error: 'not_in_shared_circle' });
        }

        const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
        const sinceMs = Date.now() - days * 86_400_000;
        const result = computeDrivingScore(db, targetUserId, sinceMs);
        logView(db, requesterId, targetUserId, 'driving_score');
        return result;
    });
}
