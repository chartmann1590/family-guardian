// Lightweight in-process scheduler. Currently only runs the offline-alert
// sweep. setInterval is fine for self-hosted single-process deployments.

import { evaluateOfflineSweep } from './alerts.js';
import { mineRoutines, evaluateRoutineSweep } from './routines.js';
import { evaluateCurfewSweep } from './curfew.js';
import { buildDigest, persistDigest } from './digest.js';
import { fanOut, cleanupStaleTokens } from './fcm.js';
import { publish } from './hub.js';
import { BundlingBuffer } from './lib/notificationBundler.js';
import { DateTime } from 'luxon';

const OFFLINE_SWEEP_INTERVAL_MS = 60_000;
const PAUSE_SWEEP_INTERVAL_MS = 60_000;
const ROUTINE_SWEEP_INTERVAL_MS = 60_000;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const MINE_COOLDOWN_MS = 6 * 60 * 60 * 1_000;
const DIGEST_RETENTION_MS = 12 * 7 * 24 * 60 * 60 * 1_000;
const EC_EXPIRY_SWEEP_MS = 10 * 60 * 1_000;

function expirePauses(db) {
    const now = Date.now();
    const expired = db
        .prepare(
            `SELECT u.id AS userId, cm.circle_id AS circleId
             FROM users u
             LEFT JOIN circle_members cm ON cm.user_id = u.id
             WHERE u.paused_until IS NOT NULL AND u.paused_until < ?`
        )
        .all(now);
    if (expired.length === 0) return;
    db.prepare(
        `UPDATE users SET paused_until = NULL, pause_reason = NULL
         WHERE paused_until IS NOT NULL AND paused_until < ?`
    ).run(now);
    for (const { userId, circleId } of expired) {
        if (!circleId) continue;
        publish(circleId, { type: 'pause_changed', userId, pausedUntil: null, reason: null });
    }
}

function weeklyDigestTick(db, log) {
    const now = Date.now();
    const weekEnd = now;
    const weekStart = now - 7 * 24 * 60 * 60 * 1000;

    const users = db.prepare(`
        SELECT ap.user_id, ap.digest_day_of_week, ap.digest_hour_local, ap.digest_timezone
        FROM alert_prefs ap
        WHERE ap.weekly_digest_enabled = 1
          AND ap.digest_day_of_week IS NOT NULL
          AND ap.digest_hour_local IS NOT NULL
    `).all();

    const firedCircleIds = new Set();
    for (const u of users) {
        try {
            const localNow = DateTime.now().setZone(u.digest_timezone || 'Etc/UTC');
            if (localNow.weekday % 7 !== u.digest_day_of_week) continue;
            if (localNow.hour !== u.digest_hour_local) continue;
            if (localNow.minute !== 0) continue;

            const circleRow = db.prepare(
                'SELECT cm.circle_id FROM circle_members cm WHERE cm.user_id = ? ORDER BY cm.joined_at ASC LIMIT 1'
            ).get(u.user_id);
            if (!circleRow) continue;
            const circleId = circleRow.circle_id;

            if (firedCircleIds.has(circleId)) continue;

            const summary = buildDigest(db, circleId, weekStart, weekEnd);
            persistDigest(db, circleId, weekStart, weekEnd, summary);
            fanOut(circleId, { type: 'weekly_digest', weekStart: String(weekStart), weekEnd: String(weekEnd) }, db);
            firedCircleIds.add(circleId);
        } catch (err) {
            log?.warn?.({ err: err.message, userId: u.user_id }, 'digest_user_failed');
        }
    }

    db.prepare('DELETE FROM digest_snapshots WHERE created_at < ?')
        .run(now - DIGEST_RETENTION_MS);
}

export function startScheduler(db, log) {
    const routineBundler = new BundlingBuffer(60_000);

    const offlineTick = () => {
        try {
            evaluateOfflineSweep(db);
        } catch (err) {
            log?.warn?.({ err: err.message }, 'offline_sweep_failed');
        }
    };
    const offlineHandle = setInterval(offlineTick, OFFLINE_SWEEP_INTERVAL_MS);
    if (offlineHandle.unref) offlineHandle.unref();

    const pauseTick = () => {
        try {
            expirePauses(db);
        } catch (err) {
            log?.warn?.({ err: err.message }, 'pause_sweep_failed');
        }
    };
    const pauseHandle = setInterval(pauseTick, PAUSE_SWEEP_INTERVAL_MS);
    if (pauseHandle.unref) pauseHandle.unref();

    let lastMineTime = 0;
    const mineTick = () => {
        const now = Date.now();
        if (now - lastMineTime < MINE_COOLDOWN_MS) return;
        try {
            const result = mineRoutines(db);
            lastMineTime = now;
            log?.info?.(result, 'routine_mine_complete');
        } catch (err) {
            log?.warn?.({ err: err.message }, 'routine_mine_failed');
        }
    };

    const scheduleNextMine = () => {
        const now = new Date();
        const next = new Date(now);
        next.setHours(3, 0, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1);
        const delay = next - now;
        const handle = setTimeout(() => {
            mineTick();
            scheduleNextMine();
        }, delay);
        if (handle.unref) handle.unref();
    };
    scheduleNextMine();
    mineTick();

    const routineSweepTick = () => {
        try {
            evaluateRoutineSweep(db);
        } catch (err) {
            log?.warn?.({ err: err.message }, 'routine_sweep_failed');
        }
    };
    const routineSweepHandle = setInterval(routineSweepTick, ROUTINE_SWEEP_INTERVAL_MS);
    if (routineSweepHandle.unref) routineSweepHandle.unref();

    const curfewTick = () => {
        try {
            evaluateCurfewSweep(db);
        } catch (err) {
            log?.warn?.({ err: err.message }, 'curfew_sweep_failed');
        }
    };
    const curfewSweepHandle = setInterval(curfewTick, 5 * 60_000);
    if (curfewSweepHandle.unref) curfewSweepHandle.unref();

    const digestTick = () => {
        try {
            weeklyDigestTick(db, log);
        } catch (err) {
            log?.warn?.({ err: err.message }, 'digest_tick_failed');
        }
    };
    const digestHandle = setInterval(digestTick, 60_000);
    if (digestHandle.unref) digestHandle.unref();

    const cleanupTick = () => {
        const cutoff = Date.now() - RETENTION_MS;
        const tables = [
            ['locations_history', 'recorded_at'],
            ['alert_events', 'created_at'],
            ['messages', 'created_at'],
            ['digest_snapshots', 'created_at'],
        ];
        for (const [table, col] of tables) {
            try {
                const r = db.prepare(`DELETE FROM ${table} WHERE ${col} < ?`).run(cutoff);
                if (r.changes > 0) log?.info?.({ table, deleted: r.changes }, 'retention_cleanup');
            } catch (err) {
                log?.warn?.({ err: err.message, table }, 'retention_cleanup_failed');
            }
        }
        try {
            const r = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
            if (r.changes > 0) log?.info?.({ deleted: r.changes }, 'session_cleanup');
        } catch (err) {
            log?.warn?.({ err: err.message }, 'session_cleanup_failed');
        }
        try {
            cleanupStaleTokens(db);
        } catch (err) {
            log?.warn?.({ err: err.message }, 'fcm_cleanup_failed');
        }
    };
    const cleanupHandle = setInterval(cleanupTick, CLEANUP_INTERVAL_MS);
    if (cleanupHandle.unref) cleanupHandle.unref();
    cleanupTick();

    const ecExpiryTick = () => {
        try {
            const now = Date.now();
            const r = db.prepare("DELETE FROM emergency_contacts WHERE status = 'pending' AND pending_expires_at IS NOT NULL AND pending_expires_at < ?").run(now);
            if (r.changes > 0) log?.info?.({ deleted: r.changes }, 'ec_expiry_sweep');
        } catch (err) {
            log?.warn?.({ err: err.message }, 'ec_expiry_sweep_failed');
        }
    };
    const ecExpiryHandle = setInterval(ecExpiryTick, EC_EXPIRY_SWEEP_MS);
    if (ecExpiryHandle.unref) ecExpiryHandle.unref();
    ecExpiryTick();

    return () => {
        clearInterval(offlineHandle);
        clearInterval(pauseHandle);
        clearInterval(routineSweepHandle);
        clearInterval(curfewSweepHandle);
        clearInterval(cleanupHandle);
        clearInterval(ecExpiryHandle);
        clearInterval(digestHandle);
        routineBundler.clear();
    };
}
