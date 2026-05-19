// Visit / dwell detection. Called from POST /api/locations after geofence
// reconciliation. A "visit" is a stationary period at a single location: it
// can be anchored to a known geofence (place_id set) or be an auto-detected
// stay (place_id null, lat/lng = visit centre).
//
// The live "open visit per user" state lives in memory (built from
// visits WHERE ended_at IS NULL at boot). Persisted as soon as a visit closes.

import { publish } from './hub.js';
import { fanOut } from './fcm.js';
import { haversineMeters } from './geofence.js';
import { enqueueGeocode } from './geocoder.js';

const STAY_RADIUS_M = 75;
const STAY_SPEED_MPS = 1.4;          // ~walking pace; below this we consider the user stationary
const MIN_VISIT_DURATION_MS = 5 * 60_000;
const LEAVE_FIX_COUNT = 2;

// userId -> { id, lat, lng, startedAt, lastSeenAt, pointCount, placeId, leaveStreak }
const liveVisits = new Map();

export function loadOpenVisits(db) {
    liveVisits.clear();
    const rows = db
        .prepare(
            `SELECT id, user_id AS userId, place_id AS placeId, lat, lng,
                    started_at AS startedAt, point_count AS pointCount
             FROM visits WHERE ended_at IS NULL`,
        )
        .all();
    for (const r of rows) {
        liveVisits.set(r.userId, {
            id: r.id,
            placeId: r.placeId ?? null,
            lat: r.lat,
            lng: r.lng,
            startedAt: r.startedAt,
            lastSeenAt: r.startedAt,
            pointCount: r.pointCount,
            leaveStreak: 0,
        });
    }
}

export function getOpenVisit(userId) {
    return liveVisits.get(userId) || null;
}

/**
 * Process a single location fix for visit detection.
 *  - geofenceEvents: array returned by reconcileGeofences; we use enters to anchor
 *    a visit to a known place, exits to close it.
 */
export function onLocationFix(db, fix, geofenceEvents = []) {
    const { userId, circleId, displayName, lat, lng, speedMps, recordedAt } = fix;

    // 1) Geofence-driven transitions take priority.
    for (const ev of geofenceEvents) {
        if (ev.userId !== userId) continue;
        if (ev.type === 'geofence_enter') {
            openVisitAtPlace(db, { userId, circleId, placeId: ev.placeId, lat, lng, recordedAt });
            return;
        }
        if (ev.type === 'geofence_exit') {
            const closed = closeVisitForUser(db, userId, recordedAt, { circleId, displayName });
            if (closed) return;
        }
    }

    const live = liveVisits.get(userId);
    const moving = (speedMps ?? 0) >= STAY_SPEED_MPS;

    if (live) {
        const distFromCentre = haversineMeters(lat, lng, live.lat, live.lng);
        if (!moving && distFromCentre <= STAY_RADIUS_M) {
            // Still inside the dwell radius and slow. Update aggregates.
            live.lastSeenAt = recordedAt;
            live.pointCount += 1;
            live.leaveStreak = 0;
            db.prepare(
                'UPDATE visits SET point_count = ? WHERE id = ?',
            ).run(live.pointCount, live.id);
            // For an auto-detected visit, drift the centre slightly toward the running mean.
            if (live.placeId == null) {
                const w = 1 / Math.max(live.pointCount, 1);
                live.lat = live.lat * (1 - w) + lat * w;
                live.lng = live.lng * (1 - w) + lng * w;
                db.prepare('UPDATE visits SET lat = ?, lng = ? WHERE id = ?').run(live.lat, live.lng, live.id);
            }
        } else {
            live.leaveStreak += 1;
            if (live.leaveStreak >= LEAVE_FIX_COUNT) {
                closeVisitForUser(db, userId, live.lastSeenAt, { circleId, displayName });
            }
        }
        return;
    }

    // No live visit; if we're slow, open an auto-detected stay.
    if (!moving) {
        const ins = db.prepare(
            `INSERT INTO visits (user_id, circle_id, place_id, lat, lng, started_at, point_count)
             VALUES (?, ?, NULL, ?, ?, ?, 1)`,
        ).run(userId, circleId, lat, lng, recordedAt);
        liveVisits.set(userId, {
            id: Number(ins.lastInsertRowid),
            placeId: null,
            lat,
            lng,
            startedAt: recordedAt,
            lastSeenAt: recordedAt,
            pointCount: 1,
            leaveStreak: 0,
        });
    }
}

function openVisitAtPlace(db, { userId, circleId, placeId, lat, lng, recordedAt }) {
    const existing = liveVisits.get(userId);
    if (existing) {
        // Already inside a visit (maybe an auto-stay). Re-anchor to the known place.
        if (existing.placeId !== placeId) {
            db.prepare('UPDATE visits SET place_id = ? WHERE id = ?').run(placeId, existing.id);
            existing.placeId = placeId;
        }
        existing.leaveStreak = 0;
        return;
    }
    const ins = db.prepare(
        `INSERT INTO visits (user_id, circle_id, place_id, lat, lng, started_at, point_count)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
    ).run(userId, circleId, placeId, lat, lng, recordedAt);
    liveVisits.set(userId, {
        id: Number(ins.lastInsertRowid),
        placeId,
        lat,
        lng,
        startedAt: recordedAt,
        lastSeenAt: recordedAt,
        pointCount: 1,
        leaveStreak: 0,
    });
}

function closeVisitForUser(db, userId, endedAt, { circleId, displayName }) {
    const live = liveVisits.get(userId);
    if (!live) return false;
    liveVisits.delete(userId);
    const duration = endedAt - live.startedAt;
    if (duration < MIN_VISIT_DURATION_MS) {
        db.prepare('DELETE FROM visits WHERE id = ?').run(live.id);
        return true;
    }
    db.prepare('UPDATE visits SET ended_at = ? WHERE id = ?').run(endedAt, live.id);

    // Reverse-geocode auto-detected visits (place visits get the place name elsewhere).
    if (live.placeId == null) {
        enqueueGeocode(db, live.lat, live.lng, (label) => {
            if (label) {
                db.prepare('UPDATE visits SET label = ? WHERE id = ?').run(label, live.id);
                publish(circleId, {
                    type: 'visit_end',
                    userId,
                    displayName,
                    visitId: live.id,
                    placeId: null,
                    label,
                    lat: live.lat,
                    lng: live.lng,
                    startedAt: live.startedAt,
                    endedAt,
                    durationMs: duration,
                });
            }
        });
    }

    const ev = {
        type: 'visit_end',
        userId,
        displayName,
        visitId: live.id,
        placeId: live.placeId,
        label: null,
        lat: live.lat,
        lng: live.lng,
        startedAt: live.startedAt,
        endedAt,
        durationMs: duration,
    };
    publish(circleId, ev);
    fanOut(circleId, ev, db, userId);
    return true;
}
