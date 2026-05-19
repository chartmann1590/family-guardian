// Geofence enter/exit detection. Called from POST /api/locations.
import { publish } from './hub.js';
import { fanOut } from './fcm.js';

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(lat1, lng1, lat2, lng2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * For a single user's new fix, compare against every place in their circle.
 * Insert / delete rows in place_presence to reflect transitions, and emit
 * `geofence_enter` / `geofence_exit` events on the circle's WS channel.
 */
export function reconcileGeofences(db, { userId, circleId, displayName, lat, lng, recordedAt }) {
    const places = db
        .prepare(
            `SELECT id, name, lat, lng, radius_m, alerts_on_enter, alerts_on_exit
             FROM places WHERE circle_id = ?`
        )
        .all(circleId);
    if (places.length === 0) return;

    const insidePresence = new Set(
        db
            .prepare('SELECT place_id FROM place_presence WHERE user_id = ?')
            .all(userId)
            .map((r) => r.place_id),
    );

    const insertPresence = db.prepare(
        'INSERT INTO place_presence (user_id, place_id, entered_at) VALUES (?, ?, ?)',
    );
    const deletePresence = db.prepare(
        'DELETE FROM place_presence WHERE user_id = ? AND place_id = ?',
    );

    const events = [];

    // All presence-table writes for a single fix must be atomic; otherwise a
    // crash mid-loop leaves presence inconsistent with the location row.
    const reconcile = db.transaction(() => {
        for (const p of places) {
            const dist = haversineMeters(lat, lng, p.lat, p.lng);
            const inside = dist <= p.radius_m;
            const wasInside = insidePresence.has(p.id);

            if (inside && !wasInside) {
                insertPresence.run(userId, p.id, recordedAt);
                if (p.alerts_on_enter) {
                    events.push({
                        type: 'geofence_enter',
                        userId,
                        displayName,
                        placeId: p.id,
                        placeName: p.name,
                        distanceM: dist,
                        recordedAt,
                    });
                }
            } else if (!inside && wasInside) {
                deletePresence.run(userId, p.id);
                if (p.alerts_on_exit) {
                    events.push({
                        type: 'geofence_exit',
                        userId,
                        displayName,
                        placeId: p.id,
                        placeName: p.name,
                        distanceM: dist,
                        recordedAt,
                    });
                }
            }
        }
    });
    reconcile();

    for (const ev of events) publish(circleId, ev);
    for (const ev of events) fanOut(circleId, ev, db, userId);
    return events;
}
