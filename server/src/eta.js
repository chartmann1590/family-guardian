import { publish } from './hub.js';
import { haversineMeters } from './geofence.js';

export function evaluateEtaTick(db) {
    const now = Date.now();
    const activeTrips = db.prepare(`
        SELECT t.id, t.user_id, t.circle_id, t.started_at, t.start_lat, t.start_lng, t.distance_m,
               t.max_speed_mps, u.display_name
        FROM trips t
        JOIN users u ON u.id = t.user_id
        WHERE t.ended_at IS NULL
    `).all();

    for (const trip of activeTrips) {
        const lastLoc = db.prepare(
            'SELECT lat, lng, speed_mps, recorded_at FROM locations WHERE user_id = ?'
        ).get(trip.user_id);
        if (!lastLoc) continue;

        let destination = null;
        const destShare = db.prepare(`
            SELECT destination_lat, destination_lng, destination_label
            FROM trip_share_tokens
            WHERE user_id = ? AND revoked = 0 AND expires_at > ?
            LIMIT 1
        `).get(trip.user_id, now);
        if (destShare && destShare.destination_lat != null) {
            destination = { lat: destShare.destination_lat, lng: destShare.destination_lng, label: destShare.destination_label };
        }

        if (!destination) {
            const soonArrival = db.prepare(`
                SELECT r.place_id, p.lat, p.lng, p.name, r.expected_minute, r.tolerance_minutes
                FROM routines r
                JOIN places p ON p.id = r.place_id
                WHERE r.user_id = ? AND r.kind = 'arrival' AND r.active = 1
                  AND ABS((r.expected_minute * 60000 + r.tolerance_minutes * 60000) - ?) < 90 * 60000
                LIMIT 1
            `).get(trip.user_id, now % (24 * 60 * 60000));
            if (soonArrival) {
                destination = { lat: soonArrival.lat, lng: soonArrival.lng, label: soonArrival.name };
            }
        }

        if (!destination) continue;

        const distM = haversineMeters(lastLoc.lat, lastLoc.lng, destination.lat, destination.lng);
        if (distM < 200) continue;

        const recentFixes = db.prepare(`
            SELECT lat, lng, speed_mps, recorded_at FROM locations
            WHERE user_id = ? AND recorded_at > ?
            ORDER BY recorded_at DESC LIMIT 10
        `).all(trip.user_id, now - 5 * 60 * 1000);

        let avgSpeedMps = 0;
        if (recentFixes.length >= 2) {
            const speeds = recentFixes.map(f => f.speed_mps).filter(s => s != null && s > 0);
            if (speeds.length > 0) avgSpeedMps = speeds.reduce((a, b) => a + b, 0) / speeds.length;
        }
        if (avgSpeedMps < 1) avgSpeedMps = lastLoc.speed_mps ?? 8;

        const etaMinutes = Math.round((distM / avgSpeedMps) / 60);
        const circleId = trip.circle_id;
        if (circleId == null) continue;

        publish(circleId, {
            type: 'eta_updated',
            userId: trip.user_id,
            displayName: trip.display_name,
            destLabel: destination.label,
            etaMinutes,
            distanceM: Math.round(distM),
        });
    }
}

export function evaluateArrivedSafely(db, userId, circleId, placeId) {
    const now = Date.now();
    const hasShare = db.prepare(`
        SELECT 1 FROM trip_share_tokens
        WHERE user_id = ? AND revoked = 0 AND expires_at > ?
          AND destination_lat IS NOT NULL
        LIMIT 1
    `).get(userId, now);

    const hasRoutine = db.prepare(`
        SELECT 1 FROM routines
        WHERE user_id = ? AND kind = 'arrival' AND active = 1 AND place_id = ?
        LIMIT 1
    `).get(userId, placeId);

    if (!hasShare && !hasRoutine) return;

    const displayName = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId)?.display_name;
    const place = db.prepare('SELECT name FROM places WHERE id = ?').get(placeId);

    publish(circleId, {
        type: 'arrived_safely',
        userId,
        displayName,
        placeId,
        placeName: place?.name,
        arrivedAt: now,
    });
}

export function coachingSummary(trip, tripEvents) {
    const tips = [];
    const strengths = [];
    const distanceMi = (trip.distance_m ?? 0) / 1609.34;

    const hardBrakes = tripEvents.filter(e => e.kind === 'hard_brake');
    const brakeDensity = distanceMi > 0 ? hardBrakes.length / (distanceMi / 10) : 0;
    if (brakeDensity >= 0.5) {
        tips.push('Watch following distance');
    } else if (hardBrakes.length === 0 && distanceMi > 1) {
        strengths.push('Smooth braking');
    }

    const speedingPairs = [];
    let speedStart = null;
    for (const e of tripEvents) {
        if (e.kind === 'speeding_start') speedStart = e;
        else if (e.kind === 'speeding_end' && speedStart) {
            speedingPairs.push({ start: speedStart, end: e });
            speedStart = null;
        }
    }
    const speedingMinutes = speedingPairs.reduce((sum, p) => {
        return sum + ((p.end.recorded_at ?? 0) - (p.start.recorded_at ?? 0)) / 60000;
    }, 0);
    if (speedingMinutes >= 5) {
        tips.push('Ease off the accelerator');
    } else if (speedingMinutes === 0) {
        strengths.push('No speeding');
    }

    const nightDistance = tripEvents
        .filter(e => e.kind === 'night_segment')
        .reduce((sum, e) => sum + (e.distance_m ?? 0), 0);
    const nightPct = (trip.distance_m ?? 0) > 0 ? nightDistance / trip.distance_m : 0;
    if (nightPct >= 0.5) {
        tips.push('Schedule daylight trips when possible');
    }

    if (tips.length === 0 && strengths.length === 0) {
        strengths.push('Smooth drive!');
    }

    const level = tips.length === 0 ? 'green' : tips.length <= 1 ? 'yellow' : 'red';
    return { tips, strengths, level };
}
