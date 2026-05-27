import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import tripShareRoutes from '../src/routes/tripShares.js';
import locationRoutes from '../src/routes/locations.js';
import { createTestDb, seedUser, seedSecondUser } from './helpers.js';

let db, app, token, userId, circleId;

beforeEach(async () => {
    db = createTestDb();
    const seed = seedUser(db);
    userId = seed.userId;
    circleId = seed.circleId;
    const future = Date.now() + 30 * 86400000;
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .run('test-tok', userId, Date.now(), future);
    token = 'test-tok';

    app = Fastify({ logger: false });
    await app.register(cookie, { secret: 'test-secret' });
    await app.register(formbody);
    await app.register(rateLimit, { global: false });
    await app.register(tripShareRoutes, { db });
    await app.register(locationRoutes, { db });
    await app.ready();
});

afterEach(async () => {
    await app.close();
    db.close();
});

function auth() {
    return { Authorization: `Bearer ${token}` };
}

function postShare(body = {}) {
    return app.inject({
        method: 'POST', url: '/api/users/me/trip-shares',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        payload: body,
    });
}

// --- Create shares ---

describe('POST /api/users/me/trip-shares', () => {
    it('creates a share with default duration', async () => {
        const res = await postShare();
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.token).toBeTruthy();
        expect(body.url).toContain('/share/');
        expect(body.expiresAt).toBeGreaterThan(Date.now());
    });

    it('respects custom durationMinutes', async () => {
        const before = Date.now();
        const res = await postShare({ durationMinutes: 120 });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        const twoHoursMs = 120 * 60 * 1000;
        expect(body.expiresAt).toBeGreaterThanOrEqual(before + twoHoursMs - 1000);
        expect(body.expiresAt).toBeLessThanOrEqual(before + twoHoursMs + 5000);
    });

    it('stores destination metadata', async () => {
        const res = await postShare({
            durationMinutes: 30,
            destination: { lat: 40.758, lng: -73.9855, label: 'Times Square' },
        });
        expect(res.statusCode).toBe(200);
        const row = db.prepare('SELECT * FROM trip_share_tokens WHERE token = ?').get(res.json().token);
        expect(row.destination_lat).toBeCloseTo(40.758);
        expect(row.destination_lng).toBeCloseTo(-73.9855);
        expect(row.destination_label).toBe('Times Square');
    });

    it('rejects durationMinutes > 240', async () => {
        const res = await postShare({ durationMinutes: 300 });
        expect(res.statusCode).toBe(400);
    });

    it('rejects durationMinutes < 1', async () => {
        const res = await postShare({ durationMinutes: 0 });
        expect(res.statusCode).toBe(400);
    });

    it('enforces active share limit', async () => {
        for (let i = 0; i < 10; i++) {
            const r = await postShare({ durationMinutes: 240 });
            expect(r.statusCode).toBe(200);
        }
        const res = await postShare();
        expect(res.statusCode).toBe(429);
        expect(res.json().error).toBe('too_many_active_shares');
    });

    it('uses request host in share URL', async () => {
        const res = await app.inject({
            method: 'POST', url: '/api/users/me/trip-shares',
            headers: { ...auth(), 'Content-Type': 'application/json', Host: 'myserver.local:9090' },
            payload: {},
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().url).toMatch(/^http:\/\/myserver\.local:9090\/share\//);
    });
});

// --- List shares ---

describe('GET /api/users/me/trip-shares', () => {
    it('returns empty list initially', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/users/me/trip-shares', headers: auth() });
        expect(res.statusCode).toBe(200);
        expect(res.json().shares).toEqual([]);
    });

    it('lists created shares', async () => {
        await postShare({ durationMinutes: 60 });
        await postShare({ durationMinutes: 120 });
        const res = await app.inject({ method: 'GET', url: '/api/users/me/trip-shares', headers: auth() });
        expect(res.json().shares).toHaveLength(2);
    });
});

// --- Revoke ---

describe('DELETE /api/trip-shares/:token', () => {
    it('revokes an active share', async () => {
        const created = await postShare();
        const shareToken = created.json().token;

        const res = await app.inject({
            method: 'DELETE', url: `/api/trip-shares/${shareToken}`,
            headers: auth(),
        });
        expect(res.statusCode).toBe(200);

        const row = db.prepare('SELECT revoked FROM trip_share_tokens WHERE token = ?').get(shareToken);
        expect(row.revoked).toBe(1);
    });

    it('rejects revoke by non-owner', async () => {
        const created = await postShare();
        const shareToken = created.json().token;

        const { userId: bobId } = seedSecondUser(db, circleId);
        const future = Date.now() + 30 * 86400000;
        db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
            .run('bob-tok', bobId, Date.now(), future);

        const res = await app.inject({
            method: 'DELETE', url: `/api/trip-shares/${shareToken}`,
            headers: { Authorization: 'Bearer bob-tok' },
        });
        expect(res.statusCode).toBe(403);
    });

    it('returns 404 for unknown token', async () => {
        const res = await app.inject({
            method: 'DELETE', url: '/api/trip-shares/nonexistent',
            headers: auth(),
        });
        expect(res.statusCode).toBe(404);
    });
});

// --- Public share page ---

describe('GET /share/:token', () => {
    it('returns HTML for valid share', async () => {
        const created = await postShare();
        const shareToken = created.json().token;

        const res = await app.inject({ method: 'GET', url: `/share/${shareToken}` });
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('text/html');
        expect(res.body).toContain('Live Location Share');
    });

    it('returns 410 for revoked share', async () => {
        const created = await postShare();
        const shareToken = created.json().token;
        db.prepare('UPDATE trip_share_tokens SET revoked = 1 WHERE token = ?').run(shareToken);

        const res = await app.inject({ method: 'GET', url: `/share/${shareToken}` });
        expect(res.statusCode).toBe(410);
    });

    it('returns 410 for expired share', async () => {
        const created = await postShare({ durationMinutes: 1 });
        const shareToken = created.json().token;
        db.prepare('UPDATE trip_share_tokens SET expires_at = ? WHERE token = ?')
            .run(Date.now() - 1000, shareToken);

        const res = await app.inject({ method: 'GET', url: `/share/${shareToken}` });
        expect(res.statusCode).toBe(410);
    });

    it('returns 410 when max views exceeded', async () => {
        const created = await postShare({ maxViews: 5 });
        const shareToken = created.json().token;
        db.prepare('UPDATE trip_share_tokens SET view_count = 5 WHERE token = ?').run(shareToken);

        const res = await app.inject({ method: 'GET', url: `/share/${shareToken}` });
        expect(res.statusCode).toBe(410);
    });
});

// --- Location endpoint ---

describe('GET /share/:token/loc', () => {
    it('returns location data with display name', async () => {
        db.prepare('INSERT INTO locations (user_id, lat, lng, accuracy_m, recorded_at) VALUES (?, ?, ?, ?, ?)')
            .run(userId, 40.7128, -74.006, 10, Date.now());

        const created = await postShare();
        const shareToken = created.json().token;

        const res = await app.inject({ method: 'GET', url: `/share/${shareToken}/loc` });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.displayName).toBe('Alice');
        expect(body.lat).toBeCloseTo(40.7128);
        expect(body.lng).toBeCloseTo(-74.006);
        expect(body.recordedAt).toBeDefined();
    });

    it('includes destination when set', async () => {
        db.prepare('INSERT INTO locations (user_id, lat, lng, accuracy_m, recorded_at) VALUES (?, ?, ?, ?, ?)')
            .run(userId, 40.7128, -74.006, 10, Date.now());

        const created = await postShare({
            destination: { lat: 40.758, lng: -73.9855, label: 'Times Square' },
        });
        const shareToken = created.json().token;

        const res = await app.inject({ method: 'GET', url: `/share/${shareToken}/loc` });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.destination.lat).toBeCloseTo(40.758);
        expect(body.destination.label).toBe('Times Square');
    });

    it('increments view count', async () => {
        db.prepare('INSERT INTO locations (user_id, lat, lng, accuracy_m, recorded_at) VALUES (?, ?, ?, ?, ?)')
            .run(userId, 40.7128, -74.006, 10, Date.now());

        const created = await postShare();
        const shareToken = created.json().token;

        await app.inject({ method: 'GET', url: `/share/${shareToken}/loc` });
        await app.inject({ method: 'GET', url: `/share/${shareToken}/loc` });

        const row = db.prepare('SELECT view_count FROM trip_share_tokens WHERE token = ?').get(shareToken);
        expect(row.view_count).toBe(2);
    });

    it('returns 410 for expired share', async () => {
        const created = await postShare({ durationMinutes: 1 });
        const shareToken = created.json().token;
        db.prepare('UPDATE trip_share_tokens SET expires_at = ? WHERE token = ?')
            .run(Date.now() - 1000, shareToken);

        const res = await app.inject({ method: 'GET', url: `/share/${shareToken}/loc` });
        expect(res.statusCode).toBe(410);
    });

    it('returns null lat/lng when no location posted', async () => {
        const created = await postShare();
        const shareToken = created.json().token;

        const res = await app.inject({ method: 'GET', url: `/share/${shareToken}/loc` });
        expect(res.statusCode).toBe(200);
        expect(res.json().lat).toBeNull();
    });
});
