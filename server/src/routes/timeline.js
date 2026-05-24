import { requireAuth } from '../auth.js';
import { logView } from '../audit.js';

function assertMember(db, circleId, userId, reply) {
    const m = db
        .prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?')
        .get(circleId, userId);
    if (!m) { reply.code(403).send({ error: 'not_a_member' }); return false; }
    return true;
}

export default async function timelineRoutes(fastify, { db }) {
    fastify.get('/api/circles/:circleId/members/:userId/timeline', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        const circleId = Number(req.params.circleId);
        const targetUserId = Number(req.params.userId);
        if (!Number.isInteger(circleId) || !Number.isInteger(targetUserId)) {
            return reply.code(400).send({ error: 'invalid_params' });
        }

        if (!assertMember(db, circleId, req.auth.userId, reply)) return;
        if (!assertMember(db, circleId, targetUserId, reply)) return;

        const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
        const sinceMs = Date.now() - days * 86_400_000;
        const limit = Math.min(Number(req.query.limit) || 100, 200);
        const before = Number(req.query.before) || null;

        const visitRows = db.prepare(
            `SELECT 'visit_started' AS kind, v.id, v.started_at AS at_ms,
                    v.user_id, v.circle_id, v.place_id, p.name AS placeName,
                    v.lat, v.lng, v.label, v.started_at, NULL AS ended_at
             FROM visits v
             LEFT JOIN places p ON p.id = v.place_id
             WHERE v.user_id = ? AND v.circle_id = ? AND v.started_at >= ?
             ${before ? 'AND v.started_at < ?' : ''}
             UNION ALL
             SELECT 'visit_ended' AS kind, v.id, v.ended_at AS at_ms,
                    v.user_id, v.circle_id, v.place_id, p.name AS placeName,
                    v.lat, v.lng, v.label, v.started_at, v.ended_at
             FROM visits v
             LEFT JOIN places p ON p.id = v.place_id
             WHERE v.user_id = ? AND v.circle_id = ? AND v.ended_at IS NOT NULL AND v.ended_at >= ?
             ${before ? 'AND v.ended_at < ?' : ''}`,
        );

        const tripRows = db.prepare(
            `SELECT 'trip_started' AS kind, t.id, t.started_at AS at_ms,
                    t.user_id, t.circle_id, t.mode, t.distance_m, t.max_speed_mps,
                    t.started_at, NULL AS ended_at,
                    t.start_lat, t.start_lng, t.end_lat, t.end_lng,
                    t.start_label, t.end_label
             FROM trips t
             WHERE t.user_id = ? AND t.circle_id = ? AND t.started_at >= ?
             ${before ? 'AND t.started_at < ?' : ''}
             UNION ALL
             SELECT 'trip_ended' AS kind, t.id, t.ended_at AS at_ms,
                    t.user_id, t.circle_id, t.mode, t.distance_m, t.max_speed_mps,
                    t.started_at, t.ended_at,
                    t.start_lat, t.start_lng, t.end_lat, t.end_lng,
                    t.start_label, t.end_label
             FROM trips t
             WHERE t.user_id = ? AND t.circle_id = ? AND t.ended_at IS NOT NULL AND t.ended_at >= ?
             ${before ? 'AND t.ended_at < ?' : ''}`,
        );

        const checkinRows = db.prepare(
            `SELECT 'check_in' AS kind, c.id, c.created_at AS at_ms,
                    c.user_id, c.circle_id, u.display_name, c.status,
                    c.lat, c.lng, c.note
             FROM check_ins c
             JOIN users u ON u.id = c.user_id
             WHERE c.user_id = ? AND c.circle_id = ? AND c.created_at >= ?
             ${before ? 'AND c.created_at < ?' : ''}`,
        );

        const routineRows = db.prepare(
            `SELECT 'routine_deviation' AS kind, ra.id, ra.fired_at AS at_ms,
                    ra.user_id, ra.circle_id, ra.kind AS alert_kind,
                    ra.expected_minute, ra.actual_minute,
                    r.place_id, p.name AS placeName
             FROM routine_alerts ra
             JOIN routines r ON r.id = ra.routine_id
             LEFT JOIN places p ON p.id = r.place_id
             WHERE ra.user_id = ? AND ra.circle_id = ? AND ra.fired_at >= ?
             ${before ? 'AND ra.fired_at < ?' : ''}`,
        );

        const alertRows = db.prepare(
            `SELECT 'alert' AS kind, ae.id, ae.created_at AS at_ms,
                    ae.user_id, ae.circle_id, ae.type, ae.value
             FROM alert_events ae
             WHERE ae.user_id = ? AND ae.circle_id = ? AND ae.created_at >= ?
             ${before ? 'AND ae.created_at < ?' : ''}`,
        );

        const vp = before
            ? [targetUserId, circleId, sinceMs, before, targetUserId, circleId, sinceMs, before]
            : [targetUserId, circleId, sinceMs, targetUserId, circleId, sinceMs];
        const tp = before
            ? [targetUserId, circleId, sinceMs, before, targetUserId, circleId, sinceMs, before]
            : [targetUserId, circleId, sinceMs, targetUserId, circleId, sinceMs];
        const cp = before
            ? [targetUserId, circleId, sinceMs, before]
            : [targetUserId, circleId, sinceMs];
        const rp = before
            ? [targetUserId, circleId, sinceMs, before]
            : [targetUserId, circleId, sinceMs];
        const ap = before
            ? [targetUserId, circleId, sinceMs, before]
            : [targetUserId, circleId, sinceMs];

        const allRows = [
            ...visitRows.all(...vp),
            ...tripRows.all(...tp),
            ...checkinRows.all(...cp),
            ...routineRows.all(...rp),
            ...alertRows.all(...ap),
        ];

        allRows.sort((a, b) => b.at_ms - a.at_ms);

        const items = allRows.slice(0, limit).map((r) => {
            const base = { kind: r.kind, at: r.at_ms };
            switch (r.kind) {
                case 'visit_started':
                case 'visit_ended':
                    return { ...base, payload: { id: r.id, placeId: r.place_id, placeName: r.placeName, lat: r.lat, lng: r.lng, label: r.label, startedAt: r.started_at, endedAt: r.ended_at } };
                case 'trip_started':
                case 'trip_ended':
                    return { ...base, payload: { id: r.id, mode: r.mode, distanceM: r.distance_m, maxSpeedMps: r.max_speed_mps, startedAt: r.started_at, endedAt: r.ended_at, startLat: r.start_lat, startLng: r.start_lng, endLat: r.end_lat, endLng: r.end_lng, startLabel: r.start_label, endLabel: r.end_label } };
                case 'check_in':
                    return { ...base, payload: { id: r.id, status: r.status, lat: r.lat, lng: r.lng, note: r.note } };
                case 'routine_deviation':
                    return { ...base, payload: { id: r.id, alertKind: r.alert_kind, placeId: r.place_id, placeName: r.placeName, expectedMinute: r.expected_minute, actualMinute: r.actual_minute } };
                case 'alert':
                    return { ...base, payload: { id: r.id, type: r.type, value: r.value } };
                default:
                    return base;
            }
        });

        const cursor = allRows.length > limit ? allRows[limit - 1].at_ms : null;

        logView(db, req.auth.userId, targetUserId, 'history');

        return { items, cursor };
    });
}
