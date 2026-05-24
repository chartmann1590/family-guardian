import { computeDrivingScore } from './drivingScore.js';

export function buildDigest(db, circleId, weekStartMs, weekEndMs) {
    const members = db.prepare(`
        SELECT u.id AS userId, u.display_name AS displayName
        FROM circle_members cm
        JOIN users u ON u.id = cm.user_id
        WHERE cm.circle_id = ?
    `).all(circleId);

    const perMember = members.map(m => {
        const trips = db.prepare(`
            SELECT COUNT(*) AS tripCount, COALESCE(SUM(distance_m), 0) AS totalDistanceM,
                   COALESCE(MAX(max_speed_mps), 0) AS maxSpeed
            FROM trips WHERE user_id = ? AND circle_id = ? AND mode = 'driving'
              AND ended_at IS NOT NULL AND ended_at >= ? AND ended_at < ?
        `).get(m.userId, circleId, weekStartMs, weekEndMs);

        const visits = db.prepare(`
            SELECT COUNT(*) AS visitCount FROM visits
            WHERE user_id = ? AND circle_id = ? AND started_at >= ? AND started_at < ?
        `).get(m.userId, circleId, weekStartMs, weekEndMs);

        const topPlaces = db.prepare(`
            SELECT p.name AS placeName, SUM(v.ended_at - v.started_at) AS dwellMs
            FROM visits v JOIN places p ON p.id = v.place_id
            WHERE v.user_id = ? AND v.circle_id = ? AND v.started_at >= ? AND v.started_at < ?
              AND v.ended_at IS NOT NULL
            GROUP BY v.place_id ORDER BY dwellMs DESC LIMIT 3
        `).all(m.userId, circleId, weekStartMs, weekEndMs);

        const routineFires = db.prepare(`
            SELECT COUNT(*) AS cnt FROM routine_alerts
            WHERE user_id = ? AND circle_id = ? AND fired_at >= ? AND fired_at < ?
        `).get(m.userId, circleId, weekStartMs, weekEndMs);

        const score = computeDrivingScore(db, m.userId, weekStartMs);

        const checkins = db.prepare(`
            SELECT COUNT(*) AS cnt FROM check_ins
            WHERE user_id = ? AND circle_id = ? AND created_at >= ? AND created_at < ?
        `).get(m.userId, circleId, weekStartMs, weekEndMs);

        return {
            userId: m.userId,
            displayName: m.displayName,
            tripCount: trips.tripCount,
            totalDistanceM: trips.totalDistanceM,
            maxSpeed: trips.maxSpeed,
            visitCount: visits.visitCount,
            topPlaces: topPlaces.map(p => ({ placeName: p.placeName, dwellMs: p.dwellMs })),
            routineAlerts: routineFires.cnt,
            drivingScore: score.score,
            checkinCount: checkins.cnt,
        };
    });

    const totalKm = perMember.reduce((s, m) => s + m.totalDistanceM, 0) / 1000;
    const totalAlerts = perMember.reduce((s, m) => s + m.routineAlerts, 0);

    let busiestPlace = null;
    const placeAgg = db.prepare(`
        SELECT p.name AS placeName, COUNT(*) AS cnt FROM visits v
        JOIN places p ON p.id = v.place_id
        WHERE v.circle_id = ? AND v.started_at >= ? AND v.started_at < ?
        GROUP BY v.place_id ORDER BY cnt DESC LIMIT 1
    `).get(circleId, weekStartMs, weekEndMs);
    if (placeAgg) busiestPlace = placeAgg.placeName;

    const quietest = perMember.length > 0
        ? perMember.reduce((min, m) => m.visitCount + m.tripCount < min.visitCount + min.tripCount ? m : min).displayName
        : null;

    return {
        weekStart: weekStartMs,
        weekEnd: weekEndMs,
        perMember,
        totalKm: Math.round(totalKm),
        totalAlerts,
        busiestPlace,
        quietestMember: quietest,
    };
}

export function persistDigest(db, circleId, weekStartMs, weekEndMs, summary) {
    db.prepare(`
        INSERT OR REPLACE INTO digest_snapshots (circle_id, week_start, week_end, summary_json, created_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(circleId, weekStartMs, weekEndMs, JSON.stringify(summary), Date.now());
}
