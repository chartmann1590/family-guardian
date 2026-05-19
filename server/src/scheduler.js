// Lightweight in-process scheduler. Currently only runs the offline-alert
// sweep. setInterval is fine for self-hosted single-process deployments.

import { evaluateOfflineSweep } from './alerts.js';

const OFFLINE_SWEEP_INTERVAL_MS = 60_000;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

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
        clearInterval(cleanupHandle);
    };
}
