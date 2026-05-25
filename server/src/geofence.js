// Geofence enter/exit detection. Called from POST /api/locations.
import { publish } from './hub.js';
import { fanOutToUsers } from './fcm.js';
import { isSnoozed } from './lib/snooze.js';

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
 *
 * `onTransition`, if provided, is called for every transition regardless of
 * the place's alert configuration. Used by the visit engine to track
 * arrivals/departures even when geofence alerts are disabled.
 */
export function inQuietHours(start, end, nowMs) {
    if (start == null || end == null) return false;
    const d = new Date(nowMs);
    const minute = d.getHours() * 60 + d.getMinutes();
    return start <= end
        ? (minute >= start && minute < end)
        : (minute >= start || minute < end);
}

export function reconcileGeofences(db, { userId, circleId, displayName, lat, lng, recordedAt }, onTransition) {
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
    const transitions = [];

    // All presence-table writes for a single fix must be atomic; otherwise a
    // crash mid-loop leaves presence inconsistent with the location row.
    const reconcile = db.transaction(() => {
        for (const p of places) {
            const dist = haversineMeters(lat, lng, p.lat, p.lng);
            const inside = dist <= p.radius_m;
            const wasInside = insidePresence.has(p.id);

            if (inside && !wasInside) {
                insertPresence.run(userId, p.id, recordedAt);
                const transition = {
                    type: 'geofence_enter',
                    userId,
                    displayName,
                    placeId: p.id,
                    placeName: p.name,
                    distanceM: dist,
                    recordedAt,
                };
                transitions.push(transition);
                if (p.alerts_on_enter) events.push(transition);
            } else if (!inside && wasInside) {
                deletePresence.run(userId, p.id);
                const transition = {
                    type: 'geofence_exit',
                    userId,
                    displayName,
                    placeId: p.id,
                    placeName: p.name,
                    distanceM: dist,
                    recordedAt,
                };
                transitions.push(transition);
                if (p.alerts_on_exit) events.push(transition);
            }
        }
    });
    reconcile();

    const findSubs = db.prepare(`
        SELECT ps.user_id, ps.quiet_start, ps.quiet_end
        FROM place_subscriptions ps
        WHERE ps.place_id = ?
          AND (ps.member_id IS NULL OR ps.member_id = ?)
          AND ((? = 'geofence_enter' AND ps.on_enter = 1)
            OR (? = 'geofence_exit'  AND ps.on_exit  = 1))
    `);
    for (const ev of events) {
        const subs = findSubs.all(ev.placeId, ev.userId, ev.type, ev.type);
        ev.notifyUserIds = subs
            .filter(s => !inQuietHours(s.quiet_start, s.quiet_end, recordedAt) && !isSnoozed(db, s.user_id, ev.type))
            .map(s => s.user_id);
    }

    for (const ev of events) publish(circleId, ev);
    for (const ev of events) fanOutToUsers(ev.notifyUserIds, ev, db);
    if (typeof onTransition === 'function') {
        for (const t of transitions) onTransition(t);
    }
    return events;
}
