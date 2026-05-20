import { z } from 'zod';
import { requireAuth, getUserCircleId, verifyPassword } from '../auth.js';
import { publish } from '../hub.js';

const DeleteBody = z.object({
    password: z.string().min(1),
});

export default async function accountRoutes(fastify, { db }) {
    const exportTables = [
        {
            key: 'locationsHistory',
            sql: `SELECT id, lat, lng, accuracy_m, speed_mps, battery_pct, recorded_at,
                         bearing, altitude_m, activity, activity_confidence
                  FROM locations_history WHERE user_id = ? ORDER BY recorded_at ASC`,
        },
        {
            key: 'visits',
            sql: `SELECT id, place_id, lat, lng, label, started_at, ended_at, point_count
                  FROM visits WHERE user_id = ? ORDER BY started_at ASC`,
        },
        {
            key: 'trips',
            sql: `SELECT id, started_at, ended_at, mode, distance_m,
                         max_speed_mps, avg_speed_mps,
                         start_lat, start_lng, end_lat, end_lng,
                         start_label, end_label
                  FROM trips WHERE user_id = ? ORDER BY started_at ASC`,
        },
        {
            key: 'messages',
            sql: `SELECT id, circle_id, body, created_at
                  FROM messages WHERE user_id = ? ORDER BY created_at ASC`,
        },
        {
            key: 'checkins',
            sql: `SELECT id, status, lat, lng, note, created_at
                  FROM check_ins WHERE user_id = ? ORDER BY created_at ASC`,
        },
        {
            key: 'sosEvents',
            sql: `SELECT id, circle_id, started_at, resolved_at, resolved_by,
                         lat, lng, accuracy_m, note, status
                  FROM sos_events WHERE user_id = ? ORDER BY started_at ASC`,
        },
        {
            key: 'alertEvents',
            sql: `SELECT id, circle_id, type, value, created_at
                  FROM alert_events WHERE user_id = ? ORDER BY created_at ASC`,
        },
        {
            key: 'viewAudits',
            sql: `SELECT id, viewer_id, resource, created_at
                  FROM view_audits WHERE subject_id = ? ORDER BY created_at ASC`,
        },
    ];

    fastify.get('/api/users/me/export', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 1, timeWindow: '24 hours' } },
    }, async (req, reply) => {
        const userId = req.auth.userId;
        const userRow = db
            .prepare('SELECT id, email, display_name, created_at, photo_path FROM users WHERE id = ?')
            .get(userId);
        const circleId = getUserCircleId(db, userId);
        const circleRow = circleId
            ? db.prepare('SELECT id, name FROM circles WHERE id = ?').get(circleId)
            : null;

        const now = new Date();
        const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
        const filename = `family-guardian-export-${userId}-${ymd}.json`;

        const payload = {
            exportedAt: Date.now(),
            user: {
                userId: userRow.id,
                email: userRow.email,
                displayName: userRow.display_name,
                createdAt: userRow.created_at,
                hasPhoto: !!userRow.photo_path,
            },
            circle: circleRow ? { id: circleRow.id, name: circleRow.name } : null,
        };

        for (const { key, sql } of exportTables) {
            payload[key] = db.prepare(sql).all(userId);
        }

        const places = circleId
            ? db.prepare(
                `SELECT id, name, address, lat, lng, radius_m, alerts_on_enter, alerts_on_exit, created_at
                 FROM places WHERE circle_id = ? ORDER BY created_at ASC`,
            ).all(circleId)
            : [];
        payload.places = places;

        reply.header('content-type', 'application/json');
        reply.header('content-disposition', `attachment; filename="${filename}"`);
        return reply.send(JSON.stringify(payload, null, 2));
    });

    fastify.delete('/api/users/me', { preHandler: requireAuth(db) }, async (req, reply) => {
        const parsed = DeleteBody.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
        }

        const userId = req.auth.userId;
        const userRow = db
            .prepare('SELECT password_hash FROM users WHERE id = ?')
            .get(userId);
        if (!userRow) return reply.code(404).send({ error: 'user_not_found' });

        const valid = await verifyPassword(userRow.password_hash, parsed.data.password);
        if (!valid) return reply.code(401).send({ error: 'wrong_password' });

        const membership = db
            .prepare('SELECT circle_id, role FROM circle_members WHERE user_id = ? LIMIT 1')
            .get(userId);
        if (membership?.role === 'admin') {
            const otherAdmins = db
                .prepare(
                    `SELECT COUNT(*) AS n FROM circle_members
                     WHERE circle_id = ? AND user_id != ? AND role = 'admin'`,
                )
                .get(membership.circle_id, userId).n;
            const otherMembers = db
                .prepare(
                    `SELECT COUNT(*) AS n FROM circle_members
                     WHERE circle_id = ? AND user_id != ?`,
                )
                .get(membership.circle_id, userId).n;
            if (otherMembers > 0 && otherAdmins === 0) {
                return reply.code(409).send({ error: 'requires_admin_handoff' });
            }
        }

        const circleId = membership?.circle_id;

        db.prepare('DELETE FROM locations WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM view_audits WHERE viewer_id = ?').run(userId);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);

        if (circleId) {
            publish(circleId, { type: 'member_removed', userId });
        }

        return reply.code(204).send();
    });

    fastify.post('/api/circles/:id/admins/:userId', { preHandler: requireAuth(db) }, async (req, reply) => {
        const circleId = Number(req.params.id);
        const targetUserId = Number(req.params.userId);
        if (!Number.isInteger(circleId) || !Number.isInteger(targetUserId)) {
            return reply.code(400).send({ error: 'invalid_params' });
        }

        const callerMembership = db
            .prepare('SELECT role FROM circle_members WHERE circle_id = ? AND user_id = ?')
            .get(circleId, req.auth.userId);
        if (callerMembership?.role !== 'admin') {
            return reply.code(403).send({ error: 'not_admin' });
        }

        const targetMembership = db
            .prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?')
            .get(circleId, targetUserId);
        if (!targetMembership) {
            return reply.code(404).send({ error: 'user_not_in_circle' });
        }

        db.prepare("UPDATE circle_members SET role = 'admin' WHERE circle_id = ? AND user_id = ?")
            .run(circleId, targetUserId);

        db.prepare('UPDATE circles SET owner_id = ? WHERE id = ?')
            .run(targetUserId, circleId);

        publish(circleId, { type: 'admin_changed', userId: targetUserId, role: 'admin' });

        return { ok: true };
    });
}
