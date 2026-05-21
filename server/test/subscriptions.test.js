import { describe, it, expect } from 'vitest';
import { inQuietHours } from '../src/geofence.js';
import { createTestDb, seedUser, seedSecondUser } from './helpers.js';

describe('inQuietHours', () => {
    it('returns false when start or end is null', () => {
        expect(inQuietHours(null, 60, Date.now())).toBe(false);
        expect(inQuietHours(60, null, Date.now())).toBe(false);
        expect(inQuietHours(null, null, Date.now())).toBe(false);
    });

    it('returns true inside normal quiet range', () => {
        const ts = new Date(2026, 0, 1, 23, 30).getTime();
        expect(inQuietHours(22 * 60, 7 * 60, ts)).toBe(true);
    });

    it('returns false outside normal quiet range', () => {
        const ts = new Date(2026, 0, 1, 12, 0).getTime();
        expect(inQuietHours(22 * 60, 7 * 60, ts)).toBe(false);
    });

    it('handles overnight wrap — after midnight', () => {
        const ts = new Date(2026, 0, 1, 3, 0).getTime();
        expect(inQuietHours(22 * 60, 7 * 60, ts)).toBe(true);
    });

    it('handles overnight wrap — before start', () => {
        const ts = new Date(2026, 0, 1, 21, 0).getTime();
        expect(inQuietHours(22 * 60, 7 * 60, ts)).toBe(false);
    });

    it('returns false at exact end boundary (exclusive)', () => {
        const ts = new Date(2026, 0, 1, 7, 0).getTime();
        expect(inQuietHours(22 * 60, 7 * 60, ts)).toBe(false);
    });
});

describe('place_subscriptions table', () => {
    it('allows inserting and querying subscriptions', () => {
        const db = createTestDb();
        const { userId: userA, circleId } = seedUser(db);
        const { userId: userB } = seedSecondUser(db, circleId);

        db.prepare(
            'INSERT INTO places (circle_id, name, lat, lng, radius_m, alerts_on_enter, alerts_on_exit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(circleId, 'Home', 37.7749, -122.4194, 100, 1, 1, Date.now());

        db.prepare(
            'INSERT INTO place_subscriptions (user_id, place_id, member_id, on_enter, on_exit, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(userB, 1, userA, 1, 1, Date.now());

        const rows = db.prepare('SELECT * FROM place_subscriptions WHERE user_id = ?').all(userB);
        expect(rows).toHaveLength(1);
        expect(rows[0].place_id).toBe(1);
        expect(rows[0].member_id).toBe(userA);
    });

    it('enforces unique constraint on (user_id, place_id, member_id)', () => {
        const db = createTestDb();
        const { userId: userA, circleId } = seedUser(db);
        const { userId: userB } = seedSecondUser(db, circleId);

        db.prepare(
            'INSERT INTO places (circle_id, name, lat, lng, radius_m, alerts_on_enter, alerts_on_exit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(circleId, 'Home', 37.7749, -122.4194, 100, 1, 1, Date.now());

        db.prepare(
            'INSERT INTO place_subscriptions (user_id, place_id, member_id, on_enter, on_exit, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(userB, 1, userA, 1, 1, Date.now());

        expect(() => {
            db.prepare(
                'INSERT INTO place_subscriptions (user_id, place_id, member_id, on_enter, on_exit, created_at) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(userB, 1, userA, 1, 0, Date.now());
        }).toThrow();
    });

    it('allows NULL member_id for "anyone" subscriptions', () => {
        const db = createTestDb();
        const { userId: userA, circleId } = seedUser(db);

        db.prepare(
            'INSERT INTO places (circle_id, name, lat, lng, radius_m, alerts_on_enter, alerts_on_exit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(circleId, 'Home', 37.7749, -122.4194, 100, 1, 1, Date.now());

        db.prepare(
            'INSERT INTO place_subscriptions (user_id, place_id, member_id, on_enter, on_exit, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(userA, 1, null, 1, 0, Date.now());

        const rows = db.prepare('SELECT * FROM place_subscriptions').all();
        expect(rows).toHaveLength(1);
        expect(rows[0].member_id).toBeNull();
    });
});
