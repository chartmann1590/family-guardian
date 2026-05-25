import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import locationRoutes from '../src/routes/locations.js';
import { createTestDb, seedUser, seedSecondUser } from './helpers.js';

let db, app, subjectToken, subjectId, watcherId, circleId;

beforeEach(async () => {
    db = createTestDb();
    const { userId: sid, circleId: cid } = seedUser(db, 'subject@test.com', 'Subject');
    subjectId = sid;
    circleId = cid;
    const { userId: wid } = seedSecondUser(db, circleId, 'watcher@test.com', 'Watcher');
    watcherId = wid;

    const future = Date.now() + 30 * 86400000;
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .run('subject-tok', subjectId, Date.now(), future);
    subjectToken = 'subject-tok';

    db.prepare('INSERT OR IGNORE INTO alert_prefs (user_id) VALUES (?)').run(watcherId);
    db.prepare('UPDATE alert_prefs SET low_battery_alerts = 1, low_battery_threshold = 20 WHERE user_id = ?')
        .run(watcherId);

    app = Fastify({ logger: false });
    await app.register(cookie, { secret: 'test-secret' });
    await app.register(formbody);
    await app.register(rateLimit, { global: false });
    await app.register(locationRoutes, { db });
    await app.ready();
});

afterEach(async () => {
    await app.close();
    db.close();
});

async function postLocation(battery) {
    return app.inject({
        method: 'POST',
        url: '/api/locations',
        headers: { Authorization: `Bearer ${subjectToken}`, 'Content-Type': 'application/json' },
        payload: { lat: 40.7, lng: -74, batteryPct: battery, recordedAt: Date.now() },
    });
}

// Low-battery alerts are pub/sub + FCM only (no DB row). With FCM disabled in
// tests, the publish side is unobservable, so we exercise the *response* surface:
// every POST /api/locations must return 200, regardless of where in the
// hysteresis state machine the subject is. A crash in checkLowBattery (e.g.,
// the prior ESM-incompatible require()) would surface as a 500 here.

describe('low battery push edge detection', () => {
    it('does not crash on first location post (state initialization)', async () => {
        const res = await postLocation(50);
        expect(res.statusCode).toBe(200);
    });

    it('does not crash when battery crosses threshold', async () => {
        await postLocation(30);
        const res = await postLocation(15);
        expect(res.statusCode).toBe(200);
    });

    it('does not crash on repeated drops', async () => {
        await postLocation(30);
        await postLocation(15);
        const res = await postLocation(10);
        expect(res.statusCode).toBe(200);
    });

    it('handles battery recovery and re-drop', async () => {
        await postLocation(30);
        await postLocation(15);
        await postLocation(40);
        const res = await postLocation(10);
        expect(res.statusCode).toBe(200);
    });

    it('handles location post without batteryPct', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/locations',
            headers: { Authorization: `Bearer ${subjectToken}`, 'Content-Type': 'application/json' },
            payload: { lat: 40.7, lng: -74, recordedAt: Date.now() },
        });
        expect(res.statusCode).toBe(200);
    });

    it('handles missing watcher prefs gracefully', async () => {
        db.prepare('UPDATE alert_prefs SET low_battery_alerts = 0 WHERE user_id = ?').run(watcherId);
        const res = await postLocation(10);
        expect(res.statusCode).toBe(200);
    });
});
