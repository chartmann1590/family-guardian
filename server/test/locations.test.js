import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import locationRoutes from '../src/routes/locations.js';
import { createTestDb, seedUser } from './helpers.js';

let db, app, token, userId, circleId;

beforeAll(async () => {
    db = createTestDb();
    const { userId: uid, circleId: cid } = seedUser(db);
    userId = uid;
    circleId = cid;

    const future = Date.now() + 30 * 24 * 60 * 60 * 1000;
    db.prepare(
        'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run('test-token', userId, Date.now(), future);
    token = 'test-token';

    app = Fastify();
    await app.register(cookie, { secret: 'test-secret' });
    await app.register(formbody);
    await app.register(locationRoutes, { db });
    await app.ready();
});

afterAll(async () => {
    await app.close();
    db.close();
});

describe('POST /api/locations', () => {
    it('accepts a valid location report', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/locations',
            headers: { authorization: `Bearer ${token}` },
            payload: { lat: 37.7749, lng: -122.4194 },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true });

        const row = db.prepare('SELECT * FROM locations WHERE user_id = ?').get(userId);
        expect(row.lat).toBeCloseTo(37.7749);
        expect(row.lng).toBeCloseTo(-122.4194);
    });

    it('inserts into locations_history', async () => {
        const rows = db.prepare('SELECT * FROM locations_history WHERE user_id = ?').all(userId);
        expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it('clamps recordedAt to now', async () => {
        const future = Date.now() + 1_000_000;
        const res = await app.inject({
            method: 'POST',
            url: '/api/locations',
            headers: { authorization: `Bearer ${token}` },
            payload: { lat: 37.7749, lng: -122.4194, recordedAt: future },
        });
        expect(res.statusCode).toBe(200);
        const row = db.prepare('SELECT recorded_at FROM locations WHERE user_id = ?').get(userId);
        expect(row.recorded_at).toBeLessThan(future);
    });

    it('rejects invalid body', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/locations',
            headers: { authorization: `Bearer ${token}` },
            payload: { lat: 999, lng: -122.4194 },
        });
        expect(res.statusCode).toBe(400);
    });

    it('rejects unauthenticated request', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/locations',
            payload: { lat: 37.7749, lng: -122.4194 },
        });
        expect(res.statusCode).toBe(401);
    });
});
