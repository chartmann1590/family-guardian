import { z } from 'zod';
import { requireAuth, getUserCircleId } from '../auth.js';
import { publish } from '../hub.js';
import { reconcileGeofences } from '../geofence.js';

const LocationBody = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracyM: z.number().nonnegative().optional(),
    speedMps: z.number().nonnegative().optional(),
    batteryPct: z.number().int().min(0).max(100).optional(),
    recordedAt: z.number().int().positive().optional(),
});

export default async function locationRoutes(fastify, { db }) {
    fastify.post('/api/locations', { preHandler: requireAuth(db) }, async (req, reply) => {
        const parsed = LocationBody.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
        }
        const { lat, lng, accuracyM, speedMps, batteryPct } = parsed.data;
        // Clamp client-supplied recordedAt to "now" so a misconfigured clock
        // can't poison the history with future timestamps.
        const recordedAt = Math.min(parsed.data.recordedAt ?? Date.now(), Date.now());
        const userId = req.auth.userId;

        const writeLocation = db.transaction(() => {
            db.prepare(
                `INSERT INTO locations (user_id, lat, lng, accuracy_m, speed_mps, battery_pct, recorded_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(user_id) DO UPDATE SET
                    lat = excluded.lat,
                    lng = excluded.lng,
                    accuracy_m = excluded.accuracy_m,
                    speed_mps = excluded.speed_mps,
                    battery_pct = excluded.battery_pct,
                    recorded_at = excluded.recorded_at`
            ).run(userId, lat, lng, accuracyM ?? null, speedMps ?? null, batteryPct ?? null, recordedAt);

            db.prepare(
                `INSERT INTO locations_history (user_id, lat, lng, accuracy_m, speed_mps, battery_pct, recorded_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).run(userId, lat, lng, accuracyM ?? null, speedMps ?? null, batteryPct ?? null, recordedAt);
        });
        writeLocation();

        const circleId = getUserCircleId(db, userId);
        if (circleId) {
            publish(circleId, {
                type: 'location_update',
                userId,
                displayName: req.auth.displayName,
                lat,
                lng,
                accuracyM: accuracyM ?? null,
                speedMps: speedMps ?? null,
                batteryPct: batteryPct ?? null,
                recordedAt,
            });
            reconcileGeofences(db, {
                userId,
                circleId,
                displayName: req.auth.displayName,
                lat,
                lng,
                recordedAt,
            });
        }
        return { ok: true };
    });

    fastify.get('/api/circles/:id/members', { preHandler: requireAuth(db) }, async (req, reply) => {
        const circleId = Number(req.params.id);
        if (!Number.isInteger(circleId)) return reply.code(400).send({ error: 'invalid_circle' });
        const membership = db
            .prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?')
            .get(circleId, req.auth.userId);
        if (!membership) return reply.code(403).send({ error: 'not_a_member' });

        const rows = db
            .prepare(
                `SELECT u.id AS userId, u.display_name AS displayName, u.email,
                        u.photo_path AS photoPath,
                        cm.role AS role,
                        l.lat AS lat, l.lng AS lng,
                        l.accuracy_m AS accuracyM,
                        l.speed_mps AS speedMps,
                        l.battery_pct AS batteryPct,
                        l.recorded_at AS recordedAt
                 FROM circle_members cm
                 JOIN users u ON u.id = cm.user_id
                 LEFT JOIN locations l ON l.user_id = u.id
                 WHERE cm.circle_id = ?
                 ORDER BY cm.role DESC, u.display_name COLLATE NOCASE ASC`
            )
            .all(circleId)
            .map(({ photoPath, ...m }) => ({
                ...m,
                photoUrl: photoPath ? `/api/users/${m.userId}/photo` : null,
            }));
        return { members: rows };
    });

    fastify.get('/api/circles/:circleId/members/:userId/history', { preHandler: requireAuth(db) }, async (req, reply) => {
        const circleId = Number(req.params.circleId);
        const targetUserId = Number(req.params.userId);
        if (!Number.isInteger(circleId) || !Number.isInteger(targetUserId)) {
            return reply.code(400).send({ error: 'invalid_params' });
        }

        const membership = db
            .prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?')
            .get(circleId, req.auth.userId);
        if (!membership) return reply.code(403).send({ error: 'not_a_member' });

        const targetMembership = db
            .prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?')
            .get(circleId, targetUserId);
        if (!targetMembership) return reply.code(404).send({ error: 'user_not_in_circle' });

        const from = Number(req.query.from) || 0;
        const to = Number(req.query.to) || Date.now() + 1;
        const limit = Math.min(Number(req.query.limit) || 500, 5000);

        const rows = db.prepare(
            `SELECT id, lat, lng, accuracy_m AS accuracyM, speed_mps AS speedMps,
                    battery_pct AS batteryPct, recorded_at AS recordedAt
             FROM locations_history
             WHERE user_id = ? AND recorded_at >= ? AND recorded_at <= ?
             ORDER BY recorded_at ASC
             LIMIT ?`
        ).all(targetUserId, from, to, limit);

        return { points: rows };
    });
}
