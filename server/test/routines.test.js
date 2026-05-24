import { describe, it, expect } from 'vitest';
import { createTestDb, seedUser } from './helpers.js';
import { mineRoutines, estimateLocalMinute, evaluateRoutineSweep, getUpcomingRoutines } from '../src/routines.js';

const LNG_NY = -74.0;
const UTC_OFFSET_NY = Math.round(LNG_NY / 15);

const MONDAY_UTC = Date.UTC(2025, 2, 3, 0, 0, 0);

function seedPlace(db, circleId, name = 'School') {
    db.prepare(
        'INSERT INTO places (circle_id, name, lat, lng, radius_m, alerts_on_enter, alerts_on_exit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(circleId, name, 40.7, -74, 100, 0, 0, 0);
    return db.prepare('SELECT last_insert_rowid() AS id').get().id;
}

function seedVisit(db, userId, circleId, placeId, startedAt, endedAt) {
    db.prepare(
        'INSERT INTO visits (user_id, circle_id, place_id, lat, lng, started_at, ended_at, point_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(userId, circleId, placeId, 40.7, LNG_NY, startedAt, endedAt || null, 5);
}

function mondayAt(weeksAgo, minute, jitterMin = 0) {
    const base = MONDAY_UTC - UTC_OFFSET_NY * 3600000 + minute * 60000;
    const startedAt = base - weeksAgo * 7 * 86400000 + jitterMin * 60000;
    return { startedAt, endedAt: startedAt + 8 * 3600000 };
}

function nyNow(hourLocal = 10) {
    return MONDAY_UTC - UTC_OFFSET_NY * 3600000 + hourLocal * 3600000;
}

function seedLocation(db, userId, now) {
    db.prepare('INSERT INTO locations (user_id, lat, lng, recorded_at) VALUES (?, ?, ?, ?)')
        .run(userId, 40.7, LNG_NY, now);
}

function seedAlertPrefs(db, userId, extra = {}) {
    db.prepare('INSERT OR IGNORE INTO alert_prefs (user_id) VALUES (?)').run(userId);
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(extra)) {
        sets.push(`${k} = ?`);
        vals.push(v);
    }
    if (sets.length) {
        vals.push(userId);
        db.prepare(`UPDATE alert_prefs SET ${sets.join(', ')} WHERE user_id = ?`).run(...vals);
    }
}

function seedRoutine(db, userId, circleId, placeId, opts = {}) {
    const now = opts.now ?? nyNow(10);
    const created_at = opts.createdAt ?? (now - 8 * 86400000);
    const lastSeen = opts.lastSeen ?? (now - 86400000);
    db.prepare(`
        INSERT INTO routines (user_id, circle_id, place_id, kind, day_of_week,
                              expected_minute, tolerance_minutes, sample_count, confidence,
                              source, active, first_seen_at, last_seen_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `).run(userId, circleId, placeId, opts.kind ?? 'arrival', opts.dayOfWeek ?? 1,
        opts.expectedMinute ?? 495, opts.tolerance ?? 15, opts.sampleCount ?? 4, opts.confidence ?? 0.9,
        opts.source ?? 'auto', created_at, lastSeen, created_at, now);
    return db.prepare('SELECT last_insert_rowid() AS id').get().id;
}

describe('estimateLocalMinute', () => {
    it('returns correct minute and day for New York', () => {
        const utcNoon = new Date('2025-01-06T12:00:00Z').getTime();
        const result = estimateLocalMinute(LNG_NY, utcNoon);
        expect(result.minute).toBe(7 * 60);
        expect(result.dayOfWeek).toBe(1);
    });

    it('returns correct minute for London', () => {
        const utcNoon = new Date('2025-01-06T12:00:00Z').getTime();
        const result = estimateLocalMinute(0, utcNoon);
        expect(result.minute).toBe(12 * 60);
        expect(result.dayOfWeek).toBe(1);
    });
});

describe('mineRoutines', () => {
    it('creates a routine from consistent Monday arrivals', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const placeId = seedPlace(db, circleId);
        const now = nyNow(10);

        for (let w = 0; w < 4; w++) {
            const { startedAt, endedAt } = mondayAt(w, 495, (Math.random() - 0.5) * 10);
            seedVisit(db, userId, circleId, placeId, startedAt, endedAt);
        }

        const result = mineRoutines(db, { now });
        expect(result.routinesCreated).toBeGreaterThanOrEqual(1);

        const routines = db.prepare('SELECT * FROM routines').all();
        const arrival = routines.find(r => r.kind === 'arrival' && r.day_of_week === 1);
        expect(arrival).toBeDefined();
        expect(arrival.confidence).toBeGreaterThan(0.7);
        expect(arrival.expected_minute).toBeGreaterThanOrEqual(8 * 60 + 5);
        expect(arrival.expected_minute).toBeLessThanOrEqual(8 * 60 + 25);
        expect(arrival.sample_count).toBeGreaterThanOrEqual(4);
        expect(arrival.source).toBe('auto');
        expect(arrival.active).toBe(1);
    });

    it('does not create a routine from scattered times', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const placeId = seedPlace(db, circleId);
        const now = nyNow(10);
        const windowStart = now - 30 * 86400000;

        const scatteredHours = [6, 9, 14, 20];
        for (let i = 0; i < 4; i++) {
            const startedAt = windowStart + i * 7 * 86400000 + scatteredHours[i] * 3600000;
            seedVisit(db, userId, circleId, placeId, startedAt, startedAt + 3600000);
        }

        mineRoutines(db, { now });
        const routines = db.prepare("SELECT * FROM routines WHERE kind = 'arrival'").all();
        expect(routines).toHaveLength(0);
    });

    it('preserves manual routine expected_minute on re-mine', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const placeId = seedPlace(db, circleId);
        const now = nyNow(10);

        db.prepare(`
            INSERT INTO routines (user_id, circle_id, place_id, kind, day_of_week,
                                  expected_minute, tolerance_minutes, sample_count, confidence,
                                  source, active, first_seen_at, last_seen_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 1, ?, ?, ?, ?)
        `).run(userId, circleId, placeId, 'arrival', 1, 540, 30, 0, 1.0,
            now - 14 * 86400000, now - 86400000, now - 14 * 86400000, now);

        for (let w = 0; w < 4; w++) {
            const { startedAt, endedAt } = mondayAt(w, 495, (Math.random() - 0.5) * 10);
            seedVisit(db, userId, circleId, placeId, startedAt, endedAt);
        }

        mineRoutines(db, { now });

        const r = db.prepare("SELECT * FROM routines WHERE source = 'manual'").get();
        expect(r.expected_minute).toBe(540);
        expect(r.tolerance_minutes).toBe(30);
        expect(r.sample_count).toBeGreaterThan(0);
    });

    it('is idempotent on second run', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const placeId = seedPlace(db, circleId);
        const now = nyNow(10);

        for (let w = 0; w < 4; w++) {
            const { startedAt, endedAt } = mondayAt(w, 495);
            seedVisit(db, userId, circleId, placeId, startedAt, endedAt);
        }

        const r1 = mineRoutines(db, { now });
        const r2 = mineRoutines(db, { now });
        const routines = db.prepare('SELECT * FROM routines').all();
        expect(routines.length).toBe(r1.routinesCreated);
        expect(r2.routinesCreated).toBe(0);
        expect(r2.routinesUpdated).toBe(r1.routinesCreated);
    });

    it('deactivates stale auto routines', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const placeId = seedPlace(db, circleId);
        const now = nyNow(10);

        seedRoutine(db, userId, circleId, placeId, {
            createdAt: now - 30 * 86400000,
            lastSeen: now - 20 * 86400000,
            now,
        });

        const result = mineRoutines(db, { now });
        expect(result.routinesDeactivated).toBeGreaterThanOrEqual(1);

        const r = db.prepare("SELECT * FROM routines WHERE source = 'auto'").get();
        expect(r.active).toBe(0);
    });

    it('ignores visits without place_id', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const now = nyNow(10);
        const base = now - 86400000;
        for (let i = 0; i < 8; i++) {
            db.prepare(
                'INSERT INTO visits (user_id, circle_id, place_id, lat, lng, started_at, ended_at, point_count) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)',
            ).run(userId, circleId, 40.7, LNG_NY, base + i * 3600000, base + i * 3600000 + 1800000, 5);
        }

        mineRoutines(db, { now });
        const routines = db.prepare('SELECT * FROM routines').all();
        expect(routines).toHaveLength(0);
    });
});

describe('evaluateRoutineSweep', () => {
    it('fires missed_arrival when no visit in expected window', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const placeId = seedPlace(db, circleId);
        const now = nyNow(9);

        seedRoutine(db, userId, circleId, placeId, { now });
        seedAlertPrefs(db, userId);
        seedLocation(db, userId, now);

        evaluateRoutineSweep(db, now);

        const alerts = db.prepare('SELECT * FROM routine_alerts').all();
        expect(alerts).toHaveLength(1);
        expect(alerts[0].kind).toBe('missed_arrival');
    });

    it('does not fire duplicate alert for same routine same day', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const placeId = seedPlace(db, circleId);
        const now = nyNow(9);

        seedRoutine(db, userId, circleId, placeId, { now });
        seedAlertPrefs(db, userId);
        seedLocation(db, userId, now);

        evaluateRoutineSweep(db, now);
        evaluateRoutineSweep(db, now + 1800000);

        const alerts = db.prepare('SELECT * FROM routine_alerts').all();
        expect(alerts).toHaveLength(1);
    });

    it('does not fire when visit exists within tolerance', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const placeId = seedPlace(db, circleId);
        const now = nyNow(9);

        seedRoutine(db, userId, circleId, placeId, { now });
        seedAlertPrefs(db, userId);
        seedLocation(db, userId, now);

        const { startedAt, endedAt } = mondayAt(0, 495, 5);
        seedVisit(db, userId, circleId, placeId, startedAt, endedAt);

        evaluateRoutineSweep(db, now);

        const alerts = db.prepare('SELECT * FROM routine_alerts').all();
        expect(alerts).toHaveLength(0);
    });

    it('skips when user is paused', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const placeId = seedPlace(db, circleId);
        const now = nyNow(9);

        seedRoutine(db, userId, circleId, placeId, { now });
        seedAlertPrefs(db, userId);
        seedLocation(db, userId, now);
        db.prepare('UPDATE users SET paused_until = ? WHERE id = ?').run(now + 86400000, userId);

        evaluateRoutineSweep(db, now);

        const alerts = db.prepare('SELECT * FROM routine_alerts').all();
        expect(alerts).toHaveLength(0);
    });

    it('skips when routines_enabled is 0', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const placeId = seedPlace(db, circleId);
        const now = nyNow(9);

        seedRoutine(db, userId, circleId, placeId, { now });
        seedAlertPrefs(db, userId, { routines_enabled: 0 });
        seedLocation(db, userId, now);

        evaluateRoutineSweep(db, now);

        const alerts = db.prepare('SELECT * FROM routine_alerts').all();
        expect(alerts).toHaveLength(0);
    });

    it('skips when in quiet hours', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const placeId = seedPlace(db, circleId);
        const now = nyNow(9);

        seedRoutine(db, userId, circleId, placeId, { now });
        seedAlertPrefs(db, userId, { routines_quiet_start: 0, routines_quiet_end: 1439 });
        seedLocation(db, userId, now);

        evaluateRoutineSweep(db, now);

        const alerts = db.prepare('SELECT * FROM routine_alerts').all();
        expect(alerts).toHaveLength(0);
    });

    it('skips routines still in observation period', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const placeId = seedPlace(db, circleId);
        const now = nyNow(9);

        seedRoutine(db, userId, circleId, placeId, { now, createdAt: now - 3 * 86400000 });
        seedAlertPrefs(db, userId);
        seedLocation(db, userId, now);

        evaluateRoutineSweep(db, now);

        const alerts = db.prepare('SELECT * FROM routine_alerts').all();
        expect(alerts).toHaveLength(0);
    });
});

describe('getUpcomingRoutines', () => {
    it('returns upcoming routine instances within window', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const placeId = seedPlace(db, circleId, 'School');
        const now = nyNow(10);

        seedRoutine(db, userId, circleId, placeId, { now });
        seedLocation(db, userId, now);

        const results = getUpcomingRoutines(db, circleId, 7 * 24 * 60, now);
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].placeName).toBe('School');
        expect(results[0].kind).toBe('arrival');
        expect(results[0].expectedAt).toBeGreaterThan(now);
    });

    it('skips paused users', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const placeId = seedPlace(db, circleId);
        const now = nyNow(10);

        seedRoutine(db, userId, circleId, placeId, { now });
        db.prepare('UPDATE users SET paused_until = ? WHERE id = ?').run(now + 86400000, userId);

        const results = getUpcomingRoutines(db, circleId, 7 * 24 * 60, now);
        expect(results).toHaveLength(0);
    });
});
