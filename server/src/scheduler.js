// Lightweight in-process scheduler. Currently only runs the offline-alert
// sweep. setInterval is fine for self-hosted single-process deployments.

import { evaluateOfflineSweep } from './alerts.js';
import { mineRoutines, evaluateRoutineSweep } from './routines.js';
import { evaluateCurfewSweep } from './curfew.js';
import { buildDigest, persistDigest } from './digest.js';
import { fanOut } from './fcm.js';
import { publish } from './hub.js';

const OFFLINE_SWEEP_INTERVAL_MS = 60_000;
const PAUSE_SWEEP_INTERVAL_MS = 60_000;
const ROUTINE_SWEEP_INTERVAL_MS = 60_000;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const MINE_COOLDOWN_MS = 6 * 60 * 60 * 1_000;
const DIGEST_RETENTION_MS = 12 * 7 * 24 * 60 * 60 * 1_000;

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
    const circles = db.prepare('SELECT id FROM circles').all();
    for (const c of circles) {
        try {
            const summary = buildDigest(db, c.id, weekStart, weekEnd);
            persistDigest(db, c.id, weekStart, weekEnd, summary);
            const recipients = db.prepare(
                `SELECT DISTINCT ap.user_id FROM alert_prefs ap
                 JOIN circle_members cm ON cm.user_id = ap.user_id
                 WHERE cm.circle_id = ? AND ap.weekly_digest_enabled = 1`,
            ).all(c.id);
            if (recipients.length > 0) {
                fanOut(c.id, { type: 'weekly_digest', weekStart: String(weekStart), weekEnd: String(weekEnd) }, db);
            }
        } catch (err) {
            log?.warn?.({ err: err.message, circleId: c.id }, 'digest_build_failed');
        }
    }
    db.prepare('DELETE FROM digest_snapshots WHERE created_at < ?')
        .run(now - DIGEST_RETENTION_MS);
}

export function startScheduler(db, log) {
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

    const scheduleWeeklyDigest = () => {
        const now = new Date();
        const next = new Date(now);
        next.setHours(18, 0, 0, 0);
        const dayOfWeek = next.getDay();
        const daysUntilSunday = (7 - dayOfWeek) % 7;
        if (daysUntilSunday === 0 && now.getHours() >= 18) {
            next.setDate(next.getDate() + 7);
        } else {
            next.setDate(next.getDate() + daysUntilSunday);
        }
        const delay = next - now;
        const handle = setTimeout(async () => {
            try {
                weeklyDigestTick(db, log);
            } catch (err) {
                log?.warn?.({ err: err.message }, 'weekly_digest_failed');
            }
            scheduleWeeklyDigest();
        }, delay);
        if (handle.unref) handle.unref();
    };
    scheduleWeeklyDigest();

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
    };
    const cleanupHandle = setInterval(cleanupTick, CLEANUP_INTERVAL_MS);
    if (cleanupHandle.unref) cleanupHandle.unref();
    cleanupTick();

    return () => {
        clearInterval(offlineHandle);
        clearInterval(pauseHandle);
        clearInterval(routineSweepHandle);
        clearInterval(curfewSweepHandle);
        clearInterval(cleanupHandle);
    };
}
