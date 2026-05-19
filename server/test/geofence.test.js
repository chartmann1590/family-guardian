import { describe, it, expect } from 'vitest';
import { haversineMeters, reconcileGeofences } from '../src/geofence.js';
import { createTestDb, seedUser } from './helpers.js';

describe('geofence', () => {
    describe('haversineMeters', () => {
        it('returns 0 for same point', () => {
            expect(haversineMeters(37.7749, -122.4194, 37.7749, -122.4194)).toBeCloseTo(0, 1);
        });

        it('measures known distance between two cities', () => {
            const dist = haversineMeters(40.7128, -74.0060, 34.0522, -118.2437);
            expect(dist).toBeGreaterThan(3_900_000);
            expect(dist).toBeLessThan(4_000_000);
        });

        it('measures short distance', () => {
            const dist = haversineMeters(37.7749, -122.4194, 37.7750, -122.4194);
            expect(dist).toBeGreaterThan(0);
            expect(dist).toBeLessThan(20);
        });
    });

    describe('reconcileGeofences', () => {
        it('emits geofence_enter when user enters a place', () => {
            const db = createTestDb();
            const { userId, circleId } = seedUser(db);
            db.prepare(
                'INSERT INTO places (circle_id, name, lat, lng, radius_m, alerts_on_enter, alerts_on_exit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            ).run(circleId, 'Home', 37.7749, -122.4194, 100, 1, 1, Date.now());

            const events = reconcileGeofences(db, {
                userId, circleId, displayName: 'Alice',
                lat: 37.7749, lng: -122.4194, recordedAt: Date.now(),
            });

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe('geofence_enter');
            expect(events[0].placeName).toBe('Home');

            const presence = db.prepare('SELECT * FROM place_presence WHERE user_id = ?').all(userId);
            expect(presence).toHaveLength(1);
        });

        it('emits geofence_exit when user leaves', () => {
            const db = createTestDb();
            const { userId, circleId } = seedUser(db);
            db.prepare(
                'INSERT INTO places (circle_id, name, lat, lng, radius_m, alerts_on_enter, alerts_on_exit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            ).run(circleId, 'Home', 37.7749, -122.4194, 100, 1, 1, Date.now());
            const now = Date.now();
            db.prepare('INSERT INTO place_presence (user_id, place_id, entered_at) VALUES (?, ?, ?)').run(userId, 1, now);

            const events = reconcileGeofences(db, {
                userId, circleId, displayName: 'Alice',
                lat: 37.78, lng: -122.43, recordedAt: now,
            });

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe('geofence_exit');
            const presence = db.prepare('SELECT * FROM place_presence WHERE user_id = ?').all(userId);
            expect(presence).toHaveLength(0);
        });

        it('emits nothing when already inside', () => {
            const db = createTestDb();
            const { userId, circleId } = seedUser(db);
            db.prepare(
                'INSERT INTO places (circle_id, name, lat, lng, radius_m, alerts_on_enter, alerts_on_exit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            ).run(circleId, 'Home', 37.7749, -122.4194, 100, 1, 1, Date.now());
            db.prepare('INSERT INTO place_presence (user_id, place_id, entered_at) VALUES (?, ?, ?)').run(userId, 1, Date.now());

            const events = reconcileGeofences(db, {
                userId, circleId, displayName: 'Alice',
                lat: 37.7749, lng: -122.4194, recordedAt: Date.now(),
            });

            expect(events).toHaveLength(0);
        });

        it('skips events when alerts disabled', () => {
            const db = createTestDb();
            const { userId, circleId } = seedUser(db);
            db.prepare(
                'INSERT INTO places (circle_id, name, lat, lng, radius_m, alerts_on_enter, alerts_on_exit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            ).run(circleId, 'Home', 37.7749, -122.4194, 100, 0, 0, Date.now());

            const events = reconcileGeofences(db, {
                userId, circleId, displayName: 'Alice',
                lat: 37.7749, lng: -122.4194, recordedAt: Date.now(),
            });

            expect(events).toHaveLength(0);
        });
    });
});
