// Trip aggregation. A "trip" is the inverse of a visit: an active movement
// segment that starts when the user leaves a visit and ends when they enter
// a new one. Trips are persisted only on close, and discarded if too short.

import { haversineMeters } from './geofence.js';
import { getOpenVisit } from './visits.js';
import { enqueueGeocode } from './geocoder.js';
import { publish } from './hub.js';
import { recordTripEvents } from './drivingScore.js';

const MOVING_SPEED_MPS = 1.4;
const MIN_TRIP_DURATION_MS = 60_000;
const MIN_TRIP_DISTANCE_M = 100;

// userId -> { id, startedAt, lastLat, lastLng, lastAt, distance, maxSpeed,
//             sumSpeed, sumSpeedCount, activityCounts, startLat, startLng,
//             lastSpeedMps, lastRecordedAt, circleId, displayName }
const liveTrips = new Map();

export function loadOpenTrips(db) {
    liveTrips.clear();
    const rows = db
        .prepare(
            `SELECT id, user_id AS userId, started_at AS startedAt,
                    start_lat AS startLat, start_lng AS startLng,
                    distance_m AS distance, max_speed_mps AS maxSpeed,
                    avg_speed_mps AS avgSpeed
             FROM trips WHERE ended_at IS NULL`,
        )
        .all();
    for (const r of rows) {
        liveTrips.set(r.userId, {
            id: r.id,
            startedAt: r.startedAt,
            lastLat: r.startLat,
            lastLng: r.startLng,
            lastAt: r.startedAt,
            distance: r.distance ?? 0,
            maxSpeed: r.maxSpeed ?? 0,
            sumSpeed: r.avgSpeed ?? 0,
            sumSpeedCount: r.avgSpeed != null ? 1 : 0,
            activityCounts: new Map(),
            startLat: r.startLat,
            startLng: r.startLng,
            circleId: null,
            displayName: null,
            lastSpeedMps: null,
            lastRecordedAt: null,
        });
    }
}

export function onLocationFix(db, fix) {
    const { userId, circleId, displayName, lat, lng, speedMps, activity, recordedAt } = fix;
    const inVisit = getOpenVisit(userId) != null;
    const live = liveTrips.get(userId);

    if (inVisit) {
        if (live) closeTrip(db, userId, recordedAt);
        return;
    }

    const moving = (speedMps ?? 0) >= MOVING_SPEED_MPS;

    if (!live) {
        if (!moving) return;
        const ins = db.prepare(
            `INSERT INTO trips (user_id, circle_id, started_at, mode, distance_m,
                                max_speed_mps, avg_speed_mps, start_lat, start_lng)
             VALUES (?, ?, ?, 'mixed', 0, ?, ?, ?, ?)`,
        ).run(userId, circleId, recordedAt, speedMps ?? null, speedMps ?? null, lat, lng);
        const fresh = {
            id: Number(ins.lastInsertRowid),
            startedAt: recordedAt,
            lastLat: lat,
            lastLng: lng,
            lastAt: recordedAt,
            distance: 0,
            maxSpeed: speedMps ?? 0,
            sumSpeed: speedMps ?? 0,
            sumSpeedCount: speedMps != null ? 1 : 0,
            activityCounts: new Map(),
            startLat: lat,
            startLng: lng,
            circleId,
            displayName,
            lastSpeedMps: speedMps ?? null,
            lastRecordedAt: recordedAt,
        };
        if (activity) fresh.activityCounts.set(activity, 1);
        liveTrips.set(userId, fresh);
        return;
    }

    // Already in a trip: update aggregates.
    const prevFix = { speedMps: live.lastSpeedMps, recordedAt: live.lastRecordedAt, lat: live.lastLat, lng: live.lastLng };
    const segment = haversineMeters(live.lastLat, live.lastLng, lat, lng);
    live.distance += segment;
    live.lastLat = lat;
    live.lastLng = lng;
    live.lastAt = recordedAt;
    if (speedMps != null) {
        if (speedMps > live.maxSpeed) live.maxSpeed = speedMps;
        live.sumSpeed += speedMps;
        live.sumSpeedCount += 1;
    }
    if (activity) {
        live.activityCounts.set(activity, (live.activityCounts.get(activity) ?? 0) + 1);
    }
    live.circleId = circleId;
    live.displayName = displayName;
    db.prepare(
        `UPDATE trips SET distance_m = ?, max_speed_mps = ?, avg_speed_mps = ?,
                          end_lat = ?, end_lng = ?
         WHERE id = ?`,
    ).run(
        live.distance,
        live.maxSpeed,
        live.sumSpeedCount > 0 ? live.sumSpeed / live.sumSpeedCount : null,
        lat,
        lng,
        live.id,
    );

    recordTripEvents(db, live, { userId, lat, lng, speedMps, activity, recordedAt }, prevFix);
    live.lastSpeedMps = speedMps ?? null;
    live.lastRecordedAt = recordedAt;
}

function closeTrip(db, userId, endedAt) {
    const live = liveTrips.get(userId);
    if (!live) return;
    liveTrips.delete(userId);
    const duration = endedAt - live.startedAt;
    if (duration < MIN_TRIP_DURATION_MS || live.distance < MIN_TRIP_DISTANCE_M) {
        db.prepare('DELETE FROM trips WHERE id = ?').run(live.id);
        return;
    }
    const mode = pickMode(live.activityCounts, live.maxSpeed);
    db.prepare(
        `UPDATE trips SET ended_at = ?, mode = ? WHERE id = ?`,
    ).run(endedAt, mode, live.id);

    // Geocode start + end labels asynchronously.
    enqueueGeocode(db, live.startLat, live.startLng, (label) => {
        if (label) db.prepare('UPDATE trips SET start_label = ? WHERE id = ?').run(label, live.id);
    });
    enqueueGeocode(db, live.lastLat, live.lastLng, (label) => {
        if (label) db.prepare('UPDATE trips SET end_label = ? WHERE id = ?').run(label, live.id);
    });

    if (live.circleId != null) {
        publish(live.circleId, {
            type: 'trip_end',
            userId,
            displayName: live.displayName,
            tripId: live.id,
            mode,
            distanceM: live.distance,
            maxSpeedMps: live.maxSpeed,
            avgSpeedMps: live.sumSpeedCount > 0 ? live.sumSpeed / live.sumSpeedCount : null,
            startedAt: live.startedAt,
            endedAt,
        });
        publish(live.circleId, { type: 'driving_score_updated', userId });
    }
}

function pickMode(counts, maxSpeedMps) {
    let total = 0;
    let topKey = null;
    let topCount = 0;
    for (const [k, v] of counts) {
        total += v;
        if (v > topCount) { topCount = v; topKey = k; }
    }
    if (total === 0) {
        if (maxSpeedMps >= 7) return 'driving';
        if (maxSpeedMps >= 2.5) return 'running';
        return 'walking';
    }
    if (topCount / total >= 0.7 && topKey && topKey !== 'still' && topKey !== 'unknown') {
        return topKey;
    }
    return 'mixed';
}
