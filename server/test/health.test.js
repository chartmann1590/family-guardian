import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import locationRoutes from '../src/routes/locations.js';
import { createTestDb, seedUser, seedSecondUser } from './helpers.js';

let db, app, token, userId, circleId, bobId;

beforeAll(async () => {
    db = createTestDb();
    const { userId: uid, circleId: cid } = seedUser(db);
    userId = uid;
    circleId = cid;
    const { userId: bid } = seedSecondUser(db, circleId);
    bobId = bid;

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

describe('GET /api/circles/:id/health', () => {
    it('returns members with health data', async () => {
        const now = Date.now();
        db.prepare(
            `INSERT INTO locations (user_id, lat, lng, battery_pct, activity, recorded_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, battery_pct=excluded.battery_pct, activity=excluded.activity, recorded_at=excluded.recorded_at`
        ).run(userId, 37.77, -122.41, 85, 'driving', now);
        db.prepare(
            `INSERT INTO locations (user_id, lat, lng, battery_pct, activity, recorded_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, battery_pct=excluded.battery_pct, activity=excluded.activity, recorded_at=excluded.recorded_at`
        ).run(bobId, 37.78, -122.42, 30, 'still', now - 600000);

        const res = await app.inject({
            method: 'GET',
            url: `/api/circles/${circleId}/health`,
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.members).toHaveLength(2);

        const alice = body.members.find(m => m.userId === userId);
        expect(alice).toBeDefined();
        expect(alice.batteryPct).toBe(85);
        expect(alice.staleMinutes).toBe(0);
        expect(alice.activity).toBe('driving');
        expect(alice.paused).toBe(false);
        expect(alice.drivingScore).toBeNull();

        const bob = body.members.find(m => m.userId === bobId);
        expect(bob).toBeDefined();
        expect(bob.batteryPct).toBe(30);
        expect(bob.staleMinutes).toBeGreaterThanOrEqual(10);
    });

    it('returns 403 for non-member', async () => {
        const outsiderHash = '$argon2id$v=19$m=65536,t=3,p=4$fakehash';
        db.prepare(
            'INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)'
        ).run('outsider@test.com', outsiderHash, 'Outsider', Date.now());
        const outsiderId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
        db.prepare(
            'INSERT INTO circles (name, owner_id, created_at) VALUES (?, ?, ?)'
        ).run('Other Circle', outsiderId, Date.now());
        const outsiderCircleId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
        db.prepare(
            'INSERT INTO circle_members (circle_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
        ).run(outsiderCircleId, outsiderId, 'admin', Date.now());
        db.prepare(
            'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
        ).run('outsider-token', outsiderId, Date.now(), Date.now() + 86400000);

        const res = await app.inject({
            method: 'GET',
            url: `/api/circles/${circleId}/health`,
            headers: { authorization: 'Bearer outsider-token' },
        });
        expect(res.statusCode).toBe(403);
    });

    it('shows paused member with paused flag', async () => {
        const pausedUntil = Date.now() + 3600000;
        db.prepare('UPDATE users SET paused_until = ? WHERE id = ?').run(pausedUntil, bobId);

        const res = await app.inject({
            method: 'GET',
            url: `/api/circles/${circleId}/health`,
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        const bob = res.json().members.find(m => m.userId === bobId);
        expect(bob.paused).toBe(true);
        expect(bob.pausedUntil).toBe(pausedUntil);
    });

    it('includes latest check-in status', async () => {
        db.prepare('UPDATE users SET paused_until = NULL WHERE id = ?').run(bobId);
        const now = Date.now();
        db.prepare(
            'INSERT INTO check_ins (user_id, circle_id, status, lat, lng, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(bobId, circleId, 'safe_home', 37.78, -122.42, now);

        const res = await app.inject({
            method: 'GET',
            url: `/api/circles/${circleId}/health`,
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        const bob = res.json().members.find(m => m.userId === bobId);
        expect(bob.checkinStatus).toBe('safe_home');
        expect(bob.checkinAt).toBe(now);
    });

    it('caches driving score across calls within TTL', async () => {
        const now = Date.now();
        db.prepare(
            `INSERT INTO trips (user_id, circle_id, started_at, ended_at, mode, distance_m, max_speed_mps)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(userId, circleId, now - 3600000, now, 'driving', 5000, 15);

        const res1 = await app.inject({
            method: 'GET',
            url: `/api/circles/${circleId}/health`,
            headers: { authorization: `Bearer ${token}` },
        });
        const res2 = await app.inject({
            method: 'GET',
            url: `/api/circles/${circleId}/health`,
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res1.json().members.find(m => m.userId === userId).drivingScore)
            .toBe(res2.json().members.find(m => m.userId === userId).drivingScore);
    });

    it('returns 400 for invalid circle id', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/circles/abc/health',
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 401 without auth', async () => {
        const res = await app.inject({
            method: 'GET',
            url: `/api/circles/${circleId}/health`,
        });
        expect(res.statusCode).toBe(401);
    });
});
