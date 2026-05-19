import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, seedUser } from './helpers.js';
import { loadOpenVisits, onLocationFix, getOpenVisit } from '../src/visits.js';

function fix(db, ctx, lat, lng, speedMps, recordedAt, transitions = []) {
    onLocationFix(db, {
        userId: ctx.userId,
        circleId: ctx.circleId,
        displayName: 'Alice',
        lat,
        lng,
        speedMps,
        recordedAt,
    }, transitions);
}

describe('visits', () => {
    beforeEach(() => loadOpenVisits({ prepare: () => ({ all: () => [] }) }));

    it('opens an auto-detected stay when stationary', () => {
        const db = createTestDb();
        const ctx = seedUser(db);
        loadOpenVisits(db);
        fix(db, ctx, 47.6, -122.3, 0.1, 1000);
        const live = getOpenVisit(ctx.userId);
        expect(live).not.toBeNull();
        expect(live.placeId).toBeNull();
    });

    it('persists and closes a long enough stay on movement', () => {
        const db = createTestDb();
        const ctx = seedUser(db);
        loadOpenVisits(db);
        for (let i = 0; i < 6; i++) fix(db, ctx, 47.6, -122.3, 0.1, i * 60_000);
        // Move two consecutive fast fixes — should close visit.
        fix(db, ctx, 47.65, -122.3, 10, 7 * 60_000);
        fix(db, ctx, 47.66, -122.3, 10, 8 * 60_000);
        const rows = db.prepare('SELECT * FROM visits WHERE ended_at IS NOT NULL').all();
        expect(rows).toHaveLength(1);
        expect(rows[0].ended_at).toBeGreaterThan(rows[0].started_at);
    });

    it('discards visits shorter than 5 minutes', () => {
        const db = createTestDb();
        const ctx = seedUser(db);
        loadOpenVisits(db);
        // One stationary fix then immediate movement (< 5 min)
        fix(db, ctx, 47.6, -122.3, 0.1, 0);
        fix(db, ctx, 47.65, -122.3, 10, 30_000);
        fix(db, ctx, 47.66, -122.3, 10, 60_000);
        const all = db.prepare('SELECT * FROM visits').all();
        expect(all).toHaveLength(0);
    });

    it('anchors a visit to a place via geofence_enter transition', () => {
        const db = createTestDb();
        const ctx = seedUser(db);
        db.prepare(
            'INSERT INTO places (circle_id, name, lat, lng, radius_m, alerts_on_enter, alerts_on_exit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(ctx.circleId, 'Home', 47.6, -122.3, 100, 0, 0, 0);
        loadOpenVisits(db);
        const transition = {
            type: 'geofence_enter',
            userId: ctx.userId,
            placeId: 1,
            recordedAt: 1000,
        };
        fix(db, ctx, 47.6, -122.3, 0.1, 1000, [transition]);
        const live = getOpenVisit(ctx.userId);
        expect(live.placeId).toBe(1);
    });

    it('reloads open visits from DB on boot', () => {
        const db = createTestDb();
        const ctx = seedUser(db);
        db.prepare(
            `INSERT INTO visits (user_id, circle_id, place_id, lat, lng, started_at, point_count)
             VALUES (?, ?, NULL, ?, ?, ?, ?)`,
        ).run(ctx.userId, ctx.circleId, 47.6, -122.3, 1000, 3);
        loadOpenVisits(db);
        const live = getOpenVisit(ctx.userId);
        expect(live).not.toBeNull();
        expect(live.pointCount).toBe(3);
    });
});
