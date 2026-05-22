import { describe, it, expect } from 'vitest';
import { createTestDb, seedUser, seedSecondUser } from './helpers.js';

describe('crash events', () => {
    it('rejects crash report when crash detection is disabled', () => {
        const db = createTestDb();
        const { userId } = seedUser(db);
        const enabled = db.prepare('SELECT crash_detection_enabled FROM users WHERE id = ?').get(userId);
        expect(enabled.crash_detection_enabled).toBe(0);
    });

    it('inserts crash event when detection is enabled', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        db.prepare('UPDATE users SET crash_detection_enabled = 1 WHERE id = ?').run(userId);

        db.prepare(
            `INSERT INTO crash_events
             (user_id, circle_id, detected_at, peak_accel_mps2, sustained_ms, platform)
             VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(userId, circleId, Date.now(), 32.0, 140, 'android');

        const row = db.prepare('SELECT * FROM crash_events WHERE user_id = ?').get(userId);
        expect(row).toBeTruthy();
        expect(row.peak_accel_mps2).toBe(32.0);
        expect(row.sustained_ms).toBe(140);
        expect(row.platform).toBe('android');
        expect(row.dismissed_at).toBeNull();
        expect(row.sos_event_id).toBeNull();
    });

    it('dismisses a crash event', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);

        db.prepare(
            `INSERT INTO crash_events
             (user_id, circle_id, detected_at, peak_accel_mps2, sustained_ms, platform)
             VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(userId, circleId, Date.now(), 32.0, 140, 'android');
        const crashId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

        db.prepare('UPDATE crash_events SET dismissed_at = ? WHERE id = ?').run(Date.now(), crashId);

        const row = db.prepare('SELECT * FROM crash_events WHERE id = ?').get(crashId);
        expect(row.dismissed_at).not.toBeNull();
        expect(row.sos_event_id).toBeNull();
    });

    it('escalates crash event by linking to sos_event', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);

        db.prepare(
            `INSERT INTO sos_events (circle_id, user_id, started_at, status)
             VALUES (?, ?, ?, 'active')`,
        ).run(circleId, userId, Date.now());
        const sosId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

        db.prepare(
            `INSERT INTO crash_events
             (user_id, circle_id, detected_at, peak_accel_mps2, sustained_ms, platform)
             VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(userId, circleId, Date.now(), 32.0, 140, 'android');
        const crashId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

        db.prepare('UPDATE crash_events SET sos_event_id = ? WHERE id = ? AND user_id = ? AND sos_event_id IS NULL')
            .run(sosId, crashId, userId);

        const row = db.prepare('SELECT * FROM crash_events WHERE id = ?').get(crashId);
        expect(row.sos_event_id).toBe(sosId);
        expect(row.dismissed_at).toBeNull();
    });

    it('prevents dismiss after escalation', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);

        db.prepare(
            `INSERT INTO sos_events (circle_id, user_id, started_at, status)
             VALUES (?, ?, ?, 'active')`,
        ).run(circleId, userId, Date.now());
        const sosId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

        db.prepare(
            `INSERT INTO crash_events
             (user_id, circle_id, detected_at, peak_accel_mps2, sustained_ms, platform, sos_event_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(userId, circleId, Date.now(), 32.0, 140, 'android', sosId);
        const crashId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

        const row = db.prepare('SELECT * FROM crash_events WHERE id = ?').get(crashId);
        expect(row.sos_event_id).not.toBeNull();
    });

    it('crash_detection_enabled column defaults to 0', () => {
        const db = createTestDb();
        const { userId } = seedUser(db);
        const row = db.prepare('SELECT crash_detection_enabled FROM users WHERE id = ?').get(userId);
        expect(row.crash_detection_enabled).toBe(0);
    });

    it('can toggle crash_detection_enabled', () => {
        const db = createTestDb();
        const { userId } = seedUser(db);
        db.prepare('UPDATE users SET crash_detection_enabled = 1 WHERE id = ?').run(userId);
        let row = db.prepare('SELECT crash_detection_enabled FROM users WHERE id = ?').get(userId);
        expect(row.crash_detection_enabled).toBe(1);

        db.prepare('UPDATE users SET crash_detection_enabled = 0 WHERE id = ?').run(userId);
        row = db.prepare('SELECT crash_detection_enabled FROM users WHERE id = ?').get(userId);
        expect(row.crash_detection_enabled).toBe(0);
    });
});
