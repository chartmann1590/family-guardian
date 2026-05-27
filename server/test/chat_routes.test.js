import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import messageRoutes from '../src/routes/messages.js';
import { createTestDb, seedUser, seedSecondUser } from './helpers.js';

let db, app, token, userId, circleId, uploadsDir;

beforeEach(async () => {
    db = createTestDb();
    const seed = seedUser(db);
    userId = seed.userId;
    circleId = seed.circleId;
    const future = Date.now() + 30 * 86400000;
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .run('test-tok', userId, Date.now(), future);
    token = 'test-tok';

    uploadsDir = join(tmpdir(), `fg-test-uploads-${Date.now()}`);
    mkdirSync(uploadsDir, { recursive: true });

    app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
    await app.register(cookie, { secret: 'test-secret' });
    await app.register(formbody);
    await app.register(rateLimit, { global: false });
    await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
    await app.register(messageRoutes, { db, uploadsDir });
    await app.ready();
});

afterEach(async () => {
    await app.close();
    db.close();
    if (existsSync(uploadsDir)) rmSync(uploadsDir, { recursive: true, force: true });
});

function auth(contentType = 'application/json') {
    return { Authorization: `Bearer ${token}`, 'Content-Type': contentType };
}

function multipartBody(fields, file) {
    const boundary = '----FormBoundary' + Date.now();
    const parts = [];
    for (const [name, value] of Object.entries(fields)) {
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}`);
    }
    if (file) {
        parts.push(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`
        );
    }
    const header = Buffer.from(parts.join('\r\n') + '\r\n');
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = file ? Buffer.concat([header, file.data, footer]) : Buffer.concat([header, footer]);
    return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

// --- Text messages ---

describe('POST /api/circles/:id/messages', () => {
    it('sends a text message', async () => {
        const res = await app.inject({
            method: 'POST', url: `/api/circles/${circleId}/messages`,
            headers: auth(),
            payload: { body: 'Hello family!' },
        });
        expect(res.statusCode).toBe(200);
        const msg = res.json();
        expect(msg.body).toBe('Hello family!');
        expect(msg.userId).toBe(userId);
        expect(msg.circleId).toBe(circleId);
        expect(msg.id).toBeDefined();
        expect(msg.createdAt).toBeDefined();
    });

    it('trims whitespace from body', async () => {
        const res = await app.inject({
            method: 'POST', url: `/api/circles/${circleId}/messages`,
            headers: auth(),
            payload: { body: '  hi there  ' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().body).toBe('hi there');
    });

    it('rejects empty body', async () => {
        const res = await app.inject({
            method: 'POST', url: `/api/circles/${circleId}/messages`,
            headers: auth(),
            payload: { body: '' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('rejects missing body', async () => {
        const res = await app.inject({
            method: 'POST', url: `/api/circles/${circleId}/messages`,
            headers: auth(),
            payload: {},
        });
        expect(res.statusCode).toBe(400);
    });

    it('rejects non-member', async () => {
        const hash = '$argon2id$v=19$m=65536,t=3,p=4$fakehash';
        db.prepare('INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)')
            .run('outsider@test.com', hash, 'Outsider', Date.now());
        const outsiderId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
        const future = Date.now() + 30 * 86400000;
        db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
            .run('outsider-tok', outsiderId, Date.now(), future);

        const res = await app.inject({
            method: 'POST', url: `/api/circles/${circleId}/messages`,
            headers: { Authorization: 'Bearer outsider-tok', 'Content-Type': 'application/json' },
            payload: { body: 'sneaky' },
        });
        expect(res.statusCode).toBe(403);
    });

    it('rejects unauthenticated request', async () => {
        const res = await app.inject({
            method: 'POST', url: `/api/circles/${circleId}/messages`,
            headers: { 'Content-Type': 'application/json' },
            payload: { body: 'no auth' },
        });
        expect(res.statusCode).toBe(401);
    });
});

// --- Message listing ---

describe('GET /api/circles/:id/messages', () => {
    it('returns empty list initially', async () => {
        const res = await app.inject({
            method: 'GET', url: `/api/circles/${circleId}/messages`,
            headers: { Authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().messages).toEqual([]);
    });

    it('returns messages in chronological order', async () => {
        for (const text of ['first', 'second', 'third']) {
            await app.inject({
                method: 'POST', url: `/api/circles/${circleId}/messages`,
                headers: auth(),
                payload: { body: text },
            });
        }
        const res = await app.inject({
            method: 'GET', url: `/api/circles/${circleId}/messages`,
            headers: { Authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        const msgs = res.json().messages;
        expect(msgs).toHaveLength(3);
        expect(msgs[0].body).toBe('first');
        expect(msgs[2].body).toBe('third');
    });

    it('includes displayName in messages', async () => {
        await app.inject({
            method: 'POST', url: `/api/circles/${circleId}/messages`,
            headers: auth(),
            payload: { body: 'hello' },
        });
        const res = await app.inject({
            method: 'GET', url: `/api/circles/${circleId}/messages`,
            headers: { Authorization: `Bearer ${token}` },
        });
        expect(res.json().messages[0].displayName).toBe('Alice');
    });
});

// --- Attachment uploads ---

describe('POST /api/circles/:id/messages/attachment', () => {
    it('uploads a JPEG image', async () => {
        const jpegData = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Array(100).fill(0x42)]);
        const { body, contentType } = multipartBody(
            { kind: 'image' },
            { name: 'photo.jpg', mime: 'image/jpeg', data: jpegData },
        );
        const res = await app.inject({
            method: 'POST', url: `/api/circles/${circleId}/messages/attachment`,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
            body,
        });
        expect(res.statusCode).toBe(200);
        const msg = res.json();
        expect(msg.attachmentKind).toBe('image');
        expect(msg.attachmentUrl).toMatch(/^\/api\/messages\/\d+\/attachment$/);
        expect(msg.attachmentMime).toBe('image/jpeg');
    });

    it('uploads a PNG image', async () => {
        const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47, ...Array(50).fill(0x00)]);
        const { body, contentType } = multipartBody(
            { kind: 'image' },
            { name: 'photo.png', mime: 'image/png', data: pngData },
        );
        const res = await app.inject({
            method: 'POST', url: `/api/circles/${circleId}/messages/attachment`,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
            body,
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().attachmentMime).toBe('image/png');
    });

    it('uploads an audio file with durationMs', async () => {
        const audioData = Buffer.alloc(200, 0xaa);
        const { body, contentType } = multipartBody(
            { kind: 'audio', durationMs: '4500' },
            { name: 'voice.m4a', mime: 'audio/mp4', data: audioData },
        );
        const res = await app.inject({
            method: 'POST', url: `/api/circles/${circleId}/messages/attachment`,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
            body,
        });
        expect(res.statusCode).toBe(200);
        const msg = res.json();
        expect(msg.attachmentKind).toBe('audio');
        expect(msg.attachmentDurationMs).toBe(4500);
    });

    it('allows attachment with empty body (no caption)', async () => {
        const data = Buffer.alloc(50, 0x42);
        const { body, contentType } = multipartBody(
            { kind: 'image' },
            { name: 'no-caption.jpg', mime: 'image/jpeg', data },
        );
        const res = await app.inject({
            method: 'POST', url: `/api/circles/${circleId}/messages/attachment`,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
            body,
        });
        expect(res.statusCode).toBe(200);
        const msg = res.json();
        expect(msg.body).toBeFalsy();
    });

    it('rejects unsupported MIME type', async () => {
        const data = Buffer.alloc(50, 0x00);
        const { body, contentType } = multipartBody(
            { kind: 'image' },
            { name: 'bad.gif', mime: 'image/gif', data },
        );
        const res = await app.inject({
            method: 'POST', url: `/api/circles/${circleId}/messages/attachment`,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
            body,
        });
        expect(res.statusCode).toBe(415);
    });

    it('rejects invalid kind', async () => {
        const data = Buffer.alloc(50, 0x00);
        const { body, contentType } = multipartBody(
            { kind: 'video' },
            { name: 'clip.mp4', mime: 'video/mp4', data },
        );
        const res = await app.inject({
            method: 'POST', url: `/api/circles/${circleId}/messages/attachment`,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
            body,
        });
        expect(res.statusCode).toBe(400);
    });

    it('rejects missing kind field', async () => {
        const data = Buffer.alloc(50, 0x00);
        const { body, contentType } = multipartBody(
            {},
            { name: 'photo.jpg', mime: 'image/jpeg', data },
        );
        const res = await app.inject({
            method: 'POST', url: `/api/circles/${circleId}/messages/attachment`,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
            body,
        });
        expect(res.statusCode).toBe(400);
    });
});

// --- Attachment retrieval ---

describe('GET /api/messages/:id/attachment', () => {
    it('retrieves uploaded attachment', async () => {
        const jpegData = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Array(100).fill(0x42)]);
        const { body, contentType } = multipartBody(
            { kind: 'image' },
            { name: 'photo.jpg', mime: 'image/jpeg', data: jpegData },
        );
        const upload = await app.inject({
            method: 'POST', url: `/api/circles/${circleId}/messages/attachment`,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
            body,
        });
        const attachmentUrl = upload.json().attachmentUrl;

        const res = await app.inject({
            method: 'GET', url: attachmentUrl,
            headers: { Authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('image/jpeg');
    });

    it('returns 404 for non-existent message', async () => {
        const res = await app.inject({
            method: 'GET', url: '/api/messages/99999/attachment',
            headers: { Authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(404);
    });
});

// --- Typing indicator ---

describe('POST /api/circles/:id/typing', () => {
    it('returns 204 for circle member', async () => {
        const res = await app.inject({
            method: 'POST', url: `/api/circles/${circleId}/typing`,
            headers: { Authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(204);
    });

    it('rejects non-member', async () => {
        const hash = '$argon2id$v=19$m=65536,t=3,p=4$fakehash';
        db.prepare('INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)')
            .run('outsider@test.com', hash, 'Outsider', Date.now());
        const outsiderId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
        const future = Date.now() + 30 * 86400000;
        db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
            .run('outsider-tok', outsiderId, Date.now(), future);

        const res = await app.inject({
            method: 'POST', url: `/api/circles/${circleId}/typing`,
            headers: { Authorization: 'Bearer outsider-tok' },
        });
        expect(res.statusCode).toBe(403);
    });
});

// --- Reactions ---

describe('message reactions', () => {
    let messageId;

    beforeEach(async () => {
        const res = await app.inject({
            method: 'POST', url: `/api/circles/${circleId}/messages`,
            headers: auth(),
            payload: { body: 'react to me' },
        });
        messageId = res.json().id;
    });

    it('adds a reaction', async () => {
        const res = await app.inject({
            method: 'POST', url: `/api/messages/${messageId}/reactions`,
            headers: auth(),
            payload: { emoji: '👍' },
        });
        expect(res.statusCode).toBe(204);
    });

    it('rejects invalid emoji', async () => {
        const res = await app.inject({
            method: 'POST', url: `/api/messages/${messageId}/reactions`,
            headers: auth(),
            payload: { emoji: '🔥' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('removes a reaction', async () => {
        await app.inject({
            method: 'POST', url: `/api/messages/${messageId}/reactions`,
            headers: auth(),
            payload: { emoji: '❤️' },
        });
        const res = await app.inject({
            method: 'DELETE', url: `/api/messages/${messageId}/reactions/${encodeURIComponent('❤️')}`,
            headers: { Authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(204);
    });

    it('includes reactions in message list', async () => {
        const { userId: bobId } = seedSecondUser(db, circleId);
        const future = Date.now() + 30 * 86400000;
        db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
            .run('bob-tok', bobId, Date.now(), future);

        await app.inject({
            method: 'POST', url: `/api/messages/${messageId}/reactions`,
            headers: auth(),
            payload: { emoji: '😂' },
        });
        await app.inject({
            method: 'POST', url: `/api/messages/${messageId}/reactions`,
            headers: { Authorization: 'Bearer bob-tok', 'Content-Type': 'application/json' },
            payload: { emoji: '😂' },
        });

        const res = await app.inject({
            method: 'GET', url: `/api/circles/${circleId}/messages`,
            headers: { Authorization: `Bearer ${token}` },
        });
        const msgs = res.json().messages;
        const rx = msgs.find(m => m.id === messageId)?.reactions;
        expect(rx).toHaveLength(1);
        expect(rx[0].emoji).toBe('😂');
        expect(rx[0].userIds).toHaveLength(2);
    });
});

// --- Read receipts ---

describe('read receipts', () => {
    it('marks messages as read', async () => {
        const { userId: bobId } = seedSecondUser(db, circleId);
        const future = Date.now() + 30 * 86400000;
        db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
            .run('bob-tok', bobId, Date.now(), future);
        db.prepare('UPDATE users SET read_receipts_enabled = 1 WHERE id IN (?, ?)').run(userId, bobId);

        const sent = await app.inject({
            method: 'POST', url: `/api/circles/${circleId}/messages`,
            headers: auth(),
            payload: { body: 'read me' },
        });
        const msgId = sent.json().id;

        const res = await app.inject({
            method: 'POST', url: '/api/messages/read-batch',
            headers: { Authorization: 'Bearer bob-tok', 'Content-Type': 'application/json' },
            payload: { messageIds: [msgId] },
        });
        expect(res.statusCode).toBe(204);
    });
});
