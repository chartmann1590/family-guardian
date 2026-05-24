import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import placeRoutes from '../src/routes/places.js';
import { createTestDb, seedUser, seedSecondUser } from './helpers.js';

let db, app, token, userId, circleId, bobId, placeId;

beforeAll(async () => {
    db = createTestDb();
    const { userId: uid, circleId: cid } = seedUser(db);
    userId = uid;
    circleId = cid;
    const { userId: bid } = seedSecondUser(db, circleId);
    bobId = bid;

    db.prepare(
        `INSERT INTO places (circle_id, name, lat, lng, radius_m, alerts_on_enter, alerts_on_exit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(circleId, 'School', 37.77, -122.41, 150, 1, 0, Date.now());
    placeId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

    const future = Date.now() + 30 * 24 * 60 * 60 * 1000;
    db.prepare(
        'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run('test-token', userId, Date.now(), future);
    token = 'test-token';

    app = Fastify();
    await app.register(cookie, { secret: 'test-secret' });
    await app.register(formbody);
    await app.register(placeRoutes, { db });
    await app.ready();
});

afterAll(async () => {
    await app.close();
    db.close();
});

describe('GET /api/places/:id/analytics', () => {
    it('returns perMember stats with correct counts', async () => {
        const now = Date.now();
        const hour = 3600000;

        db.prepare(
            `INSERT INTO visits (user_id, circle_id, place_id, lat, lng, started_at, ended_at, point_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(userId, circleId, placeId, 37.77, -122.41, now - 10 * hour, now - 8 * hour, 5);
        db.prepare(
            `INSERT INTO visits (user_id, circle_id, place_id, lat, lng, started_at, ended_at, point_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(userId, circleId, placeId, 37.77, -122.41, now - 3 * hour, now - 2 * hour, 3);
        db.prepare(
            `INSERT INTO visits (user_id, circle_id, place_id, lat, lng, started_at, ended_at, point_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(bobId, circleId, placeId, 37.77, -122.41, now - 5 * hour, now - 4 * hour, 2);

        const res = await app.inject({
            method: 'GET',
            url: `/api/places/${placeId}/analytics?days=7`,
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.placeId).toBe(placeId);
        expect(body.placeName).toBe('School');
        expect(body.days).toBe(7);
        expect(body.perMember).toHaveLength(2);

        const alice = body.perMember.find((m) => m.userId === userId);
        expect(alice.visitCount).toBe(2);
        expect(alice.totalDwellMs).toBe(3 * hour);
        expect(alice.longestDwellMs).toBe(2 * hour);

        const bob = body.perMember.find((m) => m.userId === bobId);
        expect(bob.visitCount).toBe(1);
    });

    it('clamps days to [1, 90]', async () => {
        const res = await app.inject({
            method: 'GET',
            url: `/api/places/${placeId}/analytics?days=0`,
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().days).toBe(1);

        const res2 = await app.inject({
            method: 'GET',
            url: `/api/places/${placeId}/analytics?days=999`,
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res2.statusCode).toBe(200);
        expect(res2.json().days).toBe(90);
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
            url: `/api/places/${placeId}/analytics?days=30`,
            headers: { authorization: 'Bearer outsider-token' },
        });
        expect(res.statusCode).toBe(403);
    });
});
