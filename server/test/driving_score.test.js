import { describe, it, expect } from 'vitest';
import { createTestDb, seedUser } from './helpers.js';
import { computeDrivingScore } from '../src/drivingScore.js';
import { loadOpenTrips, onLocationFix } from '../src/trips.js';

function seedTripWithEvents(db, userId, circleId, events) {
    const now = Date.now();
    const startedAt = now - 2 * 86400000;
    const endedAt = startedAt + 3600000;
    db.prepare(
        `INSERT INTO trips (user_id, circle_id, started_at, ended_at, mode, distance_m, max_speed_mps, avg_speed_mps)
         VALUES (?, ?, ?, ?, 'driving', ?, ?, ?)`,
    ).run(userId, circleId, startedAt, endedAt, 50000, 30, 18);
    const tripId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
    for (const ev of events) {
        db.prepare(
            'INSERT INTO trip_events (trip_id, user_id, kind, occurred_at, value) VALUES (?, ?, ?, ?, ?)',
        ).run(tripId, userId, ev.kind, startedAt + ev.offsetMs, ev.value);
    }
    return tripId;
}

describe('computeDrivingScore', () => {
    it('returns null score when no driving data', () => {
        const db = createTestDb();
        const { userId } = seedUser(db);
        const since = Date.now() - 7 * 86400000;
        const result = computeDrivingScore(db, userId, since);
        expect(result.score).toBeNull();
        expect(result.tripCount).toBe(0);
        expect(result.hardBrakeCount).toBe(0);
    });

    it('computes score with hard brakes, speeding, and night segments', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const since = Date.now() - 7 * 86400000;

        seedTripWithEvents(db, userId, circleId, [
            { kind: 'hard_brake', offsetMs: 0, value: -4.2 },
            { kind: 'hard_brake', offsetMs: 30000, value: -3.8 },
            { kind: 'speeding_start', offsetMs: 60000, value: 35.0 },
            { kind: 'speeding_end', offsetMs: 660000, value: 28.0 },
            { kind: 'night_segment', offsetMs: 700000, value: 5000 },
        ]);

        const result = computeDrivingScore(db, userId, since);
        expect(result.tripCount).toBe(1);
        expect(result.hardBrakeCount).toBe(2);
        expect(result.speedingMinutes).toBeCloseTo(10, 0);
        expect(result.nightMiles).toBeCloseTo(3.1, 0);
        expect(result.score).toBeLessThan(100);
        expect(result.score).toBeGreaterThanOrEqual(0);
    });

    it('applies short drive penalty when under 30 minutes', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const since = Date.now() - 7 * 86400000;
        const now = Date.now();
        const startedAt = now - 2 * 86400000;

        db.prepare(
            `INSERT INTO trips (user_id, circle_id, started_at, ended_at, mode, distance_m, max_speed_mps, avg_speed_mps)
             VALUES (?, ?, ?, ?, 'driving', ?, ?, ?)`,
        ).run(userId, circleId, startedAt, startedAt + 600000, 5000, 10, 8);

        const result = computeDrivingScore(db, userId, since);
        expect(result.drivingMs).toBeLessThan(30 * 60000);
        expect(result.score).toBeLessThanOrEqual(95);
    });
});

describe('recordTripEvents', () => {
    it('records a hard brake event', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        loadOpenTrips(db);

        onLocationFix(db, {
            userId, circleId, displayName: 'Alice',
            lat: 37.77, lng: -122.42, speedMps: 20, activity: 'driving', recordedAt: Date.now() - 4000,
        });

        onLocationFix(db, {
            userId, circleId, displayName: 'Alice',
            lat: 37.77, lng: -122.42, speedMps: 5, activity: 'driving', recordedAt: Date.now(),
        });

        const events = db.prepare(
            "SELECT * FROM trip_events WHERE user_id = ? AND kind = 'hard_brake'",
        ).all(userId);
        expect(events.length).toBe(1);
        expect(events[0].value).toBeGreaterThan(0);
    });

    it('respects hard brake cooldown', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        loadOpenTrips(db);
        const now = Date.now();

        onLocationFix(db, {
            userId, circleId, displayName: 'Alice',
            lat: 37.77, lng: -122.42, speedMps: 20, activity: 'driving', recordedAt: now - 10000,
        });

        onLocationFix(db, {
            userId, circleId, displayName: 'Alice',
            lat: 37.77, lng: -122.42, speedMps: 5, activity: 'driving', recordedAt: now - 8000,
        });

        onLocationFix(db, {
            userId, circleId, displayName: 'Alice',
            lat: 37.77, lng: -122.42, speedMps: 20, activity: 'driving', recordedAt: now - 3000,
        });

        onLocationFix(db, {
            userId, circleId, displayName: 'Alice',
            lat: 37.77, lng: -122.42, speedMps: 5, activity: 'driving', recordedAt: now - 1000,
        });

        const events = db.prepare(
            "SELECT * FROM trip_events WHERE user_id = ? AND kind = 'hard_brake'",
        ).all(userId);
        expect(events.length).toBe(1);
    });
});
