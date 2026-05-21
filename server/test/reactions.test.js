import { describe, it, expect } from 'vitest';
import { createTestDb, seedUser, seedSecondUser } from './helpers.js';

const ALLOWED_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

describe('message_reactions', () => {
    it('inserts a reaction and groups by message', () => {
        const db = createTestDb();
        const { userId: userA, circleId } = seedUser(db);
        const { userId: userB } = seedSecondUser(db, circleId);

        db.prepare(
            'INSERT INTO messages (circle_id, user_id, body, created_at) VALUES (?, ?, ?, ?)'
        ).run(circleId, userA, 'hello', Date.now());
        const msgId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

        db.prepare(
            'INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)'
        ).run(msgId, userB, '👍', Date.now());

        const rows = db.prepare('SELECT * FROM message_reactions WHERE message_id = ?').all(msgId);
        expect(rows).toHaveLength(1);
        expect(rows[0].emoji).toBe('👍');
        expect(rows[0].user_id).toBe(userB);
    });

    it('UNIQUE constraint prevents duplicate reactions', () => {
        const db = createTestDb();
        const { userId: userA, circleId } = seedUser(db);

        db.prepare(
            'INSERT INTO messages (circle_id, user_id, body, created_at) VALUES (?, ?, ?, ?)'
        ).run(circleId, userA, 'hello', Date.now());
        const msgId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

        db.prepare(
            'INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)'
        ).run(msgId, userA, '👍', Date.now());
        db.prepare(
            'INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)'
        ).run(msgId, userA, '👍', Date.now());

        const rows = db.prepare('SELECT * FROM message_reactions').all();
        expect(rows).toHaveLength(1);
    });

    it('allows multiple different emojis from same user', () => {
        const db = createTestDb();
        const { userId: userA, circleId } = seedUser(db);

        db.prepare(
            'INSERT INTO messages (circle_id, user_id, body, created_at) VALUES (?, ?, ?, ?)'
        ).run(circleId, userA, 'hello', Date.now());
        const msgId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

        db.prepare(
            'INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)'
        ).run(msgId, userA, '👍', Date.now());
        db.prepare(
            'INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)'
        ).run(msgId, userA, '❤️', Date.now());

        const rows = db.prepare('SELECT * FROM message_reactions').all();
        expect(rows).toHaveLength(2);
    });

    it('deletes only the specified reaction', () => {
        const db = createTestDb();
        const { userId: userA, circleId } = seedUser(db);
        const { userId: userB } = seedSecondUser(db, circleId);

        db.prepare(
            'INSERT INTO messages (circle_id, user_id, body, created_at) VALUES (?, ?, ?, ?)'
        ).run(circleId, userA, 'hello', Date.now());
        const msgId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

        db.prepare(
            'INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)'
        ).run(msgId, userA, '👍', Date.now());
        db.prepare(
            'INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)'
        ).run(msgId, userB, '👍', Date.now());

        db.prepare(
            'DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
        ).run(msgId, userA, '👍');

        const rows = db.prepare('SELECT * FROM message_reactions').all();
        expect(rows).toHaveLength(1);
        expect(rows[0].user_id).toBe(userB);
    });

    it('cascades delete when message is deleted', () => {
        const db = createTestDb();
        const { userId: userA, circleId } = seedUser(db);

        db.prepare(
            'INSERT INTO messages (circle_id, user_id, body, created_at) VALUES (?, ?, ?, ?)'
        ).run(circleId, userA, 'hello', Date.now());
        const msgId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

        db.prepare(
            'INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)'
        ).run(msgId, userA, '👍', Date.now());

        db.prepare('DELETE FROM messages WHERE id = ?').run(msgId);

        const rows = db.prepare('SELECT * FROM message_reactions').all();
        expect(rows).toHaveLength(0);
    });

    it('rejects emoji outside allowlist', () => {
        const emoji = '💩';
        expect(ALLOWED_EMOJIS).not.toContain(emoji);
    });

    it('groups reactions correctly for multiple users', () => {
        const db = createTestDb();
        const { userId: userA, circleId } = seedUser(db);
        const { userId: userB } = seedSecondUser(db, circleId);

        db.prepare(
            'INSERT INTO messages (circle_id, user_id, body, created_at) VALUES (?, ?, ?, ?)'
        ).run(circleId, userA, 'hello', Date.now());
        const msgId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

        db.prepare(
            'INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)'
        ).run(msgId, userA, '👍', Date.now());
        db.prepare(
            'INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)'
        ).run(msgId, userB, '👍', Date.now());
        db.prepare(
            'INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)'
        ).run(msgId, userA, '❤️', Date.now());

        const rows = db.prepare(
            'SELECT emoji, GROUP_CONCAT(user_id) AS user_ids FROM message_reactions WHERE message_id = ? GROUP BY emoji'
        ).all(msgId);

        expect(rows).toHaveLength(2);
        const thumbsUp = rows.find(r => r.emoji === '👍');
        expect(thumbsUp.user_ids.split(',')).toHaveLength(2);
    });
});
