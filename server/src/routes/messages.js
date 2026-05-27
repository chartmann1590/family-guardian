import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { publish } from '../hub.js';
import { fanOut } from '../fcm.js';
import { fanOut as webPushFanOut } from '../webPush.js';
import { isAllowedImageMime, isAllowedAudioMime, stripImageMetadata } from '../exifStrip.js';
import { streamToTemp, commitAttachment } from '../uploads.js';

const PostBody = z.object({
    body: z.string().min(1).max(2_000),
});

const ALLOWED_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const ATTACHMENT_BYTES = 8 * 1024 * 1024;

function rowToMsg(r) {
    const msg = {
        id: r.id,
        circleId: r.circle_id,
        userId: r.user_id,
        displayName: r.display_name,
        body: r.body,
        createdAt: r.created_at,
        reactions: [],
    };
    if (r.attachment_kind) {
        msg.attachmentKind = r.attachment_kind;
        msg.attachmentUrl = `/api/messages/${r.id}/attachment`;
        msg.attachmentMime = r.attachment_mime;
        msg.attachmentBytes = r.attachment_bytes;
        if (r.attachment_duration_ms != null) msg.attachmentDurationMs = r.attachment_duration_ms;
    }
    return msg;
}

function assertMember(db, circleId, userId, reply) {
    const m = db
        .prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?')
        .get(circleId, userId);
    if (!m) { reply.code(403).send({ error: 'not_a_member' }); return false; }
    return true;
}

export default async function messageRoutes(fastify, { db, uploadsDir }) {

    fastify.post('/api/circles/:id/messages', { preHandler: requireAuth(db) }, async (req, reply) => {
        const circleId = Number(req.params.id);
        if (!Number.isInteger(circleId)) return reply.code(400).send({ error: 'invalid_circle' });
        if (!assertMember(db, circleId, req.auth.userId, reply)) return;

        const parsed = PostBody.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

        const now = Date.now();
        const result = db.prepare(
            'INSERT INTO messages (circle_id, user_id, body, created_at) VALUES (?, ?, ?, ?)'
        ).run(circleId, req.auth.userId, parsed.data.body.trim(), now);

        const row = db.prepare(
            `SELECT m.*, u.display_name FROM messages m
             JOIN users u ON u.id = m.user_id WHERE m.id = ?`
        ).get(result.lastInsertRowid);

        const msg = rowToMsg(row);
        publish(circleId, { type: 'chat_message', ...msg });
        fanOut(circleId, { type: 'chat_message', ...msg }, db, req.auth.userId);
        webPushFanOut(circleId, { type: 'chat_message', ...msg }, db, req.auth.userId);
        return msg;
    });

    fastify.post('/api/circles/:id/messages/attachment', {
        preHandler: requireAuth(db),
        bodyLimit: ATTACHMENT_BYTES + 4096,
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        const circleId = Number(req.params.id);
        if (!Number.isInteger(circleId)) return reply.code(400).send({ error: 'invalid_circle' });
        if (!assertMember(db, circleId, req.auth.userId, reply)) return;

        const file = await req.file({ limits: { fileSize: ATTACHMENT_BYTES } });
        if (!file) return reply.code(400).send({ error: 'no_file' });

        const kind = file.fields.kind?.value;
        if (kind !== 'audio' && kind !== 'image') {
            return reply.code(400).send({ error: 'invalid_kind' });
        }

        const mime = file.mimetype;
        const validMime = kind === 'image' ? isAllowedImageMime(mime) : isAllowedAudioMime(mime);
        if (!validMime) return reply.code(415).send({ error: 'unsupported_type' });

        const body = file.fields.body?.value?.trim()?.slice(0, 2000) || '';
        const durationMs = file.fields.durationMs?.value ? Number(file.fields.durationMs.value) : null;

        const { tmpPath } = await streamToTemp(file, join(uploadsDir, 'tmp'));
        if (file.file.truncated) {
            await import('node:fs/promises').then(m => m.unlink(tmpPath)).catch(() => {});
            return reply.code(413).send({ error: 'too_large' });
        }

        const now = Date.now();
        const result = db.prepare(
            `INSERT INTO messages (circle_id, user_id, body, created_at, attachment_kind, attachment_mime, attachment_bytes, attachment_duration_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(circleId, req.auth.userId, body, now, kind, mime, 0, durationMs ?? null);

        const msgId = result.lastInsertRowid;
        const ext = kind === 'image'
            ? (mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg')
            : (mime === 'audio/webm' ? '.webm' : '.m4a');
        const msgDir = join(uploadsDir, 'messages', String(circleId));
        const finalPath = join(msgDir, `${msgId}${ext}`);

        try {
            const transform = kind === 'image'
                ? (buf) => stripImageMetadata({ buffer: buf, mime })
                : null;
            await commitAttachment({ tmpPath, finalPath, transform });
            const stat = await import('node:fs/promises').then(m => m.stat(finalPath));
            db.prepare('UPDATE messages SET attachment_path = ?, attachment_bytes = ? WHERE id = ?')
                .run(`messages/${circleId}/${msgId}${ext}`, stat.size, msgId);
        } catch (err) {
            db.prepare('DELETE FROM messages WHERE id = ?').run(msgId);
            await import('node:fs/promises').then(m => m.unlink(tmpPath)).catch(() => {});
            req.log.error({ err: err.message }, 'attachment_write_failed');
            return reply.code(500).send({ error: 'upload_failed' });
        }

        const row = db.prepare(
            `SELECT m.*, u.display_name FROM messages m
             JOIN users u ON u.id = m.user_id WHERE m.id = ?`
        ).get(msgId);

        const msg = rowToMsg(row);
        publish(circleId, { type: 'chat_message', ...msg });
        fanOut(circleId, { type: 'chat_message', ...msg }, db, req.auth.userId);
        webPushFanOut(circleId, { type: 'chat_message', ...msg }, db, req.auth.userId);
        return msg;
    });

    fastify.get('/api/messages/:id/attachment', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 240, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        const msgId = Number(req.params.id);
        if (!Number.isInteger(msgId)) return reply.code(400).send({ error: 'invalid_message' });

        const row = db.prepare(
            'SELECT circle_id, attachment_path, attachment_mime FROM messages WHERE id = ?'
        ).get(msgId);
        if (!row?.attachment_path) return reply.code(404).send({ error: 'not_found' });
        if (!assertMember(db, row.circle_id, req.auth.userId, reply)) return;

        const path = join(uploadsDir, row.attachment_path);
        if (!existsSync(path)) return reply.code(404).send({ error: 'not_found' });

        reply.header('content-type', row.attachment_mime);
        reply.header('cache-control', 'private, max-age=3600');
        return reply.send(createReadStream(path));
    });

    fastify.post('/api/circles/:id/typing', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        const circleId = Number(req.params.id);
        if (!Number.isInteger(circleId)) return reply.code(400).send({ error: 'invalid_circle' });
        if (!assertMember(db, circleId, req.auth.userId, reply)) return;

        const displayName = db.prepare('SELECT display_name FROM users WHERE id = ?').get(req.auth.userId)?.display_name || 'Member';
        publish(circleId, {
            type: 'chat_typing',
            circleId,
            userId: req.auth.userId,
            displayName,
            expiresAt: Date.now() + 5000,
        });
        return reply.code(204).send();
    });

    fastify.get('/api/circles/:id/messages', { preHandler: requireAuth(db) }, async (req, reply) => {
        const circleId = Number(req.params.id);
        if (!Number.isInteger(circleId)) return reply.code(400).send({ error: 'invalid_circle' });
        if (!assertMember(db, circleId, req.auth.userId, reply)) return;

        const before = Number(req.query.before) || Date.now() + 1;
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const withReaders = req.query.withReaders === '1';

        const rows = db.prepare(
            `SELECT m.*, u.display_name FROM messages m
             JOIN users u ON u.id = m.user_id
             WHERE m.circle_id = ? AND m.created_at < ?
             ORDER BY m.created_at DESC LIMIT ?`
        ).all(circleId, before, limit);

        const messages = rows.map(rowToMsg).reverse();

        const ids = messages.map((m) => m.id);
        if (ids.length > 0) {
            const placeholders = ids.map(() => '?').join(',');
            const rxRows = db.prepare(
                `SELECT message_id, user_id, emoji FROM message_reactions
                 WHERE message_id IN (${placeholders})`
            ).all(...ids);
            const grouped = new Map();
            for (const rx of rxRows) {
                const key = `${rx.message_id}:${rx.emoji}`;
                if (!grouped.has(key)) grouped.set(key, { emoji: rx.emoji, messageId: rx.message_id, userIds: [] });
                grouped.get(key).userIds.push(rx.user_id);
            }
            for (const g of grouped.values()) {
                const msg = messages.find((m) => m.id === g.messageId);
                if (msg) msg.reactions.push({ emoji: g.emoji, userIds: g.userIds });
            }

            if (withReaders) {
                const readRows = db.prepare(
                    `SELECT mr.message_id, mr.user_id, mr.read_at FROM message_reads mr
                     WHERE mr.message_id IN (${placeholders})`
                ).all(...ids);
                for (const rr of readRows) {
                    const msg = messages.find((m) => m.id === rr.message_id && m.userId === req.auth.userId);
                    if (msg) {
                        if (!msg.readers) msg.readers = [];
                        msg.readers.push({ userId: rr.user_id, readAt: rr.read_at });
                    }
                }
            }
        }

        return { messages };
    });

    fastify.post('/api/messages/read-batch', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        const messageIds = req.body?.messageIds;
        if (!Array.isArray(messageIds) || messageIds.length === 0 || messageIds.length > 50) {
            return reply.code(400).send({ error: 'invalid_message_ids' });
        }

        const readerFlag = db.prepare('SELECT read_receipts_enabled FROM users WHERE id = ?').get(req.auth.userId)?.read_receipts_enabled;
        if (!readerFlag) return reply.code(204).send();

        const now = Date.now();
        for (const mid of messageIds) {
            const msg = db.prepare('SELECT circle_id, user_id FROM messages WHERE id = ?').get(mid);
            if (!msg) continue;
            if (msg.user_id === req.auth.userId) continue;
            if (!assertMember(db, msg.circle_id, req.auth.userId, reply)) continue;

            const authorFlag = db.prepare('SELECT read_receipts_enabled FROM users WHERE id = ?').get(msg.user_id)?.read_receipts_enabled;
            if (!authorFlag) continue;

            db.prepare(
                'INSERT OR IGNORE INTO message_reads (message_id, user_id, read_at) VALUES (?, ?, ?)'
            ).run(mid, req.auth.userId, now);

            publish(msg.circle_id, { type: 'message_read', messageId: mid, userId: req.auth.userId, readAt: now });
        }
        return reply.code(204).send();
    });

    fastify.post('/api/messages/:id/reactions', { preHandler: requireAuth(db) }, async (req, reply) => {
        const messageId = Number(req.params.id);
        if (!Number.isInteger(messageId)) return reply.code(400).send({ error: 'invalid_message' });

        const msg = db.prepare('SELECT circle_id FROM messages WHERE id = ?').get(messageId);
        if (!msg) return reply.code(404).send({ error: 'not_found' });
        if (!assertMember(db, msg.circle_id, req.auth.userId, reply)) return;

        const emoji = req.body?.emoji;
        if (typeof emoji !== 'string' || !ALLOWED_EMOJIS.includes(emoji)) {
            return reply.code(400).send({ error: 'invalid_emoji', allowed: ALLOWED_EMOJIS });
        }

        db.prepare(
            'INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)'
        ).run(messageId, req.auth.userId, emoji, Date.now());

        publish(msg.circle_id, { type: 'reaction_added', messageId, userId: req.auth.userId, emoji });
        return reply.code(204).send();
    });

    fastify.delete('/api/messages/:id/reactions/:emoji', { preHandler: requireAuth(db) }, async (req, reply) => {
        const messageId = Number(req.params.id);
        if (!Number.isInteger(messageId)) return reply.code(400).send({ error: 'invalid_message' });
        const emoji = decodeURIComponent(req.params.emoji);

        const msg = db.prepare('SELECT circle_id FROM messages WHERE id = ?').get(messageId);
        if (!msg) return reply.code(404).send({ error: 'not_found' });

        db.prepare(
            'DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
        ).run(messageId, req.auth.userId, emoji);

        publish(msg.circle_id, { type: 'reaction_removed', messageId, userId: req.auth.userId, emoji });
        return reply.code(204).send();
    });
}
