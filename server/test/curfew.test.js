import { describe, it, expect } from 'vitest';
import { createTestDb, seedUser } from './helpers.js';
import { evaluateCurfewSweep } from '../src/curfew.js';

const LNG_NY = -74.0;
const UTC_OFFSET_NY = Math.round(LNG_NY / 15);

function nyLocal(hourLocal, minuteLocal = 0) {
    const MONDAY_UTC = Date.UTC(2025, 2, 3, 0, 0, 0);
    return MONDAY_UTC - UTC_OFFSET_NY * 3600000 + hourLocal * 3600000 + minuteLocal * 60000;
}

function seedPlace(db, circleId, name = 'Home') {
    db.prepare(
        'INSERT INTO places (circle_id, name, lat, lng, radius_m, alerts_on_enter, alerts_on_exit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(circleId, name, 40.7, LNG_NY, 100, 0, 0, 0);
    return db.prepare('SELECT last_insert_rowid() AS id').get().id;
}

function seedLocation(db, userId, now) {
    db.prepare('INSERT INTO locations (user_id, lat, lng, recorded_at) VALUES (?, ?, ?, ?)')
        .run(userId, 40.7, LNG_NY, now);
}

function seedCurfew(db, userId, opts) {
    db.prepare('INSERT OR IGNORE INTO alert_prefs (user_id) VALUES (?)').run(userId);
    db.prepare(`UPDATE alert_prefs SET curfew_enabled = 1, curfew_start = ?, curfew_end = ?, curfew_home_place_id = ? WHERE user_id = ?`)
        .run(opts.start, opts.end, opts.placeId, userId);
}

function seedPresence(db, userId, placeId, now) {
    db.prepare('INSERT INTO place_presence (place_id, user_id, entered_at) VALUES (?, ?, ?)')
        .run(placeId, userId, now);
}

describe('evaluateCurfewSweep', () => {
    it('fires curfew_violation when outside home during curfew window', () => {
        const db = createTestDb();
        const { userId } = seedUser(db);
        const homeId = seedPlace(db, 1, 'Home');
        seedPlace(db, 1, 'Friend');
        const now = nyLocal(23, 30);
        seedLocation(db, userId, now);
        seedCurfew(db, userId, { start: 22 * 60, end: 6 * 60, placeId: homeId });

        evaluateCurfewSweep(db, now);

        const alerts = db.prepare("SELECT * FROM routine_alerts WHERE kind = 'curfew_violation'").all();
        expect(alerts).toHaveLength(1);
        expect(alerts[0].user_id).toBe(userId);
    });

    it('does not fire when member is at home during curfew', () => {
        const db = createTestDb();
        const { userId } = seedUser(db);
        const homeId = seedPlace(db, 1, 'Home');
        const now = nyLocal(23, 30);
        seedLocation(db, userId, now);
        seedCurfew(db, userId, { start: 22 * 60, end: 6 * 60, placeId: homeId });
        seedPresence(db, userId, homeId, now - 3600000);

        evaluateCurfewSweep(db, now);

        const alerts = db.prepare("SELECT * FROM routine_alerts WHERE kind = 'curfew_violation'").all();
        expect(alerts).toHaveLength(0);
    });

    it('does not fire when subject is paused', () => {
        const db = createTestDb();
        const { userId } = seedUser(db);
        const homeId = seedPlace(db, 1, 'Home');
        const now = nyLocal(23, 30);
        seedLocation(db, userId, now);
        seedCurfew(db, userId, { start: 22 * 60, end: 6 * 60, placeId: homeId });
        db.prepare('UPDATE users SET paused_until = ? WHERE id = ?').run(now + 86400000, userId);

        evaluateCurfewSweep(db, now);

        const alerts = db.prepare("SELECT * FROM routine_alerts WHERE kind = 'curfew_violation'").all();
        expect(alerts).toHaveLength(0);
    });

    it('does not fire outside the curfew window', () => {
        const db = createTestDb();
        const { userId } = seedUser(db);
        const homeId = seedPlace(db, 1, 'Home');
        const now = nyLocal(15, 0);
        seedLocation(db, userId, now);
        seedCurfew(db, userId, { start: 22 * 60, end: 6 * 60, placeId: homeId });

        evaluateCurfewSweep(db, now);

        const alerts = db.prepare("SELECT * FROM routine_alerts WHERE kind = 'curfew_violation'").all();
        expect(alerts).toHaveLength(0);
    });

    it('does not duplicate alerts within the same night', () => {
        const db = createTestDb();
        const { userId } = seedUser(db);
        const homeId = seedPlace(db, 1, 'Home');
        const now = nyLocal(23, 30);
        seedLocation(db, userId, now);
        seedCurfew(db, userId, { start: 22 * 60, end: 6 * 60, placeId: homeId });

        evaluateCurfewSweep(db, now);
        evaluateCurfewSweep(db, now + 5 * 60000);

        const alerts = db.prepare("SELECT * FROM routine_alerts WHERE kind = 'curfew_violation'").all();
        expect(alerts).toHaveLength(1);
    });

    it('fires after midnight when curfew wraps midnight', () => {
        const db = createTestDb();
        const { userId } = seedUser(db);
        const homeId = seedPlace(db, 1, 'Home');
        const now = nyLocal(2, 30);
        seedLocation(db, userId, now);
        seedCurfew(db, userId, { start: 22 * 60, end: 6 * 60, placeId: homeId });

        evaluateCurfewSweep(db, now);

        const alerts = db.prepare("SELECT * FROM routine_alerts WHERE kind = 'curfew_violation'").all();
        expect(alerts).toHaveLength(1);
    });

    it('skips users who have not enabled curfew', () => {
        const db = createTestDb();
        const { userId } = seedUser(db);
        seedPlace(db, 1, 'Home');
        const now = nyLocal(23, 30);
        seedLocation(db, userId, now);
        db.prepare('INSERT OR IGNORE INTO alert_prefs (user_id) VALUES (?)').run(userId);

        evaluateCurfewSweep(db, now);

        const alerts = db.prepare("SELECT * FROM routine_alerts WHERE kind = 'curfew_violation'").all();
        expect(alerts).toHaveLength(0);
    });
});
