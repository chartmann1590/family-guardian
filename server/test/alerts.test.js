import { describe, it, expect } from 'vitest';
import { createTestDb, seedUser } from './helpers.js';
import { evaluateAlerts, evaluateOfflineSweep } from '../src/alerts.js';

function evaluate(db, ctx, partial = {}) {
    evaluateAlerts(db, {
        userId: ctx.userId,
        circleId: ctx.circleId,
        displayName: 'Alice',
        speedMps: null,
        batteryPct: null,
        activity: null,
        prevBatteryPct: null,
        ...partial,
    });
}

describe('alerts', () => {
    it('fires a speeding alert when over threshold while driving', () => {
        const db = createTestDb();
        const ctx = seedUser(db);
        evaluate(db, ctx, { speedMps: 40, activity: 'driving' });
        const rows = db.prepare("SELECT * FROM alert_events WHERE type = 'speeding'").all();
        expect(rows).toHaveLength(1);
        expect(rows[0].value).toBe(40);
    });

    it('falls back to speed >= 7 m/s when activity is null', () => {
        const db = createTestDb();
        const ctx = seedUser(db);
        evaluate(db, ctx, { speedMps: 35, activity: null });
        const rows = db.prepare("SELECT * FROM alert_events WHERE type = 'speeding'").all();
        expect(rows).toHaveLength(1);
    });

    it('debounces speeding alerts within 5 minutes', () => {
        const db = createTestDb();
        const ctx = seedUser(db);
        evaluate(db, ctx, { speedMps: 40, activity: 'driving' });
        evaluate(db, ctx, { speedMps: 42, activity: 'driving' });
        const rows = db.prepare("SELECT * FROM alert_events WHERE type = 'speeding'").all();
        expect(rows).toHaveLength(1);
    });

    it('fires low_battery on falling-edge crossing only', () => {
        const db = createTestDb();
        const ctx = seedUser(db);
        evaluate(db, ctx, { batteryPct: 50, prevBatteryPct: 60 });
        evaluate(db, ctx, { batteryPct: 10, prevBatteryPct: 50 });
        evaluate(db, ctx, { batteryPct: 9, prevBatteryPct: 10 });
        const rows = db.prepare("SELECT * FROM alert_events WHERE type = 'low_battery'").all();
        expect(rows).toHaveLength(1);
        expect(rows[0].value).toBe(10);
    });

    it('respects disabled prefs', () => {
        const db = createTestDb();
        const ctx = seedUser(db);
        db.prepare('INSERT INTO alert_prefs (user_id, speeding_enabled) VALUES (?, 0)').run(ctx.userId);
        evaluate(db, ctx, { speedMps: 50, activity: 'driving' });
        const rows = db.prepare("SELECT * FROM alert_events").all();
        expect(rows).toHaveLength(0);
    });

    it('offline sweep fires once per stale window', () => {
        const db = createTestDb();
        const ctx = seedUser(db);
        const past = Date.now() - 60 * 60_000;
        db.prepare(
            'INSERT INTO locations (user_id, lat, lng, recorded_at) VALUES (?, ?, ?, ?)',
        ).run(ctx.userId, 47.6, -122.3, past);
        evaluateOfflineSweep(db);
        evaluateOfflineSweep(db);
        const rows = db.prepare("SELECT * FROM alert_events WHERE type = 'offline'").all();
        expect(rows).toHaveLength(1);
    });
});
