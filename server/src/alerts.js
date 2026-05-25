// Per-fix and periodic safety alerts.
//  - speeding: fired when a driving user crosses their speeding threshold.
//  - low_battery: fired on the falling edge of crossing the battery threshold.
//  - offline: fired by the scheduler when no fix has arrived in N minutes.
//
// Each alert type is gated by the user's alert_prefs row (created lazily).

import { publish } from './hub.js';
import { fanOut } from './fcm.js';
import { isSnoozed } from './lib/snooze.js';

const SPEEDING_REFIRE_MS = 5 * 60_000;

function ensurePrefs(db, userId) {
    let prefs = db.prepare('SELECT * FROM alert_prefs WHERE user_id = ?').get(userId);
    if (!prefs) {
        db.prepare('INSERT INTO alert_prefs (user_id) VALUES (?)').run(userId);
        prefs = db.prepare('SELECT * FROM alert_prefs WHERE user_id = ?').get(userId);
    }
    return prefs;
}

function recordAlert(db, userId, circleId, type, value) {
    const createdAt = Date.now();
    db.prepare(
        'INSERT INTO alert_events (user_id, circle_id, type, value, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(userId, circleId, type, value, createdAt);
    return createdAt;
}

/**
 * Called from the locations POST handler after a fix is stored. `fix.prevBatteryPct`
 * is the previously-stored battery reading (null if none) for edge detection.
 */
export function evaluateAlerts(db, fix) {
    const { userId, circleId, displayName, speedMps, batteryPct, activity, prevBatteryPct } = fix;
    const prefs = ensurePrefs(db, userId);

    if (prefs.speeding_enabled && speedMps != null && speedMps > prefs.speeding_threshold_mps) {
        const isDriving = activity === 'driving' || (activity == null && speedMps >= 7);
        if (isDriving) {
            const last = db.prepare(
                `SELECT created_at AS createdAt FROM alert_events
                 WHERE user_id = ? AND type = 'speeding'
                 ORDER BY created_at DESC LIMIT 1`,
            ).get(userId);
            if (!last || Date.now() - last.createdAt > SPEEDING_REFIRE_MS) {
                const createdAt = recordAlert(db, userId, circleId, 'speeding', speedMps);
                const ev = {
                    type: 'speeding_alert',
                    userId,
                    displayName,
                    speedMps,
                    thresholdMps: prefs.speeding_threshold_mps,
                    recordedAt: createdAt,
                };
                publish(circleId, ev);
                const circleMembers = db.prepare('SELECT user_id FROM circle_members WHERE circle_id = ? AND user_id != ?').all(circleId, userId);
                const unsnoozed = circleMembers.filter(m => !isSnoozed(db, m.user_id, 'speeding'));
                if (unsnoozed.length > 0) {
                    fanOut(circleId, ev, db, userId);
                }
            }
        }
    }

    if (
        prefs.low_battery_enabled &&
        batteryPct != null &&
        batteryPct <= prefs.low_battery_threshold &&
        (prevBatteryPct == null || prevBatteryPct > prefs.low_battery_threshold)
    ) {
        const createdAt = recordAlert(db, userId, circleId, 'low_battery', batteryPct);
        const ev = {
            type: 'low_battery_alert',
            userId,
            displayName,
            batteryPct,
            thresholdPct: prefs.low_battery_threshold,
            recordedAt: createdAt,
        };
        publish(circleId, ev);
        const circleMembers = db.prepare('SELECT user_id FROM circle_members WHERE circle_id = ? AND user_id != ?').all(circleId, userId);
        const unsnoozed = circleMembers.filter(m => !isSnoozed(db, m.user_id, 'low_battery'));
        if (unsnoozed.length > 0) {
            fanOut(circleId, ev, db, userId);
        }
    }
}

/**
 * Periodic offline-checker. Scans all users with a known last-fix and emits
 * an offline alert when the gap exceeds their personal threshold. Once fired,
 * a cooldown of `offline_minutes` prevents duplicates until they come back.
 */
export function evaluateOfflineSweep(db) {
    const rows = db.prepare(
        `SELECT u.id AS userId, u.display_name AS displayName,
                cm.circle_id AS circleId,
                l.recorded_at AS recordedAt,
                COALESCE(ap.offline_enabled, 1) AS offlineEnabled,
                COALESCE(ap.offline_minutes, 30) AS offlineMinutes
         FROM users u
         JOIN circle_members cm ON cm.user_id = u.id
         JOIN locations l ON l.user_id = u.id
         LEFT JOIN alert_prefs ap ON ap.user_id = u.id`,
    ).all();

    const now = Date.now();
    for (const r of rows) {
        if (!r.offlineEnabled) continue;
        const gapMs = now - r.recordedAt;
        const thresholdMs = r.offlineMinutes * 60_000;
        if (gapMs < thresholdMs) continue;
        const last = db.prepare(
            `SELECT created_at AS createdAt FROM alert_events
             WHERE user_id = ? AND type = 'offline'
             ORDER BY created_at DESC LIMIT 1`,
        ).get(r.userId);
        if (last && (last.createdAt > r.recordedAt) && (now - last.createdAt < thresholdMs)) continue;
        const createdAt = recordAlert(db, r.userId, r.circleId, 'offline', Math.round(gapMs / 60_000));
        const ev = {
            type: 'offline_alert',
            userId: r.userId,
            displayName: r.displayName,
            minutesOffline: Math.round(gapMs / 60_000),
            thresholdMinutes: r.offlineMinutes,
            recordedAt: createdAt,
        };
        publish(r.circleId, ev);
        const circleMembers = db.prepare('SELECT user_id FROM circle_members WHERE circle_id = ? AND user_id != ?').all(r.circleId, r.userId);
        const unsnoozed = circleMembers.filter(m => !isSnoozed(db, m.user_id, 'offline'));
        if (unsnoozed.length > 0) {
            fanOut(r.circleId, ev, db, r.userId);
        }
    }
}
