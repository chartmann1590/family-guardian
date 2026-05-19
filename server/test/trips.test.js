import { describe, it, expect } from 'vitest';
import { createTestDb, seedUser } from './helpers.js';
import { loadOpenVisits, onLocationFix as visitFix } from '../src/visits.js';
import { loadOpenTrips, onLocationFix } from '../src/trips.js';

function fix(db, ctx, lat, lng, speedMps, recordedAt, activity = 'driving') {
    onLocationFix(db, {
        userId: ctx.userId,
        circleId: ctx.circleId,
        displayName: 'Alice',
        lat,
        lng,
        speedMps,
        activity,
        recordedAt,
    });
}

describe('trips', () => {
    it('opens a trip on first moving fix when not in a visit', () => {
        const db = createTestDb();
        const ctx = seedUser(db);
        loadOpenVisits(db);
        loadOpenTrips(db);
        fix(db, ctx, 47.6, -122.3, 10, 0);
        const rows = db.prepare('SELECT * FROM trips WHERE ended_at IS NULL').all();
        expect(rows).toHaveLength(1);
    });

    it('accumulates distance across multiple fixes', () => {
        const db = createTestDb();
        const ctx = seedUser(db);
        loadOpenVisits(db);
        loadOpenTrips(db);
        fix(db, ctx, 47.6, -122.3, 10, 0);
        fix(db, ctx, 47.61, -122.3, 12, 60_000);
        fix(db, ctx, 47.62, -122.3, 14, 120_000);
        const row = db.prepare('SELECT * FROM trips').get();
        expect(row.distance_m).toBeGreaterThan(1500);
        expect(row.max_speed_mps).toBe(14);
    });

    it('discards trips under 60s or 100m', () => {
        const db = createTestDb();
        const ctx = seedUser(db);
        loadOpenVisits(db);
        loadOpenTrips(db);
        fix(db, ctx, 47.6, -122.3, 10, 0);
        // Drive the visit engine to open a visit; trips.onLocationFix will then close the open trip
        // and discard it because duration + distance are below thresholds.
        visitFix(db, {
            userId: ctx.userId,
            circleId: ctx.circleId,
            displayName: 'Alice',
            lat: 47.60001,
            lng: -122.3,
            speedMps: 0.1,
            recordedAt: 1000,
        }, []);
        fix(db, ctx, 47.60001, -122.3, 0.1, 2000, 'still');
        const trips = db.prepare('SELECT * FROM trips').all();
        expect(trips).toHaveLength(0);
    });
});
