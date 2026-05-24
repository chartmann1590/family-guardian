import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import timelineRoutes from '../src/routes/timeline.js';
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
    await app.register(timelineRoutes, { db });
    await app.ready();
});

afterAll(async () => {
    await app.close();
    db.close();
});

describe('GET /api/circles/:circleId/members/:userId/timeline', () => {
    it('returns merged timeline items in correct order', async () => {
        const now = Date.now();
        const hour = 3600000;

        db.prepare(
            `INSERT INTO places (circle_id, name, lat, lng, radius_m, alerts_on_enter, alerts_on_exit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(circleId, 'School', 37.77, -122.41, 150, 1, 0, Date.now());
        const placeId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

        db.prepare(
            `INSERT INTO visits (user_id, circle_id, place_id, lat, lng, started_at, ended_at, point_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(userId, circleId, placeId, 37.77, -122.41, now - 10 * hour, now - 8 * hour, 5);
        db.prepare(
            `INSERT INTO visits (user_id, circle_id, place_id, lat, lng, started_at, ended_at, point_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(userId, circleId, placeId, 37.77, -122.41, now - 3 * hour, now - 2 * hour, 3);

        db.prepare(
            `INSERT INTO trips (user_id, circle_id, started_at, ended_at, mode, distance_m, max_speed_mps, start_lat, start_lng, end_lat, end_lng)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(userId, circleId, now - 5 * hour, now - 4 * hour, 'driving', 10000, 20, 37.77, -122.41, 37.78, -122.42);

        db.prepare(
            `INSERT INTO check_ins (user_id, circle_id, status, lat, lng, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).run(userId, circleId, 'safe_home', 37.77, -122.41, now - hour);

        const res = await app.inject({
            method: 'GET',
            url: `/api/circles/${circleId}/members/${userId}/timeline?days=1`,
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.items.length).toBeGreaterThanOrEqual(5);

        const kinds = body.items.map(i => i.kind);
        expect(kinds).toContain('visit_started');
        expect(kinds).toContain('visit_ended');
        expect(kinds).toContain('trip_started');
        expect(kinds).toContain('trip_ended');
        expect(kinds).toContain('check_in');

        for (let i = 1; i < body.items.length; i++) {
            expect(body.items[i].at).toBeLessThanOrEqual(body.items[i - 1].at);
        }
    });

    it('respects limit parameter', async () => {
        const allRes = await app.inject({
            method: 'GET',
            url: `/api/circles/${circleId}/members/${userId}/timeline?days=7`,
            headers: { authorization: `Bearer ${token}` },
        });
        const allCount = allRes.json().items.length;
        if (allCount <= 2) return;
        const res = await app.inject({
            method: 'GET',
            url: `/api/circles/${circleId}/members/${userId}/timeline?days=7&limit=2`,
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().items.length).toBeLessThanOrEqual(2);
    });

    it('returns cursor when more items exist', async () => {
        const allRes = await app.inject({
            method: 'GET',
            url: `/api/circles/${circleId}/members/${userId}/timeline?days=7`,
            headers: { authorization: `Bearer ${token}` },
        });
        const all = allRes.json();
        if (all.items.length < 2) return;
        const pagedRes = await app.inject({
            method: 'GET',
            url: `/api/circles/${circleId}/members/${userId}/timeline?days=7&limit=1`,
            headers: { authorization: `Bearer ${token}` },
        });
        expect(pagedRes.statusCode).toBe(200);
        const paged = pagedRes.json();
        expect(paged.items.length).toBeLessThanOrEqual(1);
        if (all.items.length > 1) {
            expect(paged.cursor).not.toBeNull();
        }
    });

    it('filters with before cursor', async () => {
        const allRes = await app.inject({
            method: 'GET',
            url: `/api/circles/${circleId}/members/${userId}/timeline?days=7`,
            headers: { authorization: `Bearer ${token}` },
        });
        const all = allRes.json();
        if (all.items.length < 2) return;
        const cursor = all.items[0].at;
        const pagedRes = await app.inject({
            method: 'GET',
            url: `/api/circles/${circleId}/members/${userId}/timeline?days=7&before=${cursor}`,
            headers: { authorization: `Bearer ${token}` },
        });
        expect(pagedRes.statusCode).toBe(200);
        const paged = pagedRes.json();
        for (const item of paged.items) {
            expect(item.at).toBeLessThan(cursor);
        }
    });

    it('returns 403 for non-member', async () => {
        const outsiderHash = '$argon2id$v=19$m=65536,t=3,p=4$fakehash';
        db.prepare(
            'INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)'
        ).run('outsider2@test.com', outsiderHash, 'Outsider2', Date.now());
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
        ).run('outsider2-token', outsiderId, Date.now(), Date.now() + 86400000);

        const res = await app.inject({
            method: 'GET',
            url: `/api/circles/${circleId}/members/${userId}/timeline?days=7`,
            headers: { authorization: 'Bearer outsider2-token' },
        });
        expect(res.statusCode).toBe(403);
    });

    it('returns 400 for invalid params', async () => {
        const res = await app.inject({
            method: 'GET',
            url: `/api/circles/abc/members/def/timeline?days=7`,
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(400);
    });

    it('self-view returns 200 without logView', async () => {
        const res = await app.inject({
            method: 'GET',
            url: `/api/circles/${circleId}/members/${userId}/timeline?days=7`,
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().items).toBeInstanceOf(Array);
    });
});
