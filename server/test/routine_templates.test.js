import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import routineRoutes from '../src/routes/routines.js';
import { createTestDb, seedUser } from './helpers.js';
import { ROUTINE_TEMPLATES } from '../src/routineTemplates.js';

let db, app, token, userId, circleId, placeId;

beforeEach(async () => {
    db = createTestDb();
    const { userId: uid, circleId: cid } = seedUser(db);
    userId = uid;
    circleId = cid;
    db.prepare(
        'INSERT INTO places (circle_id, name, lat, lng, radius_m, alerts_on_enter, alerts_on_exit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(circleId, 'School', 40.7, -74, 100, 0, 0, Date.now());
    placeId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

    const future = Date.now() + 30 * 86400000;
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .run('tok', userId, Date.now(), future);
    token = 'tok';

    app = Fastify({ logger: false });
    await app.register(cookie, { secret: 'test-secret' });
    await app.register(formbody);
    await app.register(rateLimit, { global: false });
    await app.register(routineRoutes, { db });
    await app.ready();
});

afterEach(async () => {
    await app.close();
    db.close();
});

describe('routine templates', () => {
    it('GET /api/routine-templates returns 5 templates', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/routine-templates' });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBe(ROUTINE_TEMPLATES.length);
        expect(body.length).toBeGreaterThanOrEqual(5);
        expect(body[0]).toHaveProperty('id');
        expect(body[0]).toHaveProperty('title');
        expect(body[0]).toHaveProperty('items');
    });

    it('POST /from-template school-day creates 10 routines (2 items × 5 weekdays)', async () => {
        const res = await app.inject({
            method: 'POST', url: '/api/users/me/routines/from-template',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            payload: { templateId: 'school-day', placeId },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.total).toBe(10);
        expect(body.created).toHaveLength(10);
        expect(body.skipped).toHaveLength(0);

        const rows = db.prepare("SELECT * FROM routines WHERE source = 'manual'").all();
        expect(rows).toHaveLength(10);
    });

    it('applying same template twice does not duplicate', async () => {
        const payload = { templateId: 'school-day', placeId };
        await app.inject({
            method: 'POST', url: '/api/users/me/routines/from-template',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            payload,
        });
        const second = await app.inject({
            method: 'POST', url: '/api/users/me/routines/from-template',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            payload,
        });
        expect(second.statusCode).toBe(200);
        const body = second.json();
        expect(body.created).toHaveLength(0);
        expect(body.skipped).toHaveLength(10);

        const rows = db.prepare('SELECT COUNT(*) AS c FROM routines').get();
        expect(rows.c).toBe(10);
    });

    it('returns 404 for unknown template', async () => {
        const res = await app.inject({
            method: 'POST', url: '/api/users/me/routines/from-template',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            payload: { templateId: 'nonsense', placeId },
        });
        expect(res.statusCode).toBe(404);
    });

    it('returns 400 for place outside caller circle', async () => {
        const res = await app.inject({
            method: 'POST', url: '/api/users/me/routines/from-template',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            payload: { templateId: 'school-day', placeId: 99999 },
        });
        expect(res.statusCode).toBe(400);
    });
});
