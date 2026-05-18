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
        const recordedAt = parsed.data.recordedAt ?? Date.now();
        const userId = req.auth.userId;

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
            .all(circleId);
        return { members: rows };
    });
}
