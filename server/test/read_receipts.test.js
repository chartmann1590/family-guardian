import { describe, it, expect } from 'vitest';
import { createTestDb, seedUser, seedSecondUser } from './helpers.js';

describe('message_reads migration', () => {
    it('creates message_reads table with correct schema', () => {
        const db = createTestDb();
        const { userId: userA, circleId } = seedUser(db);
        const { userId: userB } = seedSecondUser(db, circleId);

        db.prepare(
            'INSERT INTO messages (circle_id, user_id, body, created_at) VALUES (?, ?, ?, ?)'
        ).run(circleId, userA, 'hello', Date.now());
        const msgId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

        db.prepare(
            'INSERT OR IGNORE INTO message_reads (message_id, user_id, read_at) VALUES (?, ?, ?)'
        ).run(msgId, userB, Date.now());

        const rows = db.prepare('SELECT * FROM message_reads').all();
        expect(rows).toHaveLength(1);
        expect(rows[0].message_id).toBe(msgId);
        expect(rows[0].user_id).toBe(userB);
    });

    it('PRIMARY KEY prevents duplicate reads', () => {
        const db = createTestDb();
        const { userId: userA, circleId } = seedUser(db);
        const { userId: userB } = seedSecondUser(db, circleId);

        db.prepare(
            'INSERT INTO messages (circle_id, user_id, body, created_at) VALUES (?, ?, ?, ?)'
        ).run(circleId, userA, 'hello', Date.now());
        const msgId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

        db.prepare(
            'INSERT OR IGNORE INTO message_reads (message_id, user_id, read_at) VALUES (?, ?, ?)'
        ).run(msgId, userB, Date.now());
        db.prepare(
            'INSERT OR IGNORE INTO message_reads (message_id, user_id, read_at) VALUES (?, ?, ?)'
        ).run(msgId, userB, Date.now() + 1000);

        const rows = db.prepare('SELECT * FROM message_reads').all();
        expect(rows).toHaveLength(1);
    });

    it('cascades delete when message is deleted', () => {
        const db = createTestDb();
        const { userId: userA, circleId } = seedUser(db);
        const { userId: userB } = seedSecondUser(db, circleId);

        db.prepare(
            'INSERT INTO messages (circle_id, user_id, body, created_at) VALUES (?, ?, ?, ?)'
        ).run(circleId, userA, 'hello', Date.now());
        const msgId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

        db.prepare(
            'INSERT INTO message_reads (message_id, user_id, read_at) VALUES (?, ?, ?)'
        ).run(msgId, userB, Date.now());

        db.prepare('DELETE FROM messages WHERE id = ?').run(msgId);

        const rows = db.prepare('SELECT * FROM message_reads').all();
        expect(rows).toHaveLength(0);
    });

    it('cascades delete when user is deleted', () => {
        const db = createTestDb();
        const { userId: userA, circleId } = seedUser(db);
        const { userId: userB } = seedSecondUser(db, circleId);

        db.prepare(
            'INSERT INTO messages (circle_id, user_id, body, created_at) VALUES (?, ?, ?, ?)'
        ).run(circleId, userA, 'hello', Date.now());
        const msgId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

        db.prepare(
            'INSERT INTO message_reads (message_id, user_id, read_at) VALUES (?, ?, ?)'
        ).run(msgId, userB, Date.now());

        db.prepare('DELETE FROM circle_members WHERE user_id = ?').run(userB);
        db.prepare('DELETE FROM users WHERE id = ?').run(userB);

        const rows = db.prepare('SELECT * FROM message_reads').all();
        expect(rows).toHaveLength(0);
    });
});

describe('read_receipts_enabled column', () => {
    it('defaults to 0 (disabled)', () => {
        const db = createTestDb();
        const { userId } = seedUser(db);
        const row = db.prepare('SELECT read_receipts_enabled FROM users WHERE id = ?').get(userId);
        expect(row.read_receipts_enabled).toBe(0);
    });

    it('can be toggled on and off', () => {
        const db = createTestDb();
        const { userId } = seedUser(db);

        db.prepare('UPDATE users SET read_receipts_enabled = 1 WHERE id = ?').run(userId);
        expect(db.prepare('SELECT read_receipts_enabled FROM users WHERE id = ?').get(userId).read_receipts_enabled).toBe(1);

        db.prepare('UPDATE users SET read_receipts_enabled = 0 WHERE id = ?').run(userId);
        expect(db.prepare('SELECT read_receipts_enabled FROM users WHERE id = ?').get(userId).read_receipts_enabled).toBe(0);
    });

    it('mutual gate: both users must have flag enabled', () => {
        const db = createTestDb();
        const { userId: userA, circleId } = seedUser(db);
        const { userId: userB } = seedSecondUser(db, circleId);

        db.prepare(
            'INSERT INTO messages (circle_id, user_id, body, created_at) VALUES (?, ?, ?, ?)'
        ).run(circleId, userA, 'hello', Date.now());
        const msgId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

        db.prepare('UPDATE users SET read_receipts_enabled = 1 WHERE id = ?').run(userB);
        let count = db.prepare('SELECT COUNT(*) AS c FROM message_reads').get().c;
        expect(count).toBe(0);

        db.prepare(
            'INSERT OR IGNORE INTO message_reads (message_id, user_id, read_at) VALUES (?, ?, ?)'
        ).run(msgId, userB, Date.now());
        count = db.prepare('SELECT COUNT(*) AS c FROM message_reads').get().c;
        expect(count).toBe(1);
    });

    it('self-reads are skipped', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);

        db.prepare(
            'INSERT INTO messages (circle_id, user_id, body, created_at) VALUES (?, ?, ?, ?)'
        ).run(circleId, userId, 'my msg', Date.now());

        const count = db.prepare('SELECT COUNT(*) AS c FROM message_reads').get().c;
        expect(count).toBe(0);
    });
});
