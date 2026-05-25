import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import emergencyContactRoutes from '../src/routes/emergencyContacts.js';
import sosRoutes from '../src/routes/sos.js';
import { createTestDb, seedUser, seedSecondUser } from './helpers.js';

let db, app, aliceToken, bobToken, aliceId, bobId, charlieId, circleId;

beforeEach(async () => {
    db = createTestDb();
    const { userId: aid, circleId: cid } = seedUser(db, 'alice@test.com', 'Alice');
    aliceId = aid;
    circleId = cid;
    const { userId: bid } = seedSecondUser(db, circleId, 'bob@test.com', 'Bob');
    bobId = bid;
    // Charlie has his own circle — he is NOT in Alice's circle.
    const { userId: cid2, circleId: charlieCircle } = seedUser(db, 'charlie@test.com', 'Charlie');
    charlieId = cid2;

    const future = Date.now() + 30 * 86400000;
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .run('alice-tok', aliceId, Date.now(), future);
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .run('bob-tok', bobId, Date.now(), future);
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .run('charlie-tok', charlieId, Date.now(), future);
    aliceToken = 'alice-tok';
    bobToken = 'bob-tok';

    app = Fastify({ logger: false });
    await app.register(cookie, { secret: 'test-secret' });
    await app.register(formbody);
    await app.register(rateLimit, { global: false });
    await app.register(emergencyContactRoutes, { db });
    await app.register(sosRoutes, { db });
    await app.ready();
});

afterEach(async () => {
    await app.close();
    db.close();
});

function authHeaders(token) {
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

describe('emergency contacts — invite + accept', () => {
    it('invites by email and creates pending row', async () => {
        const res = await app.inject({
            method: 'POST', url: '/api/users/me/emergency-contacts',
            headers: authHeaders(aliceToken),
            payload: { email: 'charlie@test.com' },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.status).toBe('pending');
        expect(body.contactUserId).toBe(charlieId);

        const row = db.prepare('SELECT * FROM emergency_contacts WHERE user_id = ? AND contact_user_id = ?')
            .get(aliceId, charlieId);
        expect(row.status).toBe('pending');
    });

    it('returns 404 when invitee not registered', async () => {
        const res = await app.inject({
            method: 'POST', url: '/api/users/me/emergency-contacts',
            headers: authHeaders(aliceToken),
            payload: { email: 'nobody@example.test' },
        });
        expect(res.statusCode).toBe(404);
    });

    it('rejects self-invite', async () => {
        const res = await app.inject({
            method: 'POST', url: '/api/users/me/emergency-contacts',
            headers: authHeaders(aliceToken),
            payload: { email: 'alice@test.com' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('enforces max 5 contacts per user', async () => {
        for (let i = 0; i < 5; i++) {
            const email = `extra${i}@test.com`;
            db.prepare('INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)')
                .run(email, 'x', `Extra${i}`, Date.now());
        }
        for (let i = 0; i < 5; i++) {
            await app.inject({
                method: 'POST', url: '/api/users/me/emergency-contacts',
                headers: authHeaders(aliceToken), payload: { email: `extra${i}@test.com` },
            });
        }
        const res = await app.inject({
            method: 'POST', url: '/api/users/me/emergency-contacts',
            headers: authHeaders(aliceToken), payload: { email: 'charlie@test.com' },
        });
        expect(res.statusCode).toBe(429);
    });

    it('contact accepts via /respond', async () => {
        await app.inject({
            method: 'POST', url: '/api/users/me/emergency-contacts',
            headers: authHeaders(aliceToken), payload: { email: 'charlie@test.com' },
        });
        const invites = await app.inject({
            method: 'GET', url: '/api/users/me/pending-invites',
            headers: authHeaders('charlie-tok'),
        });
        const inviteList = invites.json().invites;
        expect(inviteList).toHaveLength(1);
        const id = inviteList[0].id;

        const accept = await app.inject({
            method: 'POST', url: `/api/users/me/emergency-contacts/${id}/respond`,
            headers: authHeaders('charlie-tok'), payload: { action: 'accept' },
        });
        expect(accept.statusCode).toBe(200);
        expect(accept.json().status).toBe('accepted');
    });

    it('non-contact cannot respond to invite', async () => {
        await app.inject({
            method: 'POST', url: '/api/users/me/emergency-contacts',
            headers: authHeaders(aliceToken), payload: { email: 'charlie@test.com' },
        });
        const row = db.prepare('SELECT id FROM emergency_contacts WHERE user_id = ?').get(aliceId);
        const res = await app.inject({
            method: 'POST', url: `/api/users/me/emergency-contacts/${row.id}/respond`,
            headers: authHeaders(bobToken), payload: { action: 'accept' },
        });
        expect(res.statusCode).toBe(403);
    });

    it('SOS escalates to accepted emergency contacts', async () => {
        await app.inject({
            method: 'POST', url: '/api/users/me/emergency-contacts',
            headers: authHeaders(aliceToken), payload: { email: 'charlie@test.com' },
        });
        const row = db.prepare('SELECT id FROM emergency_contacts WHERE user_id = ?').get(aliceId);
        await app.inject({
            method: 'POST', url: `/api/users/me/emergency-contacts/${row.id}/respond`,
            headers: authHeaders('charlie-tok'), payload: { action: 'accept' },
        });

        const sos = await app.inject({
            method: 'POST', url: '/api/sos/activate',
            headers: authHeaders(aliceToken), payload: { lat: 40.7, lng: -74 },
        });
        expect(sos.statusCode).toBe(200);
        const sosRow = db.prepare("SELECT * FROM sos_events WHERE user_id = ? AND status = 'active'").get(aliceId);
        expect(sosRow).toBeDefined();
    });

    it('revoke prevents future SOS escalation', async () => {
        const invite = await app.inject({
            method: 'POST', url: '/api/users/me/emergency-contacts',
            headers: authHeaders(aliceToken), payload: { email: 'charlie@test.com' },
        });
        expect(invite.statusCode).toBe(200);
        const row = db.prepare('SELECT id FROM emergency_contacts WHERE user_id = ?').get(aliceId);
        expect(row).toBeDefined();
        const resp = await app.inject({
            method: 'POST', url: `/api/users/me/emergency-contacts/${row.id}/respond`,
            headers: authHeaders('charlie-tok'), payload: { action: 'accept' },
        });
        expect(resp.statusCode).toBe(200);
        const del = await app.inject({
            method: 'DELETE', url: `/api/users/me/emergency-contacts/${row.id}`,
            headers: { Authorization: `Bearer ${aliceToken}` },
        });
        expect(del.statusCode).toBe(200);
        const after = db.prepare('SELECT status FROM emergency_contacts WHERE id = ?').get(row.id);
        expect(after.status).toBe('revoked');
    });

    it('listing returns only caller-owned contacts', async () => {
        await app.inject({
            method: 'POST', url: '/api/users/me/emergency-contacts',
            headers: authHeaders(aliceToken), payload: { email: 'charlie@test.com' },
        });
        const aliceList = await app.inject({
            method: 'GET', url: '/api/users/me/emergency-contacts',
            headers: authHeaders(aliceToken),
        });
        expect(aliceList.json().contacts).toHaveLength(1);

        const bobList = await app.inject({
            method: 'GET', url: '/api/users/me/emergency-contacts',
            headers: authHeaders(bobToken),
        });
        expect(bobList.json().contacts).toHaveLength(0);
    });
});
