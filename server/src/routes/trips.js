import { requireAuth } from '../auth.js';
import { getCachedLabel, enqueueGeocode } from '../geocoder.js';
import { logView } from '../audit.js';
import { tripRowToJson } from '../payloads.js';

function assertMember(db, circleId, userId, reply) {
    const m = db
        .prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?')
        .get(circleId, userId);
    if (!m) { reply.code(403).send({ error: 'not_a_member' }); return false; }
    return true;
}

function enrichTripLabels(db, rows) {
    for (const r of rows) {
        if (!r.startLabel) {
            const cached = getCachedLabel(db, r.startLat, r.startLng);
            if (cached) {
                r.startLabel = cached;
                db.prepare('UPDATE trips SET start_label = ? WHERE id = ?').run(cached, r.id);
            } else {
                enqueueGeocode(db, r.startLat, r.startLng, (label) => {
                    if (label) db.prepare('UPDATE trips SET start_label = ? WHERE id = ?').run(label, r.id);
                });
            }
        }
        if (!r.endLabel) {
            const cached = getCachedLabel(db, r.endLat, r.endLng);
            if (cached) {
                r.endLabel = cached;
                db.prepare('UPDATE trips SET end_label = ? WHERE id = ?').run(cached, r.id);
            } else {
                enqueueGeocode(db, r.endLat, r.endLng, (label) => {
                    if (label) db.prepare('UPDATE trips SET end_label = ? WHERE id = ?').run(label, r.id);
                });
            }
        }
    }
}

export default async function tripsRoutes(fastify, { db }) {
    fastify.get('/api/circles/:circleId/members/:userId/trips', { preHandler: requireAuth(db) }, async (req, reply) => {
        const circleId = Number(req.params.circleId);
        const targetUserId = Number(req.params.userId);
        if (!Number.isInteger(circleId) || !Number.isInteger(targetUserId)) {
            return reply.code(400).send({ error: 'invalid_params' });
        }
        if (!assertMember(db, circleId, req.auth.userId, reply)) return;
        if (!assertMember(db, circleId, targetUserId, reply)) return;
        const from = Number(req.query.from) || 0;
        const to = Number(req.query.to) || Date.now() + 1;
        const limit = Math.min(Number(req.query.limit) || 100, 500);
        const rows = db.prepare(
            `SELECT id, user_id AS userId, circle_id AS circleId,
                    started_at AS startedAt, ended_at AS endedAt,
                    mode, distance_m AS distanceM,
                    max_speed_mps AS maxSpeedMps, avg_speed_mps AS avgSpeedMps,
                    start_lat AS startLat, start_lng AS startLng,
                    end_lat AS endLat, end_lng AS endLng,
                    start_label AS startLabel, end_label AS endLabel
             FROM trips
             WHERE user_id = ? AND circle_id = ?
                   AND started_at >= ? AND started_at <= ?
             ORDER BY started_at DESC
             LIMIT ?`,
        ).all(targetUserId, circleId, from, to, limit);
        enrichTripLabels(db, rows);
        logView(db, req.auth.userId, targetUserId, 'trips');
        return { trips: rows.map(tripRowToJson) };
    });
}
