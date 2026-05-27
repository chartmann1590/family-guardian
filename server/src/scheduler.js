// Lightweight in-process scheduler. Currently only runs the offline-alert
// sweep. setInterval is fine for self-hosted single-process deployments.

import { evaluateOfflineSweep } from './alerts.js';
import { mineRoutines, evaluateRoutineSweep } from './routines.js';
import { evaluateCurfewSweep } from './curfew.js';
import { buildDigest, persistDigest } from './digest.js';
import { fanOut, cleanupStaleTokens } from './fcm.js';
import { fanOut as webPushFanOut } from './webPush.js';
import { publish } from './hub.js';
import { BundlingBuffer } from './lib/notificationBundler.js';
import { DateTime } from 'luxon';
import { minePlaceSuggestions } from './placeSuggestions.js';
import { evaluateEtaTick } from './eta.js';
import { initWebhooks } from './webhooks.js';
import { dirname, join } from 'node:path';
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';

const OFFLINE_SWEEP_INTERVAL_MS = 60_000;
const PAUSE_SWEEP_INTERVAL_MS = 60_000;
const ROUTINE_SWEEP_INTERVAL_MS = 60_000;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const MINE_COOLDOWN_MS = 6 * 60 * 60 * 1_000;
const SUGGESTION_COOLDOWN_MS = 12 * 60 * 60 * 1_000;
const DIGEST_RETENTION_MS = 12 * 7 * 24 * 60 * 60 * 1_000;
const EC_EXPIRY_SWEEP_MS = 10 * 60 * 1_000;
const BREAK_SWEEP_MS = 5 * 60 * 1_000;
const TRIP_SHARE_EXPIRY_MS = 60 * 60 * 1_000;

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
            webPushFanOut(circleId, { type: 'weekly_digest', weekStart: String(weekStart), weekEnd: String(weekEnd) }, db);
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

    initWebhooks(db);

    // Place suggestion mining (mirrors routine mining pattern)
    let lastSuggestionTime = 0;
    const suggestionTick = () => {
        const now = Date.now();
        if (now - lastSuggestionTime < SUGGESTION_COOLDOWN_MS) return;
        try {
            const result = minePlaceSuggestions(db);
            lastSuggestionTime = now;
            log?.info?.(result, 'place_suggestions_mine_complete');
        } catch (err) {
            log?.warn?.({ err: err.message }, 'place_suggestions_mine_failed');
        }
    };

    const scheduleNextSuggestion = () => {
        const now = new Date();
        const next = new Date(now);
        next.setHours(4, 0, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1);
        const delay = next - now;
        const handle = setTimeout(() => {
            suggestionTick();
            scheduleNextSuggestion();
        }, delay);
        if (handle.unref) handle.unref();
    };
    scheduleNextSuggestion();
    suggestionTick();

    // ETA evaluation tick (every 60s)
    const etaTick = () => {
        try { evaluateEtaTick(db); } catch (err) { log?.warn?.({ err: err.message }, 'eta_tick_failed'); }
    };
    const etaHandle = setInterval(etaTick, 60_000);
    if (etaHandle.unref) etaHandle.unref();

    // Break nudge sweep (every 5 min)
    const breakSweepTick = () => {
        try {
            const now = Date.now();
            const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
            const openTrips = db.prepare(`
                SELECT t.id, t.user_id, t.circle_id, t.started_at, t.break_nudged_at
                FROM trips t
                JOIN locations l ON l.user_id = t.user_id
                WHERE t.ended_at IS NULL AND t.started_at < ?
            `).all(now - TWO_HOURS_MS);

            for (const trip of openTrips) {
                if (trip.break_nudged_at) continue;

                const recentFixes = db.prepare(`
                    SELECT activity, recorded_at FROM locations
                    WHERE user_id = ? AND recorded_at > ?
                    ORDER BY recorded_at DESC
                `).all(trip.user_id, now - TWO_HOURS_MS);

                const hasStill = recentFixes.some(f =>
                    f.activity === 'still' || f.activity === 'walking'
                );
                if (hasStill) continue;

                const displayName = db.prepare('SELECT display_name FROM users WHERE id = ?').get(trip.user_id)?.display_name;
                const circleId = trip.circle_id;
                if (!circleId) continue;

                const ev = {
                    type: 'break_suggested',
                    userId: trip.user_id,
                    displayName,
                    tripId: trip.id,
                    drivingDurationMs: now - trip.started_at,
                };
                publish(circleId, ev);
                fanOut(circleId, ev, db, trip.user_id);
                webPushFanOut(circleId, ev, db, trip.user_id);
                db.prepare('UPDATE trips SET break_nudged_at = ? WHERE id = ?').run(now, trip.id);
            }
        } catch (err) { log?.warn?.({ err: err.message }, 'break_sweep_failed'); }
    };
    const breakHandle = setInterval(breakSweepTick, BREAK_SWEEP_MS);
    if (breakHandle.unref) breakHandle.unref();

    // Trip share token expiry sweep (hourly)
    const shareExpiryTick = () => {
        try {
            const now = Date.now();
            db.prepare('UPDATE trip_share_tokens SET revoked = 1 WHERE revoked = 0 AND expires_at < ?').run(now);
        } catch (err) { log?.warn?.({ err: err.message }, 'share_expiry_failed'); }
    };
    const shareExpiryHandle = setInterval(shareExpiryTick, TRIP_SHARE_EXPIRY_MS);
    if (shareExpiryHandle.unref) shareExpiryHandle.unref();
    shareExpiryTick();

    // Auto-backup (nightly if enabled)
    if (process.env.AUTO_BACKUP_ENABLED === '1') {
        const backupDir = join(dirname(process.env.DATABASE_PATH || ''), 'backups');
        try { mkdirSync(backupDir, { recursive: true }); } catch { /* ignore */ }

        const autoBackupTick = () => {
            try {
                const backupPath = join(backupDir, `guardian-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
                db.prepare(`VACUUM INTO ?`).run(backupPath);
                const backups = readdirSync(backupDir).filter(f => f.endsWith('.db')).sort();
                while (backups.length > 7) {
                    unlinkSync(join(backupDir, backups.shift()));
                }
                log?.info?.({ path: backupPath }, 'auto_backup_complete');
            } catch (err) { log?.warn?.({ err: err.message }, 'auto_backup_failed'); }
        };
        const scheduleBackup = () => {
            const now = new Date();
            const next = new Date(now);
            next.setHours(3, 30, 0, 0);
            if (next <= now) next.setDate(next.getDate() + 1);
            const handle = setTimeout(() => { autoBackupTick(); scheduleBackup(); }, next - now);
            if (handle.unref) handle.unref();
        };
        scheduleBackup();
    }

    return () => {
        clearInterval(offlineHandle);
        clearInterval(pauseHandle);
        clearInterval(routineSweepHandle);
        clearInterval(curfewSweepHandle);
        clearInterval(cleanupHandle);
        clearInterval(ecExpiryHandle);
        clearInterval(digestHandle);
        clearInterval(etaHandle);
        clearInterval(breakHandle);
        clearInterval(shareExpiryHandle);
        routineBundler.clear();
    };
}
