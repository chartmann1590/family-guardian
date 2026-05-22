import { haversineMeters } from './geofence.js';

const HARD_BRAKE_DECEL_MPS = 3.5;
const HARD_BRAKE_DELTA_T_MS = 6000;
const HARD_BRAKE_COOLDOWN_MS = 8000;

const insertEvent = (db) =>
    db.prepare(
        `INSERT INTO trip_events (trip_id, user_id, kind, occurred_at, value, lat, lng, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

const lastEventByKind = (db) =>
    db.prepare(
        `SELECT occurred_at, value, id FROM trip_events
         WHERE trip_id = ? AND kind = ? ORDER BY occurred_at DESC LIMIT 1`,
    );

const getSpeedingThreshold = (db) =>
    db.prepare(
        `SELECT speeding_threshold_mps FROM alert_prefs WHERE user_id = ?`,
    );

function ensureAlertPrefs(db, userId) {
    let row = getSpeedingThreshold(db).get(userId);
    if (!row) {
        db.prepare('INSERT INTO alert_prefs (user_id) VALUES (?)').run(userId);
        row = getSpeedingThreshold(db).get(userId);
    }
    return row.speeding_threshold_mps ?? 35.76; // ~80 mph default
}

export function recordTripEvents(db, live, fix, prevFix) {
    if (!prevFix || prevFix.speedMps == null || fix.speedMps == null) return;
    if (!live || !live.id) return;

    const deltaT = fix.recordedAt - prevFix.recordedAt;
    if (deltaT <= 0 || deltaT > 60000) return;

    const speedDelta = prevFix.speedMps - fix.speedMps;
    if (speedDelta >= HARD_BRAKE_DECEL_MPS && deltaT <= HARD_BRAKE_DELTA_T_MS) {
        const last = lastEventByKind(db).get(live.id, 'hard_brake');
        if (!last || (fix.recordedAt - last.occurred_at) >= HARD_BRAKE_COOLDOWN_MS) {
            const decel = speedDelta / (deltaT / 1000);
            insertEvent(db).run(
                live.id, fix.userId, 'hard_brake', fix.recordedAt,
                decel, fix.lat, fix.lng,
                JSON.stringify({ deltaV: Math.round(speedDelta * 100) / 100, deltaT }),
            );
        }
    }

    const threshold = ensureAlertPrefs(db, fix.userId);
    const lastSpeed = prevFix.speedMps;
    const curSpeed = fix.speedMps;
    if (lastSpeed < threshold && curSpeed >= threshold) {
        insertEvent(db).run(
            live.id, fix.userId, 'speeding_start', fix.recordedAt,
            curSpeed, fix.lat, fix.lng, null,
        );
    } else if (lastSpeed >= threshold && curSpeed < threshold) {
        const lastStart = lastEventByKind(db).get(live.id, 'speeding_start');
        if (lastStart) {
            insertEvent(db).run(
                live.id, fix.userId, 'speeding_end', fix.recordedAt,
                curSpeed, fix.lat, fix.lng, null,
            );
        }
    }

    const lngDeg = fix.lng ?? 0;
    const utcOffsetH = Math.round(lngDeg / 15);
    const utcMs = fix.recordedAt;
    const localH = new Date(utcMs + utcOffsetH * 3600000).getUTCHours();
    const isNight = localH >= 22 || localH < 6;

    if (isNight && prevFix.lat != null && fix.lat != null) {
        const segDist = haversineMeters(prevFix.lat, prevFix.lng, fix.lat, fix.lng);
        const lastNight = lastEventByKind(db).get(live.id, 'night_segment');
        if (lastNight && (fix.recordedAt - lastNight.occurred_at) < 60000) {
            db.prepare('UPDATE trip_events SET value = ?, occurred_at = ? WHERE id = ?')
                .run((lastNight.value ?? 0) + segDist, fix.recordedAt, lastNight.id);
        } else {
            insertEvent(db).run(
                live.id, fix.userId, 'night_segment', fix.recordedAt,
                segDist, fix.lat, fix.lng, null,
            );
        }
    }
}

export function computeDrivingScore(db, userId, sinceMs) {
    const trips = db.prepare(
        `SELECT id, started_at, ended_at, distance_m, max_speed_mps
         FROM trips
         WHERE user_id = ? AND mode = 'driving' AND ended_at IS NOT NULL AND ended_at >= ?`,
    ).all(userId, sinceMs);

    const tripCount = trips.length;
    if (tripCount === 0) {
        return {
            score: null,
            days: Math.round((Date.now() - sinceMs) / 86400000),
            tripCount: 0,
            drivingMs: 0,
            distanceM: 0,
            hardBrakeCount: 0,
            hardBrakePer100Km: 0,
            speedingMinutes: 0,
            speedingThresholdMps: 0,
            nightMiles: 0,
            nightDrivingPct: 0,
        };
    }

    const drivingMs = trips.reduce((sum, t) => sum + (t.ended_at - t.started_at), 0);
    const distanceM = trips.reduce((sum, t) => sum + (t.distance_m ?? 0), 0);

    const hardBrakes = db.prepare(
        `SELECT COUNT(*) AS cnt FROM trip_events
         WHERE user_id = ? AND kind = 'hard_brake' AND occurred_at >= ?`,
    ).get(userId, sinceMs);

    const distanceKm = distanceM / 1000;
    const hardBrakeCount = hardBrakes.cnt;
    const hardBrakePer100Km = distanceKm > 0 ? (hardBrakeCount / distanceKm) * 100 : 0;

    const speedingEvents = db.prepare(
        `SELECT kind, occurred_at FROM trip_events
         WHERE user_id = ? AND kind IN ('speeding_start', 'speeding_end') AND occurred_at >= ?
         ORDER BY occurred_at ASC`,
    ).all(userId, sinceMs);

    let speedingMinutes = 0;
    let openStart = null;
    for (const ev of speedingEvents) {
        if (ev.kind === 'speeding_start') {
            openStart = ev.occurred_at;
        } else if (ev.kind === 'speeding_end' && openStart != null) {
            speedingMinutes += (ev.occurred_at - openStart) / 60000;
            openStart = null;
        }
    }
    if (openStart != null) {
        const lastTrip = trips[trips.length - 1];
        speedingMinutes += ((lastTrip.ended_at ?? Date.now()) - openStart) / 60000;
    }

    const nightSegs = db.prepare(
        `SELECT COALESCE(SUM(value), 0) AS total FROM trip_events
         WHERE user_id = ? AND kind = 'night_segment' AND occurred_at >= ?`,
    ).get(userId, sinceMs);

    const nightMeters = nightSegs.total ?? 0;
    const nightMiles = nightMeters / 1609.34;
    const nightDrivingPct = distanceM > 0 ? nightMeters / distanceM : 0;

    const thresholdRow = db.prepare(
        `SELECT speeding_threshold_mps FROM alert_prefs WHERE user_id = ?`,
    ).get(userId);
    const speedingThresholdMps = thresholdRow?.speeding_threshold_mps ?? 35.76;

    const base = 100;
    const brakePenalty = Math.min(25, hardBrakePer100Km * 5);
    const drivingHours = Math.max(1, drivingMs / 3600000);
    const speedPenalty = Math.min(25, (speedingMinutes / drivingHours) * 4);
    const nightPenalty = Math.min(15, nightDrivingPct * 30);
    const shortDrivePenalty = drivingMs < 30 * 60000 ? 5 : 0;
    const score = Math.max(0, base - brakePenalty - speedPenalty - nightPenalty - shortDrivePenalty);

    return {
        score,
        days: Math.round((Date.now() - sinceMs) / 86400000),
        tripCount,
        drivingMs,
        distanceM,
        hardBrakeCount,
        hardBrakePer100Km: Math.round(hardBrakePer100Km * 100) / 100,
        speedingMinutes: Math.round(speedingMinutes * 100) / 100,
        speedingThresholdMps,
        nightMiles: Math.round(nightMiles * 100) / 100,
        nightDrivingPct: Math.round(nightDrivingPct * 1000) / 1000,
    };
}
