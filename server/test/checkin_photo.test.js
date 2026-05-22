import { describe, it, expect } from 'vitest';
import { createTestDb, seedUser } from './helpers.js';

describe('checkin_photos migration', () => {
    it('adds photo_path column to check_ins', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        db.prepare(
            'INSERT INTO check_ins (user_id, circle_id, status, created_at, photo_path) VALUES (?, ?, ?, ?, ?)'
        ).run(userId, circleId, 'safe_home', Date.now(), 'checkins/1.jpg');

        const row = db.prepare('SELECT * FROM check_ins WHERE photo_path IS NOT NULL').get();
        expect(row.photo_path).toBe('checkins/1.jpg');
    });

    it('allows NULL photo_path for text-only check-ins', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        db.prepare(
            'INSERT INTO check_ins (user_id, circle_id, status, created_at) VALUES (?, ?, ?, ?)'
        ).run(userId, circleId, 'out_safe', Date.now());

        const row = db.prepare('SELECT * FROM check_ins WHERE status = ?').get('out_safe');
        expect(row.photo_path).toBeNull();
    });

    it('stores multiple check-ins with and without photos', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);

        db.prepare(
            'INSERT INTO check_ins (user_id, circle_id, status, created_at) VALUES (?, ?, ?, ?)'
        ).run(userId, circleId, 'safe_home', Date.now());

        db.prepare(
            'INSERT INTO check_ins (user_id, circle_id, status, created_at, photo_path) VALUES (?, ?, ?, ?, ?)'
        ).run(userId, circleId, 'heading_home', Date.now(), 'checkins/2.png');

        const rows = db.prepare('SELECT * FROM check_ins ORDER BY id').all();
        expect(rows).toHaveLength(2);
        expect(rows[0].photo_path).toBeNull();
        expect(rows[1].photo_path).toBe('checkins/2.png');
    });
});
