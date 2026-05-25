import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { setSnooze, clearSnooze, listSnoozes } from '../lib/snooze.js';

const SnoozeBody = z.object({
    alertType: z.string(),
    durationMinutes: z.number().int().min(1).max(10080),
});

const PrefsPatch = z.object({
    speedingEnabled: z.boolean().optional(),
    speedingThresholdMps: z.number().nonnegative().max(200).optional(),
    lowBatteryEnabled: z.boolean().optional(),
    lowBatteryThreshold: z.number().int().min(1).max(99).optional(),
    offlineEnabled: z.boolean().optional(),
    offlineMinutes: z.number().int().min(5).max(1440).optional(),
    curfewEnabled: z.boolean().optional(),
    curfewStart: z.number().int().min(0).max(1439).optional(),
    curfewEnd: z.number().int().min(0).max(1439).optional(),
    curfewHomePlaceId: z.number().int().nullable().optional(),
    lowBatteryAlerts: z.boolean().optional(),
    lowBatteryThresholdPct: z.number().int().min(5).max(50).optional(),
    digestDayOfWeek: z.number().int().min(0).max(6).optional(),
    digestHourLocal: z.number().int().min(0).max(23).optional(),
    digestTimezone: z.string().max(64).optional(),
});

function rowToJson(r) {
    return {
        userId: r.user_id,
        speedingEnabled: !!r.speeding_enabled,
        speedingThresholdMps: r.speeding_threshold_mps,
        lowBatteryEnabled: !!r.low_battery_enabled,
        lowBatteryThreshold: r.low_battery_threshold,
        offlineEnabled: !!r.offline_enabled,
        offlineMinutes: r.offline_minutes,
        routinesEnabled: !!(r.routines_enabled ?? 1),
        routinesQuietStart: r.routines_quiet_start ?? null,
        routinesQuietEnd: r.routines_quiet_end ?? null,
        curfewEnabled: !!r.curfew_enabled,
        curfewStart: r.curfew_start ?? null,
        curfewEnd: r.curfew_end ?? null,
        curfewHomePlaceId: r.curfew_home_place_id ?? null,
        lowBatteryAlerts: !!r.low_battery_alerts,
        lowBatteryThresholdPct: r.low_battery_threshold ?? 15,
        digestDayOfWeek: r.digest_day_of_week ?? 0,
        digestHourLocal: r.digest_hour_local ?? 18,
        digestTimezone: r.digest_timezone ?? 'Etc/UTC',
    };
}

function ensurePrefs(db, userId) {
    let prefs = db.prepare('SELECT * FROM alert_prefs WHERE user_id = ?').get(userId);
    if (!prefs) {
        db.prepare('INSERT INTO alert_prefs (user_id) VALUES (?)').run(userId);
        prefs = db.prepare('SELECT * FROM alert_prefs WHERE user_id = ?').get(userId);
    }
    return prefs;
}

function assertMember(db, circleId, userId, reply) {
    const m = db
        .prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?')
        .get(circleId, userId);
    if (!m) { reply.code(403).send({ error: 'not_a_member' }); return false; }
    return true;
}

export default async function alertPrefsRoutes(fastify, { db }) {
    fastify.get('/api/users/me/alert-prefs', { preHandler: requireAuth(db) }, async (req) => {
        const prefs = ensurePrefs(db, req.auth.userId);
        return rowToJson(prefs);
    });

    fastify.patch('/api/users/me/alert-prefs', { preHandler: requireAuth(db) }, async (req, reply) => {
        const parsed = PrefsPatch.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
        ensurePrefs(db, req.auth.userId);
        const fieldMap = {
            speedingEnabled: 'speeding_enabled',
            speedingThresholdMps: 'speeding_threshold_mps',
            lowBatteryEnabled: 'low_battery_enabled',
            lowBatteryThreshold: 'low_battery_threshold',
            offlineEnabled: 'offline_enabled',
            offlineMinutes: 'offline_minutes',
            curfewEnabled: 'curfew_enabled',
            curfewStart: 'curfew_start',
            curfewEnd: 'curfew_end',
            curfewHomePlaceId: 'curfew_home_place_id',
            lowBatteryAlerts: 'low_battery_alerts',
            lowBatteryThresholdPct: 'low_battery_threshold',
            digestDayOfWeek: 'digest_day_of_week',
            digestHourLocal: 'digest_hour_local',
            digestTimezone: 'digest_timezone',
        };
        const updates = [];
        const params = [];
        for (const [k, col] of Object.entries(fieldMap)) {
            if (parsed.data[k] === undefined) continue;
            let v = parsed.data[k];
            if (typeof v === 'boolean') v = v ? 1 : 0;
            updates.push(`${col} = ?`);
            params.push(v);
        }
        if (updates.length) {
            params.push(req.auth.userId);
            db.prepare(`UPDATE alert_prefs SET ${updates.join(', ')} WHERE user_id = ?`).run(...params);
        }
        return rowToJson(ensurePrefs(db, req.auth.userId));
    });

    fastify.get('/api/circles/:id/alerts', { preHandler: requireAuth(db) }, async (req, reply) => {
        const circleId = Number(req.params.id);
        if (!Number.isInteger(circleId)) return reply.code(400).send({ error: 'invalid_circle' });
        if (!assertMember(db, circleId, req.auth.userId, reply)) return;
        const since = Number(req.query.since) || 0;
        const limit = Math.min(Number(req.query.limit) || 100, 500);
        const rows = db.prepare(
            `SELECT a.id, a.user_id AS userId, u.display_name AS displayName,
                    a.circle_id AS circleId, a.type, a.value, a.created_at AS createdAt
             FROM alert_events a JOIN users u ON u.id = a.user_id
             WHERE a.circle_id = ? AND a.created_at >= ?
             ORDER BY a.created_at DESC LIMIT ?`,
        ).all(circleId, since, limit);
        return { alerts: rows };
    });

    fastify.post('/api/users/me/alert-snooze', { preHandler: requireAuth(db) }, async (req, reply) => {
        const parsed = SnoozeBody.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
        const { alertType, durationMinutes } = parsed.data;
        const untilMs = Date.now() + durationMinutes * 60_000;
        const ok = setSnooze(db, req.auth.userId, alertType, untilMs);
        if (!ok) return reply.code(400).send({ error: 'cannot_snooze_type', message: 'SOS and crash alerts cannot be snoozed.' });
        return { ok: true, alertType, snoozeUntil: untilMs };
    });

    fastify.delete('/api/users/me/alert-snooze/:alertType', { preHandler: requireAuth(db) }, async (req) => {
        clearSnooze(db, req.auth.userId, req.params.alertType);
        return { ok: true };
    });

    fastify.get('/api/users/me/alert-snoozes', { preHandler: requireAuth(db) }, async (req) => {
        return { snoozes: listSnoozes(db, req.auth.userId) };
    });
}
