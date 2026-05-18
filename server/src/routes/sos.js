import { z } from 'zod';
import { requireAuth, getUserCircleId } from '../auth.js';
import { publish } from '../hub.js';

const ActivateBody = z.object({
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    accuracyM: z.number().nonnegative().optional(),
    note: z.string().max(500).optional(),
});

function rowToEvent(r) {
    return {
        id: r.id,
        circleId: r.circle_id,
        userId: r.user_id,
        displayName: r.display_name,
        startedAt: r.started_at,
        resolvedAt: r.resolved_at,
        resolvedBy: r.resolved_by,
        lat: r.lat,
        lng: r.lng,
        accuracyM: r.accuracy_m,
        note: r.note,
        status: r.status,
    };
}

export default async function sosRoutes(fastify, { db }) {

    fastify.post('/api/sos/activate', { preHandler: requireAuth(db) }, async (req, reply) => {
        const parsed = ActivateBody.safeParse(req.body ?? {});
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
        const userId = req.auth.userId;
        const circleId = getUserCircleId(db, userId);
        if (!circleId) return reply.code(400).send({ error: 'no_circle' });

        // Fall back to the user's last-known location if the client didn't send one.
        let { lat, lng, accuracyM, note } = parsed.data;
        if (lat === undefined || lng === undefined) {
            const last = db
                .prepare('SELECT lat, lng, accuracy_m AS accuracyM FROM locations WHERE user_id = ?')
                .get(userId);
            lat = lat ?? last?.lat ?? null;
            lng = lng ?? last?.lng ?? null;
            accuracyM = accuracyM ?? last?.accuracyM ?? null;
        }

        // Reuse any in-flight SOS for this user instead of stacking.
        const existing = db
            .prepare(
                `SELECT id FROM sos_events
                 WHERE user_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1`
            )
            .get(userId);

        const now = Date.now();
        let id;
        if (existing) {
            db.prepare(
                `UPDATE sos_events SET lat = ?, lng = ?, accuracy_m = ?, note = ?, started_at = ?
                 WHERE id = ?`
            ).run(lat, lng, accuracyM ?? null, note ?? null, now, existing.id);
            id = existing.id;
        } else {
            const r = db
                .prepare(
                    `INSERT INTO sos_events
                     (circle_id, user_id, started_at, lat, lng, accuracy_m, note, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`
                )
                .run(circleId, userId, now, lat, lng, accuracyM ?? null, note ?? null);
            id = Number(r.lastInsertRowid);
        }

        const row = db
            .prepare(
                `SELECT e.*, u.display_name FROM sos_events e
                 JOIN users u ON u.id = e.user_id WHERE e.id = ?`
            )
            .get(id);

        const event = rowToEvent(row);
        publish(circleId, { type: 'sos_active', ...event });
        return event;
    });

    fastify.post('/api/sos/:id/resolve', { preHandler: requireAuth(db) }, async (req, reply) => {
        const eventId = Number(req.params.id);
        if (!Number.isInteger(eventId)) return reply.code(400).send({ error: 'invalid_id' });

        const existing = db.prepare('SELECT * FROM sos_events WHERE id = ?').get(eventId);
        if (!existing) return reply.code(404).send({ error: 'not_found' });

        const userId = req.auth.userId;
        const isOwner = existing.user_id === userId;
        const role = db
            .prepare('SELECT role FROM circle_members WHERE circle_id = ? AND user_id = ?')
            .get(existing.circle_id, userId);
        if (!role) return reply.code(403).send({ error: 'not_a_member' });
        if (!isOwner && role.role !== 'admin') {
            return reply.code(403).send({ error: 'owner_or_admin_only' });
        }
        if (existing.status === 'resolved') {
            return reply.code(409).send({ error: 'already_resolved' });
        }

        const now = Date.now();
        db.prepare(
            `UPDATE sos_events SET status = 'resolved', resolved_at = ?, resolved_by = ?
             WHERE id = ?`
        ).run(now, userId, eventId);

        const row = db
            .prepare(
                `SELECT e.*, u.display_name FROM sos_events e
                 JOIN users u ON u.id = e.user_id WHERE e.id = ?`
            )
            .get(eventId);
        const event = rowToEvent(row);
        publish(existing.circle_id, { type: 'sos_resolved', ...event });
        return event;
    });

    fastify.get('/api/circles/:id/sos', { preHandler: requireAuth(db) }, async (req, reply) => {
        const circleId = Number(req.params.id);
        if (!Number.isInteger(circleId)) return reply.code(400).send({ error: 'invalid_circle' });
        const m = db
            .prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?')
            .get(circleId, req.auth.userId);
        if (!m) return reply.code(403).send({ error: 'not_a_member' });

        const rows = db
            .prepare(
                `SELECT e.*, u.display_name FROM sos_events e
                 JOIN users u ON u.id = e.user_id
                 WHERE e.circle_id = ? AND e.status = 'active'
                 ORDER BY e.started_at DESC`
            )
            .all(circleId);
        return { events: rows.map(rowToEvent) };
    });
}
