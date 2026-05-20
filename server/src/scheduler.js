// Lightweight in-process scheduler. Currently only runs the offline-alert
// sweep. setInterval is fine for self-hosted single-process deployments.

import { evaluateOfflineSweep } from './alerts.js';
import { publish } from './hub.js';

const OFFLINE_SWEEP_INTERVAL_MS = 60_000;
const PAUSE_SWEEP_INTERVAL_MS = 60_000;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

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

    const cleanupTick = () => {
        const cutoff = Date.now() - RETENTION_MS;
        const tables = [
            ['locations_history', 'recorded_at'],
            ['alert_events', 'created_at'],
            ['messages', 'created_at'],
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
        clearInterval(cleanupHandle);
    };
}
