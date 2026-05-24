import { describe, it, expect } from 'vitest';
import { createTestDb, seedUser, seedSecondUser } from './helpers.js';
import { buildDigest, persistDigest } from '../src/digest.js';

function seedPlace(db, circleId, name = 'Home') {
    db.prepare(
        'INSERT INTO places (circle_id, name, lat, lng, radius_m, alerts_on_enter, alerts_on_exit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(circleId, name, 47.6, -122.3, 100, 0, 0, 0);
    return db.prepare('SELECT last_insert_rowid() AS id').get().id;
}

function seedVisit(db, userId, circleId, placeId, startedAt, endedAt) {
    db.prepare(
        'INSERT INTO visits (user_id, circle_id, place_id, lat, lng, started_at, ended_at, point_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(userId, circleId, placeId, 47.6, -122.3, startedAt, endedAt, 5);
}

function seedTrip(db, userId, circleId, startedAt, endedAt, distanceM, maxSpeed) {
    db.prepare(
        `INSERT INTO trips (user_id, circle_id, started_at, ended_at, mode, distance_m, max_speed_mps, avg_speed_mps)
         VALUES (?, ?, ?, ?, 'driving', ?, ?, ?)`,
    ).run(userId, circleId, startedAt, endedAt, distanceM, maxSpeed, maxSpeed * 0.7);
}

function seedCheckin(db, userId, circleId, createdAt) {
    db.prepare(
        'INSERT INTO check_ins (user_id, circle_id, status, lat, lng, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(userId, circleId, 'safe_home', 47.6, -122.3, 'ok', createdAt);
}

function seedRoutineAlert(db, userId, circleId, placeId, firedAt) {
    const now = Date.now();
    db.prepare(`
        INSERT INTO routines (user_id, circle_id, place_id, kind, day_of_week,
                              expected_minute, tolerance_minutes, sample_count, confidence,
                              source, active, first_seen_at, last_seen_at, created_at, updated_at)
        VALUES (?, ?, ?, 'arrival', 1, 480, 15, 4, 0.9, 'auto', 1, ?, ?, ?, ?)
    `).run(userId, circleId, placeId, now - 14 * 86400000, now - 86400000, now - 14 * 86400000, now);
    const routineId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
    db.prepare(`
        INSERT INTO routine_alerts (routine_id, user_id, circle_id, kind, fired_at, fired_local_date, expected_minute, created_at)
        VALUES (?, ?, ?, 'missed_arrival', ?, '2025-01-06', 480, ?)
    `).run(routineId, userId, circleId, firedAt, firedAt);
}

describe('buildDigest', () => {
    it('returns correct per-member counts', () => {
        const db = createTestDb();
        const { userId: aliceId, circleId } = seedUser(db);
        const { userId: bobId } = seedSecondUser(db, circleId);
        const placeId = seedPlace(db, circleId, 'School');

        const weekStart = Date.now() - 7 * 86400000;
        const weekEnd = Date.now();

        seedTrip(db, aliceId, circleId, weekStart + 1000, weekStart + 3600000, 25000, 30);
        seedTrip(db, aliceId, circleId, weekStart + 86400000, weekStart + 86400000 + 1800000, 15000, 22);
        seedVisit(db, aliceId, circleId, placeId, weekStart + 2000, weekStart + 3600000);
        seedVisit(db, aliceId, circleId, placeId, weekStart + 86400000, weekStart + 86400000 + 7200000);
        seedCheckin(db, aliceId, circleId, weekStart + 5000);
        seedCheckin(db, aliceId, circleId, weekStart + 86400000 + 5000);
        seedRoutineAlert(db, aliceId, circleId, placeId, weekStart + 10000);

        seedVisit(db, bobId, circleId, placeId, weekStart + 3000, weekStart + 1800000);
        seedCheckin(db, bobId, circleId, weekStart + 6000);

        const result = buildDigest(db, circleId, weekStart, weekEnd);

        expect(result.perMember).toHaveLength(2);

        const alice = result.perMember.find(m => m.userId === aliceId);
        expect(alice).toBeDefined();
        expect(alice.tripCount).toBe(2);
        expect(alice.totalDistanceM).toBe(40000);
        expect(alice.visitCount).toBe(2);
        expect(alice.checkinCount).toBe(2);
        expect(alice.routineAlerts).toBe(1);
        expect(alice.topPlaces).toHaveLength(1);
        expect(alice.topPlaces[0].placeName).toBe('School');

        const bob = result.perMember.find(m => m.userId === bobId);
        expect(bob).toBeDefined();
        expect(bob.tripCount).toBe(0);
        expect(bob.visitCount).toBe(1);
        expect(bob.checkinCount).toBe(1);
        expect(bob.routineAlerts).toBe(0);

        expect(result.totalKm).toBe(40);
        expect(result.totalAlerts).toBe(1);
        expect(result.busiestPlace).toBe('School');
    });

    it('returns null busiestPlace when no visits', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        const weekStart = Date.now() - 7 * 86400000;
        const weekEnd = Date.now();

        const result = buildDigest(db, circleId, weekStart, weekEnd);
        expect(result.busiestPlace).toBeNull();
        expect(result.totalKm).toBe(0);
        expect(result.totalAlerts).toBe(0);
    });

    it('computes quietestMember from lowest visit+trip sum', () => {
        const db = createTestDb();
        const { userId: aliceId, circleId } = seedUser(db);
        const { userId: bobId } = seedSecondUser(db, circleId);
        const placeId = seedPlace(db, circleId);

        const weekStart = Date.now() - 7 * 86400000;
        const weekEnd = Date.now();

        seedVisit(db, aliceId, circleId, placeId, weekStart + 1000, weekStart + 3600000);
        seedVisit(db, aliceId, circleId, placeId, weekStart + 86400000, weekStart + 86400000 + 3600000);
        seedTrip(db, aliceId, circleId, weekStart + 5000, weekStart + 3600000, 10000, 20);

        const result = buildDigest(db, circleId, weekStart, weekEnd);
        expect(result.quietestMember).toBe('Bob');
    });
});

describe('persistDigest', () => {
    it('stores a digest snapshot', () => {
        const db = createTestDb();
        const { circleId } = seedUser(db);
        const weekStart = Date.now() - 7 * 86400000;
        const weekEnd = Date.now();

        const summary = { weekStart, weekEnd, perMember: [], totalKm: 0, totalAlerts: 0 };
        persistDigest(db, circleId, weekStart, weekEnd, summary);

        const rows = db.prepare('SELECT * FROM digest_snapshots').all();
        expect(rows).toHaveLength(1);
        expect(JSON.parse(rows[0].summary_json).totalKm).toBe(0);
    });

    it('INSERT OR REPLACE is idempotent for same week', () => {
        const db = createTestDb();
        const { circleId } = seedUser(db);
        const weekStart = Date.now() - 7 * 86400000;
        const weekEnd = Date.now();

        persistDigest(db, circleId, weekStart, weekEnd, { totalKm: 10 });
        persistDigest(db, circleId, weekStart, weekEnd, { totalKm: 20 });

        const rows = db.prepare('SELECT * FROM digest_snapshots').all();
        expect(rows).toHaveLength(1);
        expect(JSON.parse(rows[0].summary_json).totalKm).toBe(20);
    });

    it('stores multiple weeks separately', () => {
        const db = createTestDb();
        const { circleId } = seedUser(db);
        const weekStart1 = Date.now() - 14 * 86400000;
        const weekEnd1 = Date.now() - 7 * 86400000;
        const weekStart2 = weekEnd1;
        const weekEnd2 = Date.now();

        persistDigest(db, circleId, weekStart1, weekEnd1, { totalKm: 10 });
        persistDigest(db, circleId, weekStart2, weekEnd2, { totalKm: 20 });

        const rows = db.prepare('SELECT * FROM digest_snapshots ORDER BY week_start ASC').all();
        expect(rows).toHaveLength(2);
        expect(JSON.parse(rows[0].summary_json).totalKm).toBe(10);
        expect(JSON.parse(rows[1].summary_json).totalKm).toBe(20);
    });
});

describe('digest prefs', () => {
    it('toggles weekly_digest_enabled on alert_prefs', () => {
        const db = createTestDb();
        const { userId } = seedUser(db);

        db.prepare('INSERT OR IGNORE INTO alert_prefs (user_id) VALUES (?)').run(userId);

        db.prepare('UPDATE alert_prefs SET weekly_digest_enabled = ? WHERE user_id = ?')
            .run(1, userId);
        let row = db.prepare('SELECT weekly_digest_enabled AS e FROM alert_prefs WHERE user_id = ?').get(userId);
        expect(row.e).toBe(1);

        db.prepare('UPDATE alert_prefs SET weekly_digest_enabled = ? WHERE user_id = ?')
            .run(0, userId);
        row = db.prepare('SELECT weekly_digest_enabled AS e FROM alert_prefs WHERE user_id = ?').get(userId);
        expect(row.e).toBe(0);
    });

    it('creates alert_prefs row if missing', () => {
        const db = createTestDb();
        const { userId } = seedUser(db);

        const before = db.prepare('SELECT * FROM alert_prefs WHERE user_id = ?').get(userId);
        expect(before).toBeUndefined();

        db.prepare('INSERT OR IGNORE INTO alert_prefs (user_id) VALUES (?)').run(userId);
        db.prepare('UPDATE alert_prefs SET weekly_digest_enabled = ? WHERE user_id = ?')
            .run(1, userId);

        const after = db.prepare('SELECT weekly_digest_enabled AS e FROM alert_prefs WHERE user_id = ?').get(userId);
        expect(after.e).toBe(1);
    });
});
