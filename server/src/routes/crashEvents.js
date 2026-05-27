import { z } from 'zod';
import { requireAuth, getUserCircleId } from '../auth.js';
import { publish } from '../hub.js';
import { fanOut } from '../fcm.js';
import { fanOut as webPushFanOut } from '../webPush.js';
import { dispatchWebhook } from '../webhooks.js';

const CrashReportBody = z.object({
    peakAccelMps2: z.number().min(5),
    sustainedMs: z.number().int().min(1).max(5000),
    peakAxisX: z.number().optional(),
    peakAxisY: z.number().optional(),
    peakAxisZ: z.number().optional(),
    speedMps: z.number().nonnegative().optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    accuracyM: z.number().nonnegative().optional(),
    activity: z.string().max(32).optional(),
    platform: z.enum(['android', 'ios']),
    note: z.string().max(200).optional(),
});

export default async function crashEventRoutes(fastify, { db }) {
    fastify.post('/api/crash-events', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        const parsed = CrashReportBody.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
        }

        const userId = req.auth.userId;
        const enabled = db.prepare('SELECT crash_detection_enabled FROM users WHERE id = ?').get(userId);
        if (!enabled || !enabled.crash_detection_enabled) {
            return reply.code(403).send({ error: 'crash_detection_disabled' });
        }

        const circleId = getUserCircleId(db, userId);
        if (!circleId) return reply.code(400).send({ error: 'no_circle' });

        const b = parsed.data;
        const now = Date.now();
        const r = db.prepare(
            `INSERT INTO crash_events
             (user_id, circle_id, detected_at, peak_accel_mps2, sustained_ms,
              peak_axis_x, peak_axis_y, peak_axis_z, speed_mps,
              lat, lng, accuracy_m, activity, platform, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            userId, circleId, now, b.peakAccelMps2, b.sustainedMs,
            b.peakAxisX ?? null, b.peakAxisY ?? null, b.peakAxisZ ?? null,
            b.speedMps ?? null, b.lat ?? null, b.lng ?? null,
            b.accuracyM ?? null, b.activity ?? null, b.platform,
            b.note ?? null,
        );
        const id = Number(r.lastInsertRowid);

        const displayName = req.auth.displayName;
        const ev = {
            type: 'crash_pending',
            userId,
            displayName,
            crashEventId: id,
            detectedAt: now,
        };
        publish(circleId, ev);
        fanOut(circleId, ev, db, userId);
        webPushFanOut(circleId, ev, db, userId);
        dispatchWebhook(circleId, ev);

        return { id, detectedAt: now };
    });

    fastify.post('/api/crash-events/:id/dismiss', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        const crashId = Number(req.params.id);
        if (!Number.isInteger(crashId)) return reply.code(400).send({ error: 'invalid_id' });

        const row = db.prepare('SELECT * FROM crash_events WHERE id = ?').get(crashId);
        if (!row) return reply.code(404).send({ error: 'not_found' });
        if (row.user_id !== req.auth.userId) return reply.code(403).send({ error: 'not_owner' });
        if (row.sos_event_id != null) return reply.code(409).send({ error: 'already_escalated' });

        db.prepare('UPDATE crash_events SET dismissed_at = ? WHERE id = ?').run(Date.now(), crashId);
        return reply.code(204).send();
    });
}
