import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { extname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { isFcmDisabled } from '../fcm.js';
import { buildDigest, persistDigest } from '../digest.js';

const UpdateMeBody = z.object({
    displayName: z.string().min(1).max(64).optional(),
    readReceiptsEnabled: z.boolean().optional(),
    crashDetectionEnabled: z.boolean().optional(),
});

const FcmTokenBody = z.object({
    token: z.string().min(1).max(4096),
    platform: z.string().min(1).max(32).optional(),
});

const ALLOWED_TYPES = new Map([
    ['image/jpeg', '.jpg'],
    ['image/png', '.png'],
    ['image/webp', '.webp'],
]);

const PHOTO_BYTES = 2 * 1024 * 1024; // 2 MB

export default async function profileRoutes(fastify, { db, uploadsDir }) {
    await mkdir(uploadsDir, { recursive: true });

    fastify.patch('/api/users/me', { preHandler: requireAuth(db) }, async (req, reply) => {
        const parsed = UpdateMeBody.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
        }
        const { displayName, readReceiptsEnabled, crashDetectionEnabled } = parsed.data;
        if (displayName != null) {
            db.prepare('UPDATE users SET display_name = ? WHERE id = ?')
                .run(displayName.trim(), req.auth.userId);
        }
        if (readReceiptsEnabled != null) {
            db.prepare('UPDATE users SET read_receipts_enabled = ? WHERE id = ?')
                .run(readReceiptsEnabled ? 1 : 0, req.auth.userId);
        }
        if (crashDetectionEnabled != null) {
            db.prepare('UPDATE users SET crash_detection_enabled = ? WHERE id = ?')
                .run(crashDetectionEnabled ? 1 : 0, req.auth.userId);
        }
        const row = db.prepare(
            'SELECT id AS userId, display_name AS displayName, email, photo_path AS photoPath, read_receipts_enabled AS readReceiptsEnabled, crash_detection_enabled AS crashDetectionEnabled FROM users WHERE id = ?',
        ).get(req.auth.userId);
        return {
            userId: row.userId,
            displayName: row.displayName,
            email: row.email,
            photoUrl: row.photoPath ? `/api/users/${row.userId}/photo` : null,
            readReceiptsEnabled: !!row.readReceiptsEnabled,
            crashDetectionEnabled: !!row.crashDetectionEnabled,
        };
    });

    fastify.post('/api/users/me/photo', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        const file = await req.file({ limits: { fileSize: PHOTO_BYTES } });
        if (!file) return reply.code(400).send({ error: 'no_file' });
        const ext = ALLOWED_TYPES.get(file.mimetype);
        if (!ext) return reply.code(415).send({ error: 'unsupported_type' });

        const userId = req.auth.userId;
        const filename = `${userId}${ext}`;
        const target = join(uploadsDir, filename);
        // Stream to a temp file first; only swap into place after we know the
        // upload was complete and within the size limit, so an oversized retry
        // can't wipe a previously-good photo.
        const tmp = join(uploadsDir, `.${filename}.${randomBytes(6).toString('hex')}.tmp`);

        try {
            await pipeline(file.file, createWriteStream(tmp));
        } catch (err) {
            await unlink(tmp).catch(() => {});
            req.log.error({ err: err.message }, 'photo_upload_failed');
            return reply.code(500).send({ error: 'upload_failed' });
        }
        if (file.file.truncated) {
            await unlink(tmp).catch(() => {});
            return reply.code(413).send({ error: 'too_large' });
        }

        // Remove any prior photo with a different extension before renaming
        // (renaming over the same path is fine; over a different one would
        // leave the old one orphaned).
        const prior = db.prepare('SELECT photo_path FROM users WHERE id = ?').get(userId)?.photo_path;
        if (prior && prior !== filename) {
            await unlink(join(uploadsDir, prior)).catch(() => {});
        }
        await rename(tmp, target);

        db.prepare('UPDATE users SET photo_path = ? WHERE id = ?').run(filename, userId);
        return { photoUrl: `/api/users/${userId}/photo` };
    });

    fastify.delete('/api/users/me/photo', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    }, async (req) => {
        const userId = req.auth.userId;
        const prior = db.prepare('SELECT photo_path FROM users WHERE id = ?').get(userId)?.photo_path;
        if (prior) await unlink(join(uploadsDir, prior)).catch(() => {});
        db.prepare('UPDATE users SET photo_path = NULL WHERE id = ?').run(userId);
        return { ok: true };
    });

    // Public-ish: any signed-in circle member can fetch any other member's photo.
    // We enforce circle membership rather than a per-photo ACL.
    fastify.get('/api/users/:id/photo', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        const targetId = Number(req.params.id);
        if (!Number.isInteger(targetId)) return reply.code(400).send({ error: 'invalid_id' });

        // Caller must share a circle with the target (or be the target).
        if (targetId !== req.auth.userId) {
            const shared = db.prepare(
                `SELECT 1 FROM circle_members a
                 JOIN circle_members b ON a.circle_id = b.circle_id
                 WHERE a.user_id = ? AND b.user_id = ? LIMIT 1`,
            ).get(req.auth.userId, targetId);
            if (!shared) return reply.code(403).send({ error: 'not_in_shared_circle' });
        }

        const row = db.prepare('SELECT photo_path FROM users WHERE id = ?').get(targetId);
        if (!row?.photo_path) return reply.code(404).send({ error: 'no_photo' });
        const path = join(uploadsDir, row.photo_path);
        if (!existsSync(path)) return reply.code(404).send({ error: 'no_photo' });

        const ext = extname(row.photo_path).toLowerCase();
        const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        reply.header('content-type', type);
        // Short cache; clients reload after upload by appending ?t= cache-buster.
        reply.header('cache-control', 'private, max-age=60');
        return reply.send(createReadStream(path));
    });

    fastify.get('/api/users/me/view-log', { preHandler: requireAuth(db) }, async (req) => {
        const days = Math.min(Number(req.query.days) || 7, 30);
        const cutoff = Date.now() - days * 86_400_000;
        const rows = db
            .prepare(
                `SELECT va.resource, va.created_at AS viewedAt,
                        u.id AS viewerId, u.display_name AS viewerName,
                        u.photo_path AS viewerPhotoPath
                 FROM view_audits va
                 JOIN users u ON u.id = va.viewer_id
                 WHERE va.subject_id = ? AND va.created_at >= ?
                 ORDER BY va.created_at DESC`,
            )
            .all(req.auth.userId, cutoff)
            .map((r) => ({
                resource: r.resource,
                viewedAt: r.viewedAt,
                viewerId: r.viewerId,
                viewerName: r.viewerName,
                viewerPhotoUrl: r.viewerPhotoPath
                    ? `/api/users/${r.viewerId}/photo`
                    : null,
            }));
        return { views: rows };
    });

    fastify.get('/api/circles/:circleId/digest/current', { preHandler: requireAuth(db) }, async (req, reply) => {
        const circleId = Number(req.params.circleId);
        if (!Number.isInteger(circleId)) return reply.code(400).send({ error: 'invalid_circle' });
        const m = db.prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?')
            .get(circleId, req.auth.userId);
        if (!m) return reply.code(403).send({ error: 'not_a_member' });
        const row = db.prepare('SELECT summary_json, week_start, week_end FROM digest_snapshots WHERE circle_id = ? ORDER BY week_start DESC LIMIT 1')
            .get(circleId);
        if (!row) return { digest: null };
        return { digest: { ...JSON.parse(row.summary_json), weekStart: row.week_start, weekEnd: row.week_end } };
    });

    fastify.get('/api/circles/:circleId/digest', { preHandler: requireAuth(db) }, async (req, reply) => {
        const circleId = Number(req.params.circleId);
        if (!Number.isInteger(circleId)) return reply.code(400).send({ error: 'invalid_circle' });
        const m = db.prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?')
            .get(circleId, req.auth.userId);
        if (!m) return reply.code(403).send({ error: 'not_a_member' });
        const since = Number(req.query.since) || 0;
        const rows = db.prepare('SELECT summary_json, week_start, week_end FROM digest_snapshots WHERE circle_id = ? AND week_start >= ? ORDER BY week_start DESC LIMIT 12')
            .all(circleId, since);
        return { digests: rows.map(r => ({ ...JSON.parse(r.summary_json), weekStart: r.week_start, weekEnd: r.week_end })) };
    });

    fastify.patch('/api/users/me/digest-prefs', { preHandler: requireAuth(db) }, async (req, reply) => {
        const enabled = req.body?.enabled;
        if (typeof enabled !== 'boolean') return reply.code(400).send({ error: 'invalid_body' });
        db.prepare('INSERT OR IGNORE INTO alert_prefs (user_id) VALUES (?)').run(req.auth.userId);
        db.prepare('UPDATE alert_prefs SET weekly_digest_enabled = ? WHERE user_id = ?')
            .run(enabled ? 1 : 0, req.auth.userId);
        return { enabled };
    });

    fastify.post('/api/users/me/fcm-token', { preHandler: requireAuth(db) }, async (req, reply) => {
        const parsed = FcmTokenBody.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'invalid_body' });
        }
        const { token, platform } = parsed.data;
        db.prepare(
            `INSERT INTO fcm_tokens (user_id, token, platform, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id, token) DO UPDATE SET updated_at = excluded.updated_at, platform = excluded.platform`,
        ).run(req.auth.userId, token, platform || 'android', Date.now());
        isFcmDisabled();
        return { ok: true };
    });
}
