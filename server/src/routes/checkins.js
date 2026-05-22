import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { publish } from '../hub.js';
import { isAllowedImageMime, stripImageMetadata } from '../exifStrip.js';
import { streamToTemp, commitAttachment } from '../uploads.js';

const CheckinBody = z.object({
    status: z.enum(['safe_home', 'out_safe', 'heading_home']),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    note: z.string().max(500).optional(),
});

const PHOTO_BYTES = 2 * 1024 * 1024;

function rowToJson(r) {
    const obj = {
        id: r.id,
        userId: r.user_id,
        circleId: r.circle_id,
        displayName: r.display_name,
        status: r.status,
        lat: r.lat,
        lng: r.lng,
        note: r.note,
        createdAt: r.created_at,
    };
    if (r.photo_path) obj.photoUrl = `/api/checkins/${r.id}/photo`;
    return obj;
}

function assertMember(db, circleId, userId, reply) {
    const m = db
        .prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?')
        .get(circleId, userId);
    if (!m) { reply.code(403).send({ error: 'not_a_member' }); return false; }
    return true;
}

export default async function checkinRoutes(fastify, { db, uploadsDir }) {

    fastify.post('/api/checkins', { preHandler: requireAuth(db) }, async (req, reply) => {
        const parsed = CheckinBody.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });

        const circleRow = db
            .prepare(
                `SELECT cm.circle_id FROM circle_members cm WHERE cm.user_id = ? LIMIT 1`
            )
            .get(req.auth.userId);
        if (!circleRow) return reply.code(403).send({ error: 'no_circle' });

        const now = Date.now();
        const result = db.prepare(
            `INSERT INTO check_ins (user_id, circle_id, status, lat, lng, note, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(req.auth.userId, circleRow.circle_id, parsed.data.status, parsed.data.lat ?? null, parsed.data.lng ?? null, parsed.data.note ?? null, now);

        const row = db.prepare(
            `SELECT c.*, u.display_name FROM check_ins c
             JOIN users u ON u.id = c.user_id WHERE c.id = ?`
        ).get(result.lastInsertRowid);

        const event = rowToJson(row);
        publish(circleRow.circle_id, { type: 'check_in', ...event });
        return event;
    });

    fastify.post('/api/checkins/with-photo', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
    }, async (req, reply) => {
        const circleRow = db
            .prepare('SELECT cm.circle_id FROM circle_members cm WHERE cm.user_id = ? LIMIT 1')
            .get(req.auth.userId);
        if (!circleRow) return reply.code(403).send({ error: 'no_circle' });

        const file = await req.file({ limits: { fileSize: PHOTO_BYTES } });
        if (!file) return reply.code(400).send({ error: 'no_file' });
        if (!isAllowedImageMime(file.mimetype)) return reply.code(415).send({ error: 'unsupported_type' });
        if (file.file.truncated) return reply.code(413).send({ error: 'too_large' });

        const status = file.fields.status?.value;
        if (!status || !['safe_home', 'out_safe', 'heading_home'].includes(status)) {
            return reply.code(400).send({ error: 'invalid_status' });
        }
        const note = file.fields.note?.value?.trim()?.slice(0, 500) || null;
        const lat = file.fields.lat?.value ? Number(file.fields.lat.value) : null;
        const lng = file.fields.lng?.value ? Number(file.fields.lng.value) : null;

        const now = Date.now();
        const result = db.prepare(
            `INSERT INTO check_ins (user_id, circle_id, status, lat, lng, note, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(req.auth.userId, circleRow.circle_id, status, lat, lng, note, now);

        const checkinId = result.lastInsertRowid;
        const ext = file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/webp' ? '.webp' : '.jpg';
        const checkinDir = join(uploadsDir, 'checkins');
        const finalPath = join(checkinDir, `${checkinId}${ext}`);

        try {
            const { tmpPath } = await streamToTemp(file, join(uploadsDir, 'tmp'));
            await commitAttachment({
                tmpPath,
                finalPath,
                transform: (buf) => stripImageMetadata({ buffer: buf, mime: file.mimetype }),
            });
            db.prepare('UPDATE check_ins SET photo_path = ? WHERE id = ?')
                .run(`checkins/${checkinId}${ext}`, checkinId);
        } catch (err) {
            db.prepare('DELETE FROM check_ins WHERE id = ?').run(checkinId);
            req.log.error({ err: err.message }, 'checkin_photo_failed');
            return reply.code(500).send({ error: 'upload_failed' });
        }

        const row = db.prepare(
            `SELECT c.*, u.display_name FROM check_ins c
             JOIN users u ON u.id = c.user_id WHERE c.id = ?`
        ).get(checkinId);

        const event = rowToJson(row);
        publish(circleRow.circle_id, { type: 'check_in', ...event });
        return event;
    });

    fastify.get('/api/checkins/:id/photo', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        const checkinId = Number(req.params.id);
        if (!Number.isInteger(checkinId)) return reply.code(400).send({ error: 'invalid_id' });

        const row = db.prepare('SELECT circle_id, photo_path FROM check_ins WHERE id = ?').get(checkinId);
        if (!row?.photo_path) return reply.code(404).send({ error: 'not_found' });
        if (!assertMember(db, row.circle_id, req.auth.userId, reply)) return;

        const path = join(uploadsDir, row.photo_path);
        if (!existsSync(path)) return reply.code(404).send({ error: 'not_found' });

        const ext = row.photo_path.endsWith('.png') ? 'image/png' : row.photo_path.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
        reply.header('content-type', ext);
        reply.header('cache-control', 'private, max-age=3600');
        return reply.send(createReadStream(path));
    });

    fastify.get('/api/circles/:id/checkins', { preHandler: requireAuth(db) }, async (req, reply) => {
        const circleId = Number(req.params.id);
        if (!Number.isInteger(circleId)) return reply.code(400).send({ error: 'invalid_circle' });
        if (!assertMember(db, circleId, req.auth.userId, reply)) return;

        const limit = Math.min(Number(req.query.limit) || 50, 500);
        const rows = db.prepare(
            `SELECT c.*, u.display_name FROM check_ins c
             JOIN users u ON u.id = c.user_id
             WHERE c.circle_id = ?
             ORDER BY c.created_at DESC LIMIT ?`
        ).all(circleId, limit);

        return { checkins: rows.map(rowToJson) };
    });
}
