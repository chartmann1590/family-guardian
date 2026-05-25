import { z } from 'zod';
import { requireAuth, getUserCircleId } from '../auth.js';
import { publish } from '../hub.js';
import { fanOutToUsers } from '../fcm.js';
import { isSnoozed } from '../lib/snooze.js';
import { reconcileGeofences } from '../geofence.js';
import { onLocationFix as visitsOnFix } from '../visits.js';
import { onLocationFix as tripsOnFix } from '../trips.js';
import { evaluateAlerts } from '../alerts.js';
import { enqueueGeocode, getCachedLabel } from '../geocoder.js';
import { logView } from '../audit.js';
import { computeDrivingScore } from '../drivingScore.js';

const SCORE_CACHE_TTL_MS = 5 * 60_000;
const scoreCache = new Map();

function checkLowBattery(db, userId, circleId, batteryPct, displayName) {
    if (batteryPct == null) return;
    const watchers = db.prepare(`
        SELECT ap.user_id, ap.low_battery_threshold
        FROM alert_prefs ap
        JOIN circle_members cm ON cm.user_id = ap.user_id AND cm.circle_id = ?
        WHERE ap.low_battery_alerts = 1 AND cm.user_id != ?
    `).all(circleId, userId);
    if (watchers.length === 0) return;

    const effectiveThreshold = Math.max(...watchers.map(w => w.low_battery_threshold || 15));
    let state = db.prepare('SELECT last_pct AS pct, last_alert_at AS firedAt FROM last_battery_state WHERE user_id = ?').get(userId);

    if (!state) {
        state = { pct: batteryPct, firedAt: null };
    }

    const crossed = state.pct >= effectiveThreshold && batteryPct < effectiveThreshold;
    const canFire = state.firedAt == null || Date.now() - state.firedAt > 6 * 60 * 60 * 1000;

    if (crossed && canFire) {
        db.prepare('INSERT OR REPLACE INTO last_battery_state (user_id, last_pct, last_alert_at) VALUES (?, ?, ?)')
            .run(userId, batteryPct, Date.now());
        const ev = { type: 'low_battery', userId, displayName, batteryPct, recordedAt: Date.now() };
        publish(circleId, ev);
        const watcherIds = watchers.filter(w => (w.low_battery_threshold || 15) >= batteryPct && !isSnoozed(db, w.user_id, 'low_battery')).map(w => w.user_id);
        if (watcherIds.length > 0) {
            fanOutToUsers(watcherIds, ev, db);
        }
        return;
    }

    const resetCooldown = batteryPct > effectiveThreshold + 5;
    db.prepare('INSERT OR REPLACE INTO last_battery_state (user_id, last_pct, last_alert_at) VALUES (?, ?, ?)')
        .run(userId, batteryPct, resetCooldown ? 0 : (state.firedAt || 0));
}

function cachedDrivingScore(db, userId) {
    const now = Date.now();
    const cached = scoreCache.get(userId);
    if (cached && now - cached.computedAt < SCORE_CACHE_TTL_MS) return cached.score;
    const sinceMs = now - 7 * 86_400_000;
    const result = computeDrivingScore(db, userId, sinceMs);
    scoreCache.set(userId, { score: result.score, computedAt: now });
    return result.score;
}

const ACTIVITY_VALUES = ['still', 'walking', 'running', 'cycling', 'driving', 'unknown'];

const LocationBody = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracyM: z.number().nonnegative().optional(),
    speedMps: z.number().nonnegative().optional(),
    batteryPct: z.number().int().min(0).max(100).optional(),
    recordedAt: z.number().int().positive().optional(),
    bearing: z.number().min(0).max(360).optional(),
    altitudeM: z.number().optional(),
    activity: z.enum(ACTIVITY_VALUES).optional(),
    activityConfidence: z.number().int().min(0).max(100).optional(),
});

export default async function locationRoutes(fastify, { db }) {
    fastify.post('/api/locations', { preHandler: requireAuth(db) }, async (req, reply) => {
        const parsed = LocationBody.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
        }
        const { lat, lng, accuracyM, speedMps, batteryPct, bearing, altitudeM, activity, activityConfidence } = parsed.data;
        // Clamp client-supplied recordedAt to "now" so a misconfigured clock
        // can't poison the history with future timestamps.
        const recordedAt = Math.min(parsed.data.recordedAt ?? Date.now(), Date.now());
        const userId = req.auth.userId;

        const prevBattery = db
            .prepare('SELECT battery_pct AS batteryPct FROM locations WHERE user_id = ?')
            .get(userId)?.batteryPct ?? null;

        const pauseRow = db
            .prepare('SELECT paused_until AS pausedUntil FROM users WHERE id = ?')
            .get(userId);
        const isPaused = !!(pauseRow?.pausedUntil && pauseRow.pausedUntil > Date.now());

        const cachedAddress = getCachedLabel(db, lat, lng);

        const writeLocation = db.transaction(() => {
            if (!isPaused) {
                db.prepare(
                    `INSERT INTO locations
                        (user_id, lat, lng, accuracy_m, speed_mps, battery_pct, recorded_at,
                         bearing, altitude_m, activity, activity_confidence, address)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(user_id) DO UPDATE SET
                        lat = excluded.lat,
                        lng = excluded.lng,
                        accuracy_m = excluded.accuracy_m,
                        speed_mps = excluded.speed_mps,
                        battery_pct = excluded.battery_pct,
                        recorded_at = excluded.recorded_at,
                        bearing = excluded.bearing,
                        altitude_m = excluded.altitude_m,
                        activity = excluded.activity,
                        activity_confidence = excluded.activity_confidence,
                        address = excluded.address`
                ).run(
                    userId, lat, lng, accuracyM ?? null, speedMps ?? null, batteryPct ?? null, recordedAt,
                    bearing ?? null, altitudeM ?? null, activity ?? null, activityConfidence ?? null,
                    cachedAddress,
                );
            }

            db.prepare(
                `INSERT INTO locations_history
                    (user_id, lat, lng, accuracy_m, speed_mps, battery_pct, recorded_at,
                     bearing, altitude_m, activity, activity_confidence)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
                userId, lat, lng, accuracyM ?? null, speedMps ?? null, batteryPct ?? null, recordedAt,
                bearing ?? null, altitudeM ?? null, activity ?? null, activityConfidence ?? null,
            );
        });
        writeLocation();

        if (isPaused) {
            return { ok: true, paused: true };
        }

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
                bearing: bearing ?? null,
                altitudeM: altitudeM ?? null,
                activity: activity ?? null,
                activityConfidence: activityConfidence ?? null,
                recordedAt,
                address: cachedAddress,
            });

            if (!cachedAddress) {
                enqueueGeocode(db, lat, lng, (label) => {
                    if (label) {
                        db.prepare('UPDATE locations SET address = ? WHERE user_id = ?').run(label, userId);
                        publish(circleId, {
                            type: 'location_address',
                            userId,
                            address: label,
                        });
                    }
                });
            }

            const transitions = [];
            reconcileGeofences(db, {
                userId,
                circleId,
                displayName: req.auth.displayName,
                lat,
                lng,
                recordedAt,
            }, (t) => transitions.push(t));
            const fix = {
                userId,
                circleId,
                displayName: req.auth.displayName,
                lat,
                lng,
                speedMps: speedMps ?? null,
                batteryPct: batteryPct ?? null,
                activity: activity ?? null,
                recordedAt,
            };
            try {
                visitsOnFix(db, fix, transitions);
            } catch (err) {
                req.log.warn({ err: err.message, userId }, 'visits_onfix_failed');
            }
            try {
                tripsOnFix(db, fix);
            } catch (err) {
                req.log.warn({ err: err.message, userId }, 'trips_onfix_failed');
            }
            try {
                evaluateAlerts(db, { ...fix, prevBatteryPct: prevBattery });
            } catch (err) {
                req.log.warn({ err: err.message, userId }, 'alerts_eval_failed');
            }
            try {
                const circleId = getUserCircleId(db, userId);
                if (circleId) {
                    const uname = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId)?.display_name || '';
                    checkLowBattery(db, userId, circleId, batteryPct, uname);
                }
            } catch (err) {
                req.log.warn({ err: err.message, userId }, 'low_battery_check_failed');
            }
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

        const now = Date.now();
        const rows = db
            .prepare(
                `SELECT u.id AS userId, u.display_name AS displayName, u.email,
                        u.photo_path AS photoPath,
                        u.paused_until AS pausedUntil,
                        u.pause_reason AS pauseReason,
                        cm.role AS role,
                        l.lat AS lat, l.lng AS lng,
                        l.accuracy_m AS accuracyM,
                        l.speed_mps AS speedMps,
                        l.battery_pct AS batteryPct,
                        l.bearing AS bearing,
                        l.altitude_m AS altitudeM,
                        l.activity AS activity,
                        l.activity_confidence AS activityConfidence,
                        l.recorded_at AS recordedAt,
                        l.address AS address
                 FROM circle_members cm
                 JOIN users u ON u.id = cm.user_id
                 LEFT JOIN locations l ON l.user_id = u.id
                 WHERE cm.circle_id = ?
                 ORDER BY cm.role DESC, u.display_name COLLATE NOCASE ASC`
            )
            .all(circleId)
            .map(({ photoPath, pausedUntil, pauseReason, ...m }) => {
                const paused = !!(pausedUntil && pausedUntil > now);
                return {
                    ...m,
                    photoUrl: photoPath ? `/api/users/${m.userId}/photo` : null,
                    paused,
                    pausedUntil: paused ? pausedUntil : null,
                    pauseReason: paused ? pauseReason : null,
                };
            });
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
                    battery_pct AS batteryPct, bearing, altitude_m AS altitudeM,
                    activity, activity_confidence AS activityConfidence,
                    recorded_at AS recordedAt
             FROM locations_history
             WHERE user_id = ? AND recorded_at >= ? AND recorded_at <= ?
             ORDER BY recorded_at ASC
             LIMIT ?`
        ).all(targetUserId, from, to, limit);

        logView(db, req.auth.userId, targetUserId, 'history');
        return { points: rows };
    });

    fastify.get('/api/circles/:id/health', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        const circleId = Number(req.params.id);
        if (!Number.isInteger(circleId)) return reply.code(400).send({ error: 'invalid_circle' });

        const membership = db
            .prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?')
            .get(circleId, req.auth.userId);
        if (!membership) return reply.code(403).send({ error: 'not_a_member' });

        const now = Date.now();

        const memberRows = db.prepare(
            `SELECT u.id AS userId, u.display_name AS displayName, u.photo_path AS photoPath,
                    u.paused_until AS pausedUntil,
                    l.battery_pct AS batteryPct,
                    l.recorded_at AS recordedAt,
                    l.activity AS activity,
                    l.lng AS lng
             FROM circle_members cm
             JOIN users u ON u.id = cm.user_id
             LEFT JOIN locations l ON l.user_id = u.id
             WHERE cm.circle_id = ?
             ORDER BY cm.role DESC, u.display_name COLLATE NOCASE ASC`
        ).all(circleId);

        const latestCheckins = db.prepare(
            `SELECT ci.user_id AS userId, ci.status, ci.created_at AS createdAt
             FROM check_ins ci
             INNER JOIN (
                 SELECT user_id, MAX(created_at) AS max_at
                 FROM check_ins
                 WHERE circle_id = ?
                 GROUP BY user_id
             ) latest ON ci.user_id = latest.user_id AND ci.created_at = latest.max_at
             WHERE ci.circle_id = ?`
        ).all(circleId, circleId);
        const checkinMap = new Map(latestCheckins.map(c => [c.userId, c]));

        const members = memberRows.map((m) => {
            const paused = !!(m.pausedUntil && m.pausedUntil > now);
            const lastFixAt = m.recordedAt ?? null;
            const staleMinutes = lastFixAt != null ? Math.round((now - lastFixAt) / 60000) : null;

            const lng = m.lng ?? 0;
            const utcOffsetH = Math.round(lng / 15);
            const localMs = now + utcOffsetH * 3600000;
            const localDow = new Date(localMs).getUTCDay();

            const nextRoutine = db.prepare(`
                SELECT r.kind, r.expected_minute, p.name AS placeName
                FROM routines r
                JOIN places p ON p.id = r.place_id
                WHERE r.user_id = ? AND r.active = 1 AND r.day_of_week = ?
                ORDER BY r.expected_minute ASC
                LIMIT 1
            `).get(m.userId, localDow);

            const checkin = checkinMap.get(m.userId);

            return {
                userId: m.userId,
                displayName: m.displayName,
                photoUrl: m.photoPath ? `/api/users/${m.userId}/photo` : null,
                batteryPct: m.batteryPct ?? null,
                lastFixAt,
                staleMinutes,
                activity: m.activity ?? null,
                paused,
                pausedUntil: paused ? m.pausedUntil : null,
                nextRoutine: nextRoutine
                    ? { kind: nextRoutine.kind, placeName: nextRoutine.placeName, expectedMinute: nextRoutine.expected_minute }
                    : null,
                drivingScore: cachedDrivingScore(db, m.userId),
                checkinStatus: checkin?.status ?? null,
                checkinAt: checkin?.createdAt ?? null,
            };
        });

        return { members };
    });
}
