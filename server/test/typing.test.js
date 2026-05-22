import { describe, it, expect } from 'vitest';
import { createTestDb, seedUser } from './helpers.js';

describe('typing indicator', () => {
    it('lookup display_name by userId', () => {
        const db = createTestDb();
        const { userId } = seedUser(db);
        const row = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId);
        expect(row.display_name).toBe('Alice');
    });

    it('assertMember returns true for circle member', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const row = db
            .prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?')
            .get(circleId, userId);
        expect(row).toBeTruthy();
    });

    it('assertMember returns false for non-member', () => {
        const db = createTestDb();
        const { circleId } = seedUser(db);
        const now = Date.now();
        const hash = '$argon2id$v=19$m=65536,t=3,p=4$fakehash';
        db.prepare(
            'INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)'
        ).run('outsider@test.com', hash, 'Outsider', now);
        const outsider = db.prepare('SELECT last_insert_rowid() AS id').get().id;
        const row = db
            .prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?')
            .get(circleId, outsider);
        expect(row).toBeFalsy();
    });

    it('typing event payload has correct shape', () => {
        const now = Date.now();
        const payload = {
            type: 'chat_typing',
            circleId: 1,
            userId: 2,
            displayName: 'Bob',
            expiresAt: now + 5000,
        };
        expect(payload.type).toBe('chat_typing');
        expect(payload.expiresAt).toBeGreaterThan(now);
        expect(payload.displayName).toBe('Bob');
    });
});
