import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import alertPrefsRoutes from '../src/routes/alertPrefs.js';
import { createTestDb, seedUser } from './helpers.js';

let db, app, token, userId;

beforeEach(async () => {
    db = createTestDb();
    const { userId: uid } = seedUser(db);
    userId = uid;
    const future = Date.now() + 30 * 86400000;
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .run('test-tok', userId, Date.now(), future);
    token = 'test-tok';

    app = Fastify({ logger: false });
    await app.register(cookie, { secret: 'test-secret' });
    await app.register(formbody);
    await app.register(rateLimit, { global: false });
    await app.register(alertPrefsRoutes, { db });
    await app.ready();
});

afterEach(async () => {
    await app.close();
    db.close();
});

function auth() {
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

describe('digest prefs', () => {
    it('returns default digest schedule', async () => {
        const res = await app.inject({
            method: 'GET', url: '/api/users/me/alert-prefs',
            headers: auth(),
        });
        expect(res.statusCode).toBe(200);
        const p = res.json();
        expect(p.digestDayOfWeek).toBe(0);
        expect(p.digestHourLocal).toBe(18);
        expect(p.digestTimezone).toBe('Etc/UTC');
    });

    it('updates digest timezone', async () => {
        const res = await app.inject({
            method: 'PATCH', url: '/api/users/me/alert-prefs',
            headers: auth(),
            payload: { digestTimezone: 'Europe/Paris' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().digestTimezone).toBe('Europe/Paris');
    });

    it('updates digest day and hour', async () => {
        const res = await app.inject({
            method: 'PATCH', url: '/api/users/me/alert-prefs',
            headers: auth(),
            payload: { digestDayOfWeek: 6, digestHourLocal: 9 },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().digestDayOfWeek).toBe(6);
        expect(res.json().digestHourLocal).toBe(9);
    });
});
