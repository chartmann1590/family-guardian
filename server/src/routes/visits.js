import { requireAuth } from '../auth.js';
import { getCachedLabel, enqueueGeocode } from '../geocoder.js';
import { logView } from '../audit.js';
import { visitRowToJson } from '../payloads.js';

function assertMember(db, circleId, userId, reply) {
    const m = db
        .prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?')
        .get(circleId, userId);
    if (!m) { reply.code(403).send({ error: 'not_a_member' }); return false; }
    return true;
}

function enrichVisitLabels(db, rows) {
    for (const r of rows) {
        if (r.placeName || r.label) continue;
        const cached = getCachedLabel(db, r.lat, r.lng);
        if (cached) {
            r.label = cached;
            db.prepare('UPDATE visits SET label = ? WHERE id = ?').run(cached, r.id);
        } else {
            enqueueGeocode(db, r.lat, r.lng, (label) => {
                if (label) db.prepare('UPDATE visits SET label = ? WHERE id = ?').run(label, r.id);
            });
        }
    }
}

export default async function visitsRoutes(fastify, { db }) {
    fastify.get('/api/circles/:id/visits', { preHandler: requireAuth(db) }, async (req, reply) => {
        const circleId = Number(req.params.id);
        if (!Number.isInteger(circleId)) return reply.code(400).send({ error: 'invalid_circle' });
        if (!assertMember(db, circleId, req.auth.userId, reply)) return;
        const from = Number(req.query.from) || 0;
        const to = Number(req.query.to) || Date.now() + 1;
        const limit = Math.min(Number(req.query.limit) || 100, 500);
        const rows = db.prepare(
            `SELECT v.id, v.user_id AS userId, v.circle_id AS circleId,
                    v.place_id AS placeId, p.name AS placeName,
                    v.lat, v.lng, v.label, v.started_at AS startedAt,
                    v.ended_at AS endedAt, v.point_count AS pointCount
             FROM visits v
             LEFT JOIN places p ON p.id = v.place_id
             WHERE v.circle_id = ? AND v.started_at >= ? AND v.started_at <= ?
             ORDER BY v.started_at DESC
             LIMIT ?`,
        ).all(circleId, from, to, limit);
        enrichVisitLabels(db, rows);
        return { visits: rows.map(visitRowToJson) };
    });

    fastify.get('/api/circles/:circleId/members/:userId/visits', { preHandler: requireAuth(db) }, async (req, reply) => {
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
            `SELECT v.id, v.user_id AS userId, v.circle_id AS circleId,
                    v.place_id AS placeId, p.name AS placeName,
                    v.lat, v.lng, v.label, v.started_at AS startedAt,
                    v.ended_at AS endedAt, v.point_count AS pointCount
             FROM visits v
             LEFT JOIN places p ON p.id = v.place_id
             WHERE v.user_id = ? AND v.circle_id = ?
                   AND v.started_at >= ? AND v.started_at <= ?
             ORDER BY v.started_at DESC
             LIMIT ?`,
        ).all(targetUserId, circleId, from, to, limit);
        enrichVisitLabels(db, rows);
        logView(db, req.auth.userId, targetUserId, 'visits');
        return { visits: rows.map(visitRowToJson) };
    });
}
