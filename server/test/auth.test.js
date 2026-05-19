import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, extractToken, lookupSession } from '../src/auth.js';
import { createTestDb, seedUser } from './helpers.js';

describe('auth', () => {
    describe('hashPassword / verifyPassword', () => {
        it('hashes and verifies a password', async () => {
            const hash = await hashPassword('hunter2');
            expect(hash).toBeTruthy();
            expect(await verifyPassword(hash, 'hunter2')).toBe(true);
        });

        it('rejects wrong password', async () => {
            const hash = await hashPassword('hunter2');
            expect(await verifyPassword(hash, 'wrong')).toBe(false);
        });

        it('returns false for malformed hash', async () => {
            expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
        });
    });

    describe('extractToken', () => {
        it('extracts from Authorization header', () => {
            const req = { headers: { authorization: 'Bearer abc123' }, cookies: {} };
            expect(extractToken(req)).toBe('abc123');
        });

        it('extracts from cookie', () => {
            const req = { headers: {}, cookies: { fg_session: 'tok_cookie' } };
            expect(extractToken(req)).toBe('tok_cookie');
        });

        it('prefers header over cookie', () => {
            const req = { headers: { authorization: 'Bearer from_header' }, cookies: { fg_session: 'from_cookie' } };
            expect(extractToken(req)).toBe('from_header');
        });

        it('returns null when nothing present', () => {
            const req = { headers: {}, cookies: {} };
            expect(extractToken(req)).toBeNull();
        });
    });

    describe('lookupSession', () => {
        it('returns null for missing token', () => {
            const db = createTestDb();
            expect(lookupSession(db, null)).toBeNull();
        });

        it('returns null for unknown token', () => {
            const db = createTestDb();
            expect(lookupSession(db, 'nonexistent')).toBeNull();
        });

        it('returns session for valid token', () => {
            const db = createTestDb();
            const { userId } = seedUser(db);
            const future = Date.now() + 30 * 24 * 60 * 60 * 1000;
            db.prepare(
                'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
            ).run('test-token', userId, Date.now(), future);
            const session = lookupSession(db, 'test-token');
            expect(session).toBeTruthy();
            expect(session.userId).toBe(userId);
            expect(session.displayName).toBe('Alice');
        });

        it('returns null for expired token and deletes it', () => {
            const db = createTestDb();
            const { userId } = seedUser(db);
            const past = Date.now() - 1000;
            db.prepare(
                'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
            ).run('expired-token', userId, past - 1000, past);
            expect(lookupSession(db, 'expired-token')).toBeNull();
            const row = db.prepare('SELECT 1 FROM sessions WHERE token = ?').get('expired-token');
            expect(row).toBeUndefined();
        });
    });
});
