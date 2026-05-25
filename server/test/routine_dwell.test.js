import { describe, it, expect } from 'vitest';
import { createTestDb, seedUser } from './helpers.js';
import { mineRoutines, evaluateRoutineSweep } from '../src/routines.js';

const LNG_NY = -74.0;
const UTC_OFFSET_NY = Math.round(LNG_NY / 15);

const MONDAY_UTC = Date.UTC(2025, 2, 3, 0, 0, 0);

function seedPlace(db, circleId, name = 'Coffee') {
    db.prepare(
        'INSERT INTO places (circle_id, name, lat, lng, radius_m, alerts_on_enter, alerts_on_exit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(circleId, name, 40.7, LNG_NY, 100, 0, 0, 0);
    return db.prepare('SELECT last_insert_rowid() AS id').get().id;
}

function seedVisit(db, userId, circleId, placeId, startedAt, endedAt) {
    db.prepare(
        'INSERT INTO visits (user_id, circle_id, place_id, lat, lng, started_at, ended_at, point_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(userId, circleId, placeId, 40.7, LNG_NY, startedAt, endedAt || null, 5);
}

function mondayAt(weeksAgo, startMinute, dwellMin) {
    const base = MONDAY_UTC - UTC_OFFSET_NY * 3600000 + startMinute * 60000;
    const startedAt = base - weeksAgo * 7 * 86400000;
    return { startedAt, endedAt: startedAt + dwellMin * 60000 };
}

function nyNow(hourLocal = 10) {
    return MONDAY_UTC - UTC_OFFSET_NY * 3600000 + hourLocal * 3600000;
}

describe('dwell routine mining', () => {
    it('detects a dwell pattern from consistent visit durations', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const placeId = seedPlace(db, circleId, 'Coffee');
        const now = nyNow(20);

        for (let w = 0; w < 6; w++) {
            const { startedAt, endedAt } = mondayAt(w, 14 * 60 + 30, 120 + Math.round((Math.random() - 0.5) * 10));
            seedVisit(db, userId, circleId, placeId, startedAt, endedAt);
        }

        mineRoutines(db, { now });

        const dwell = db.prepare("SELECT * FROM routines WHERE kind = 'dwell'").get();
        expect(dwell).toBeDefined();
        expect(dwell.expected_dwell_minutes).toBeGreaterThanOrEqual(110);
        expect(dwell.expected_dwell_minutes).toBeLessThanOrEqual(130);
        expect(dwell.confidence).toBeGreaterThan(0.7);
    });

    it('ignores visits shorter than 5 minutes for dwell mining', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const placeId = seedPlace(db, circleId);
        const now = nyNow(20);

        for (let w = 0; w < 6; w++) {
            const { startedAt, endedAt } = mondayAt(w, 14 * 60, 2);
            seedVisit(db, userId, circleId, placeId, startedAt, endedAt);
        }

        mineRoutines(db, { now });
        const dwell = db.prepare("SELECT * FROM routines WHERE kind = 'dwell'").get();
        expect(dwell).toBeUndefined();
    });
});

describe('dwell routine sweep', () => {
    it('fires overstay_dwell when visit exceeds expected duration', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const placeId = seedPlace(db, circleId);
        const now = nyNow(17);

        const visitStart = nyNow(14) + 30 * 60000;
        db.prepare(
            'INSERT INTO visits (user_id, circle_id, place_id, lat, lng, started_at, ended_at, point_count) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)',
        ).run(userId, circleId, placeId, 40.7, LNG_NY, visitStart, 5);
        db.prepare('INSERT INTO locations (user_id, lat, lng, recorded_at) VALUES (?, ?, ?, ?)')
            .run(userId, 40.7, LNG_NY, now);

        const createdAt = now - 8 * 86400000;
        db.prepare(`
            INSERT INTO routines (user_id, circle_id, place_id, kind, day_of_week,
                                  expected_minute, expected_dwell_minutes, tolerance_minutes, sample_count, confidence,
                                  source, active, first_seen_at, last_seen_at, created_at, updated_at)
            VALUES (?, ?, ?, 'dwell', 1, ?, ?, ?, ?, ?, 'auto', 1, ?, ?, ?, ?)
        `).run(userId, circleId, placeId, 14 * 60 + 30, 60, 15, 6, 0.9,
            createdAt, createdAt + 86400000, createdAt, now);

        db.prepare('INSERT OR IGNORE INTO alert_prefs (user_id) VALUES (?)').run(userId);

        evaluateRoutineSweep(db, now);

        const alerts = db.prepare("SELECT * FROM routine_alerts WHERE kind = 'overstay_dwell'").all();
        expect(alerts).toHaveLength(1);
        expect(alerts[0].actual_minute).toBeGreaterThan(60);
    });

    it('does not fire when visit is within expected dwell window', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const placeId = seedPlace(db, circleId);
        const now = nyNow(15);

        const visitStart = nyNow(14) + 30 * 60000;
        db.prepare(
            'INSERT INTO visits (user_id, circle_id, place_id, lat, lng, started_at, ended_at, point_count) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)',
        ).run(userId, circleId, placeId, 40.7, LNG_NY, visitStart, 5);
        db.prepare('INSERT INTO locations (user_id, lat, lng, recorded_at) VALUES (?, ?, ?, ?)')
            .run(userId, 40.7, LNG_NY, now);

        const createdAt = now - 8 * 86400000;
        db.prepare(`
            INSERT INTO routines (user_id, circle_id, place_id, kind, day_of_week,
                                  expected_minute, expected_dwell_minutes, tolerance_minutes, sample_count, confidence,
                                  source, active, first_seen_at, last_seen_at, created_at, updated_at)
            VALUES (?, ?, ?, 'dwell', 1, ?, ?, ?, ?, ?, 'auto', 1, ?, ?, ?, ?)
        `).run(userId, circleId, placeId, 14 * 60 + 30, 120, 15, 6, 0.9,
            createdAt, createdAt + 86400000, createdAt, now);

        db.prepare('INSERT OR IGNORE INTO alert_prefs (user_id) VALUES (?)').run(userId);

        evaluateRoutineSweep(db, now);

        const alerts = db.prepare("SELECT * FROM routine_alerts WHERE kind = 'overstay_dwell'").all();
        expect(alerts).toHaveLength(0);
    });
});
