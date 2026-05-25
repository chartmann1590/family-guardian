import { publish } from './hub.js';
import { fanOut } from './fcm.js';
import { isSnoozed } from './lib/snooze.js';
import { BundlingBuffer } from './lib/notificationBundler.js';

const deviationBundler = new BundlingBuffer(60_000);

function flushBundle(circleId, events) {
    if (events.length === 1) {
        publish(circleId, events[0]);
        fanOut(circleId, events[0], db_ref, events[0].userId);
        return;
    }
    const ev = { type: 'routine_deviation_bundle', circleId, events, count: events.length };
    publish(circleId, ev);
    const members = db_ref.prepare('SELECT user_id FROM circle_members WHERE circle_id = ?').all(circleId);
    const unsnoozed = members.filter(m => !isSnoozed(db_ref, m.user_id, 'routine_deviation'));
    if (unsnoozed.length > 0) fanOut(circleId, ev, db_ref);
}

let db_ref = null;

export function estimateLocalMinute(lng, epochMs) {
    const utcOffsetH = Math.round((lng ?? 0) / 15);
    const localMs = epochMs + utcOffsetH * 3600000;
    const d = new Date(localMs);
    return {
        minute: d.getUTCHours() * 60 + d.getUTCMinutes(),
        dayOfWeek: d.getUTCDay(),
    };
}

export function inQuietHoursLocal(startMin, endMin, nowLocalMin) {
    if (startMin == null || endMin == null) return false;
    return startMin <= endMin
        ? (nowLocalMin >= startMin && nowLocalMin < endMin)
        : (nowLocalMin >= startMin || nowLocalMin < endMin);
}

function computeStats(minutes) {
    if (minutes.length < 4) return null;
    const sorted = [...minutes].sort((a, b) => a - b);
    let trimmed = sorted;
    if (sorted.length >= 8) {
        const trimCount = Math.floor(sorted.length * 0.1);
        trimmed = sorted.slice(trimCount, sorted.length - trimCount);
    }
    const mid = Math.floor(trimmed.length / 2);
    const median = trimmed.length % 2 === 0
        ? Math.round((trimmed[mid - 1] + trimmed[mid]) / 2)
        : trimmed[mid];
    const q1 = trimmed[Math.floor(trimmed.length * 0.25)];
    const q3 = trimmed[Math.floor(trimmed.length * 0.75)];
    const stddev = (q3 - q1) / 1.349;
    return { median, stddev, sampleCount: minutes.length };
}

function computeConfidence(stddev, sampleCount) {
    const sizeFactor = Math.min(1, sampleCount / 4);
    const spreadFactor = 1 - Math.min(1, stddev / 45);
    return Math.max(0, Math.min(1, sizeFactor * spreadFactor));
}

function computeTolerance(stddev) {
    return Math.max(15, Math.min(60, Math.round(2 * stddev)));
}

export function mineRoutines(db, opts = {}) {
    const now = opts.now ?? Date.now();
    const windowStart = now - 30 * 24 * 60 * 60 * 1000;
    const DEACTIVATION_AGE_MS = 14 * 24 * 60 * 60 * 1000;

    const visits = db.prepare(`
        SELECT v.user_id, v.circle_id, v.place_id, v.lng,
               v.started_at, v.ended_at
        FROM visits v
        WHERE v.place_id IS NOT NULL
          AND v.started_at > ?
    `).all(windowStart);

    const groups = new Map();
    const dwellGroups = new Map();
    for (const v of visits) {
        const arr = estimateLocalMinute(v.lng, v.started_at);
        pushObs(groups, v.user_id, v.circle_id, v.place_id, 'arrival', arr.dayOfWeek, arr.minute, v.started_at);
        if (v.ended_at != null) {
            const dep = estimateLocalMinute(v.lng, v.ended_at);
            pushObs(groups, v.user_id, v.circle_id, v.place_id, 'departure', dep.dayOfWeek, dep.minute, v.ended_at);
            if (v.ended_at - v.started_at >= 5 * 60 * 1000) {
                const dwellMin = Math.round((v.ended_at - v.started_at) / 60000);
                pushDwellObs(dwellGroups, v.user_id, v.circle_id, v.place_id, arr.dayOfWeek, arr.minute, dwellMin, v.started_at);
            }
        }
    }

    let routinesCreated = 0;
    let routinesUpdated = 0;

    const checkExisting = db.prepare(
        `SELECT id FROM routines WHERE user_id = ? AND place_id = ? AND kind = ? AND day_of_week = ?`
    );

    const upsert = db.prepare(`
        INSERT INTO routines (user_id, circle_id, place_id, kind, day_of_week,
                              expected_minute, tolerance_minutes, sample_count, confidence,
                              source, active, first_seen_at, last_seen_at, last_observed_at,
                              created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto', 1, ?, ?, NULL, ?, ?)
        ON CONFLICT (user_id, place_id, kind, day_of_week) DO UPDATE SET
            expected_minute   = CASE WHEN routines.source = 'manual' THEN routines.expected_minute   ELSE excluded.expected_minute END,
            tolerance_minutes = CASE WHEN routines.source = 'manual' THEN routines.tolerance_minutes ELSE excluded.tolerance_minutes END,
            sample_count      = excluded.sample_count,
            confidence        = excluded.confidence,
            last_seen_at      = excluded.last_seen_at,
            active            = 1,
            updated_at        = excluded.updated_at
    `);

    const upsertDwell = db.prepare(`
        INSERT INTO routines (user_id, circle_id, place_id, kind, day_of_week,
                              expected_minute, expected_dwell_minutes, tolerance_minutes, sample_count, confidence,
                              source, active, first_seen_at, last_seen_at, last_observed_at,
                              created_at, updated_at)
        VALUES (?, ?, ?, 'dwell', ?, ?, ?, ?, ?, ?, 'auto', 1, ?, ?, NULL, ?, ?)
        ON CONFLICT (user_id, place_id, kind, day_of_week) DO UPDATE SET
            expected_dwell_minutes = CASE WHEN routines.source = 'manual' THEN routines.expected_dwell_minutes ELSE excluded.expected_dwell_minutes END,
            expected_minute        = CASE WHEN routines.source = 'manual' THEN routines.expected_minute        ELSE excluded.expected_minute END,
            tolerance_minutes      = CASE WHEN routines.source = 'manual' THEN routines.tolerance_minutes      ELSE excluded.tolerance_minutes END,
            sample_count           = excluded.sample_count,
            confidence             = excluded.confidence,
            last_seen_at           = excluded.last_seen_at,
            active                 = 1,
            updated_at             = excluded.updated_at
    `);

    db.transaction(() => {
        for (const g of groups.values()) {
            const stats = computeStats(g.minutes);
            if (!stats) continue;
            const confidence = computeConfidence(stats.stddev, stats.sampleCount);
            if (confidence < 0.7) continue;

            const tolerance = computeTolerance(stats.stddev);
            const firstSeen = Math.min(...g.epochs);
            const lastSeen = Math.max(...g.epochs);
            const existed = !!checkExisting.get(g.user_id, g.place_id, g.kind, g.day_of_week);

            upsert.run(
                g.user_id, g.circle_id, g.place_id, g.kind, g.day_of_week,
                stats.median, tolerance, g.sampleCount, confidence,
                firstSeen, lastSeen, now, now,
            );

            if (existed) routinesUpdated++;
            else routinesCreated++;
        }

        for (const g of dwellGroups.values()) {
            const stats = computeStats(g.minutes);
            if (!stats) continue;
            const dwellStats = computeStats(g.dwellDurations);
            if (!dwellStats) continue;
            const confidence = computeConfidence(dwellStats.stddev, dwellStats.sampleCount);
            if (confidence < 0.7) continue;

            const tolerance = computeTolerance(dwellStats.stddev);
            const firstSeen = Math.min(...g.epochs);
            const lastSeen = Math.max(...g.epochs);
            const existed = !!checkExisting.get(g.user_id, g.place_id, 'dwell', g.day_of_week);

            upsertDwell.run(
                g.user_id, g.circle_id, g.place_id, g.day_of_week,
                stats.median, dwellStats.median, tolerance, dwellStats.sampleCount, confidence,
                firstSeen, lastSeen, now, now,
            );

            if (existed) routinesUpdated++;
            else routinesCreated++;
        }

        const deact = db.prepare(`
            UPDATE routines SET active = 0, updated_at = ?
            WHERE source = 'auto' AND active = 1 AND last_seen_at < ?
        `);
        const deactResult = deact.run(now, now - DEACTIVATION_AGE_MS);

        return { routinesCreated, routinesUpdated, routinesDeactivated: deactResult.changes };
    })();

    const deactCount = db.prepare(`
        SELECT COUNT(*) AS c FROM routines WHERE source = 'auto' AND active = 0 AND updated_at = ?
    `).get(now)?.c ?? 0;

    return { routinesCreated, routinesUpdated, routinesDeactivated: deactCount };
}

function pushObs(groups, userId, circleId, placeId, kind, dayOfWeek, minute, epoch) {
    const key = `${userId}:${placeId}:${kind}:${dayOfWeek}`;
    let g = groups.get(key);
    if (!g) {
        g = { user_id: userId, circle_id: circleId, place_id: placeId, kind, day_of_week: dayOfWeek, minutes: [], epochs: [], sampleCount: 0 };
        groups.set(key, g);
    }
    g.minutes.push(minute);
    g.epochs.push(epoch);
    g.sampleCount++;
}

function pushDwellObs(groups, userId, circleId, placeId, dayOfWeek, startMinute, dwellDuration, epoch) {
    const key = `${userId}:${placeId}:dwell:${dayOfWeek}`;
    let g = groups.get(key);
    if (!g) {
        g = { user_id: userId, circle_id: circleId, place_id: placeId, day_of_week: dayOfWeek, minutes: [], dwellDurations: [], epochs: [], sampleCount: 0 };
        groups.set(key, g);
    }
    g.minutes.push(startMinute);
    g.dwellDurations.push(dwellDuration);
    g.epochs.push(epoch);
    g.sampleCount++;
}

export function evaluateRoutineSweep(db, now = Date.now()) {
    db_ref = db;
    const OBSERVATION_MS = 7 * 24 * 60 * 60 * 1000;
    const FIRING_WINDOW_MIN = 60;

    const routines = db.prepare(`
        SELECT r.id, r.user_id, r.circle_id, r.place_id, r.kind,
               r.expected_minute, r.tolerance_minutes, r.day_of_week,
               r.created_at,
               u.paused_until,
               u.display_name AS displayName,
               p.name AS placeName,
               ap.routines_enabled,
               ap.routines_quiet_start,
               ap.routines_quiet_end
        FROM routines r
        JOIN users u ON u.id = r.user_id
        JOIN places p ON p.id = r.place_id
        LEFT JOIN alert_prefs ap ON ap.user_id = r.user_id
        WHERE r.active = 1
          AND r.created_at < ?
    `).all(now - OBSERVATION_MS);

    const insertAlert = db.prepare(`
        INSERT INTO routine_alerts (routine_id, user_id, circle_id, kind, fired_at, fired_local_date,
                                    expected_minute, actual_minute, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, kind, fired_local_date) DO NOTHING
    `);

    const getUserLng = db.prepare(
        `SELECT lng FROM locations WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 1`
    );

    for (const r of routines) {
        if (r.paused_until && r.paused_until > now) continue;
        if (r.routines_enabled === 0) continue;

        const lngRow = getUserLng.get(r.user_id);
        const lng = lngRow?.lng ?? 0;
        const local = estimateLocalMinute(lng, now);

        if (local.dayOfWeek !== r.day_of_week) continue;

        if (inQuietHoursLocal(r.routines_quiet_start, r.routines_quiet_end, local.minute)) continue;

        const tolerance = r.tolerance_minutes;
        const expected = r.expected_minute;

        if (r.kind !== 'dwell') {
            const fireStart = expected + tolerance;
            const fireEnd = fireStart + FIRING_WINDOW_MIN;
            if (local.minute < fireStart || local.minute >= fireEnd) continue;
        }

        const localDate = localDateFromLng(lng, now);

        if (r.kind === 'arrival') {
            const { epochStart, epochEnd } = todayEpochRange(lng, now, expected, tolerance);
            const visit = db.prepare(`
                SELECT started_at FROM visits
                WHERE user_id = ? AND place_id = ? AND started_at >= ? AND started_at <= ?
                LIMIT 1
            `).get(r.user_id, r.place_id, epochStart, epochEnd);

            if (visit) continue;

            const result = insertAlert.run(
                r.id, r.user_id, r.circle_id, 'missed_arrival',
                now, localDate, expected, null, now,
            );
            if (result.changes > 0) {
                emitDeviation(db, r, 'missed_arrival', expected, null);
            }
        } else if (r.kind === 'departure') {
            const { epochStart, epochEnd } = todayEpochRange(lng, now, expected, tolerance);
            const stillInside = db.prepare(`
                SELECT 1 FROM visits
                WHERE user_id = ? AND place_id = ?
                  AND started_at < ?
                  AND (ended_at IS NULL OR ended_at > ?)
                LIMIT 1
            `).get(r.user_id, r.place_id, epochStart, epochEnd);

            if (!stillInside) continue;

            const result = insertAlert.run(
                r.id, r.user_id, r.circle_id, 'overstay',
                now, localDate, expected, null, now,
            );
            if (result.changes > 0) {
                emitDeviation(db, r, 'overstay', expected, null);
            }
        } else if (r.kind === 'dwell') {
            const { epochStart } = todayEpochRange(lng, now, expected, tolerance);
            const dwellMinutes = r.expected_dwell_minutes || 120;
            const expectedCloseEpoch = epochStart + (dwellMinutes + tolerance) * 60 * 1000;
            const fireWindowEnd = expectedCloseEpoch + FIRING_WINDOW_MIN * 60 * 1000;
            if (now < expectedCloseEpoch) continue;
            if (now >= fireWindowEnd) continue;

            const visit = db.prepare(`
                SELECT started_at FROM visits
                WHERE user_id = ? AND place_id = ? AND started_at >= ? AND started_at <= ?
                  AND (ended_at IS NULL OR ended_at > ?)
                LIMIT 1
            `).get(r.user_id, r.place_id, epochStart - tolerance * 60 * 1000, epochStart + tolerance * 60 * 1000, expectedCloseEpoch);

            if (!visit) continue;

            const actualDwell = Math.round((now - visit.started_at) / 60000);
            const result = insertAlert.run(
                r.id, r.user_id, r.circle_id, 'overstay_dwell',
                now, localDate, expected, actualDwell, now,
            );
            if (result.changes > 0) {
                emitDeviation(db, r, 'overstay_dwell', expected, null);
            }
        }
    }
}

function localDateFromLng(lng, nowMs) {
    const utcOffsetH = Math.round((lng ?? 0) / 15);
    const d = new Date(nowMs + utcOffsetH * 3600000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function todayEpochRange(lng, nowMs, expectedMinute, tolerance) {
    const utcOffsetH = Math.round((lng ?? 0) / 15);
    const offsetMs = utcOffsetH * 3600000;
    const d = new Date(nowMs + offsetMs);
    const midnightUtcMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - offsetMs;
    const epochStart = midnightUtcMs + (expectedMinute - tolerance) * 60 * 1000;
    const epochEnd = midnightUtcMs + (expectedMinute + tolerance) * 60 * 1000;
    return { epochStart, epochEnd };
}

function emitDeviation(db, r, alertKind, expectedMinute, actualMinute) {
    const ev = {
        type: 'routine_deviation',
        userId: r.user_id,
        displayName: r.displayName,
        routineId: r.id,
        placeId: r.place_id,
        placeName: r.placeName,
        kind: alertKind,
        expectedMinute,
        actualMinute,
    };
    deviationBundler.enqueue(`routine:${r.circle_id}`, ev, flushBundle);
}

export function getUpcomingRoutines(db, circleId, withinMinutes, now = Date.now()) {
    const routines = db.prepare(`
        SELECT r.user_id, r.place_id, r.kind, r.expected_minute, r.tolerance_minutes,
               r.day_of_week, r.active,
               u.display_name AS displayName,
               u.photo_path AS photoPath,
               u.paused_until,
               p.name AS placeName
        FROM routines r
        JOIN users u ON u.id = r.user_id
        JOIN places p ON p.id = r.place_id
        JOIN circle_members cm ON cm.user_id = r.user_id AND cm.circle_id = ?
        WHERE r.circle_id = ? AND r.active = 1
    `).all(circleId, circleId);

    const results = [];
    const windowMs = withinMinutes * 60 * 1000;

    for (const r of routines) {
        if (r.paused_until && r.paused_until > now) continue;
        const lngRow = db.prepare(
            `SELECT lng FROM locations WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 1`
        ).get(r.user_id);
        const lng = lngRow?.lng ?? 0;
        const local = estimateLocalMinute(lng, now);

        for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
            const targetDow = (local.dayOfWeek + dayOffset) % 7;
            if (r.day_of_week !== targetDow) continue;

            const utcOffsetH = Math.round(lng / 15);
            const offsetMs = utcOffsetH * 3600000;
            const d = new Date(now + offsetMs);
            const baseMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - offsetMs;
            const targetMidnight = baseMidnight + dayOffset * 24 * 60 * 60 * 1000;
            const expectedAt = targetMidnight + r.expected_minute * 60 * 1000;

            if (expectedAt <= now) continue;
            if (expectedAt - now > windowMs) continue;

            results.push({
                userId: r.user_id,
                displayName: r.displayName,
                photoUrl: r.photoPath ? `/api/users/${r.user_id}/photo` : null,
                placeId: r.place_id,
                placeName: r.placeName,
                kind: r.kind,
                expectedMinute: r.expected_minute,
                expectedAt,
            });
        }
    }

    results.sort((a, b) => a.expectedAt - b.expectedAt);
    return results;
}
