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

describe('alert snooze', () => {
    it('sets a snooze', async () => {
        const res = await app.inject({
            method: 'POST', url: '/api/users/me/alert-snooze',
            headers: auth(),
            payload: { alertType: 'low_battery', durationMinutes: 60 },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().ok).toBe(true);
        expect(res.json().snoozeUntil).toBeGreaterThan(Date.now());
    });

    it('lists active snoozes', async () => {
        await app.inject({
            method: 'POST', url: '/api/users/me/alert-snooze',
            headers: auth(),
            payload: { alertType: 'speeding', durationMinutes: 240 },
        });
        const res = await app.inject({
            method: 'GET', url: '/api/users/me/alert-snoozes',
            headers: auth(),
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().snoozes).toHaveLength(1);
        expect(res.json().snoozes[0].alertType).toBe('speeding');
    });

    it('cancels a snooze', async () => {
        await app.inject({
            method: 'POST', url: '/api/users/me/alert-snooze',
            headers: auth(),
            payload: { alertType: 'speeding', durationMinutes: 60 },
        });
        const del = await app.inject({
            method: 'DELETE', url: '/api/users/me/alert-snooze/speeding',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (del.statusCode !== 200) console.log('DELETE body:', del.body.toString());
        expect(del.statusCode).toBe(200);
        const delBody = del.json();
        expect(delBody.ok).toBe(true);
        const list = await app.inject({
            method: 'GET', url: '/api/users/me/alert-snoozes',
            headers: auth(),
        });
        expect(list.json().snoozes).toHaveLength(0);
    });

    it('rejects snooze on sos_active', async () => {
        const res = await app.inject({
            method: 'POST', url: '/api/users/me/alert-snooze',
            headers: auth(),
            payload: { alertType: 'sos_active', durationMinutes: 60 },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBe('cannot_snooze_type');
    });

    it('rejects snooze on crash_pending', async () => {
        const res = await app.inject({
            method: 'POST', url: '/api/users/me/alert-snooze',
            headers: auth(),
            payload: { alertType: 'crash_pending', durationMinutes: 60 },
        });
        expect(res.statusCode).toBe(400);
    });

    it('includes digest fields in alert prefs', async () => {
        const res = await app.inject({
            method: 'GET', url: '/api/users/me/alert-prefs',
            headers: auth(),
        });
        expect(res.statusCode).toBe(200);
        const prefs = res.json();
        expect(prefs.digestDayOfWeek).toBeDefined();
        expect(prefs.digestHourLocal).toBeDefined();
        expect(prefs.digestTimezone).toBeDefined();
    });

    it('updates digest schedule', async () => {
        const res = await app.inject({
            method: 'PATCH', url: '/api/users/me/alert-prefs',
            headers: auth(),
            payload: { digestDayOfWeek: 6, digestHourLocal: 8, digestTimezone: 'America/New_York' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().digestDayOfWeek).toBe(6);
        expect(res.json().digestHourLocal).toBe(8);
        expect(res.json().digestTimezone).toBe('America/New_York');
    });
});
