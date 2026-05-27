import { publish } from './hub.js';
import { fanOut } from './fcm.js';
import { fanOut as webPushFanOut } from './webPush.js';
import { isSnoozed } from './lib/snooze.js';
import { estimateLocalMinute, inQuietHoursLocal } from './routines.js';
import { dispatchWebhook } from './webhooks.js';

export function evaluateCurfewSweep(db, now = Date.now()) {
    const users = db.prepare(`
        SELECT u.id AS user_id, u.display_name, u.paused_until,
               ap.curfew_start, ap.curfew_end, ap.curfew_home_place_id,
               cm.circle_id
        FROM users u
        JOIN alert_prefs ap ON ap.user_id = u.id
        JOIN circle_members cm ON cm.user_id = u.id
        WHERE ap.curfew_enabled = 1
          AND ap.curfew_start IS NOT NULL
          AND ap.curfew_end IS NOT NULL
          AND ap.curfew_home_place_id IS NOT NULL
    `).all();

    const insertAlert = db.prepare(`
        INSERT INTO routine_alerts (routine_id, user_id, circle_id, kind, fired_at, fired_local_date,
                                    expected_minute, actual_minute, created_at)
        VALUES (NULL, ?, ?, 'curfew_violation', ?, ?, ?, NULL, ?)
        ON CONFLICT (user_id, kind, fired_local_date) DO NOTHING
    `);

    const getPresence = db.prepare(`
        SELECT 1 FROM place_presence
        WHERE user_id = ? AND place_id = ?
    `);

    for (const u of users) {
        if (u.paused_until && u.paused_until > now) continue;

        const lngRow = db.prepare(
            'SELECT lng FROM locations WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 1'
        ).get(u.user_id);
        const lng = lngRow?.lng ?? 0;
        const local = estimateLocalMinute(lng, now);

        if (!inQuietHoursLocal(u.curfew_start, u.curfew_end, local.minute)) continue;

        const atHome = !!getPresence.get(u.user_id, u.curfew_home_place_id);
        if (atHome) continue;

        const utcOffsetH = Math.round(lng / 15);
        const localDate = new Date(now + utcOffsetH * 3600000);
        if (u.curfew_start > u.curfew_end && local.minute < u.curfew_end) {
            localDate.setDate(localDate.getDate() - 1);
        }
        const dateStr = `${localDate.getUTCFullYear()}-${String(localDate.getUTCMonth() + 1).padStart(2, '0')}-${String(localDate.getUTCDate()).padStart(2, '0')}`;

        const result = insertAlert.run(
            u.user_id, u.circle_id, now, dateStr, u.curfew_start, now,
        );

        if (result.changes > 0) {
            const placeName = db.prepare('SELECT name FROM places WHERE id = ?').get(u.curfew_home_place_id)?.name ?? 'home';
            const ev = {
                type: 'routine_deviation',
                userId: u.user_id,
                displayName: u.display_name,
                routineId: null,
                placeId: u.curfew_home_place_id,
                placeName,
                kind: 'curfew_violation',
                curfewStart: u.curfew_start,
                curfewEnd: u.curfew_end,
                expectedMinute: u.curfew_start,
                actualMinute: null,
            };
            publish(u.circle_id, ev);
            const members = db.prepare('SELECT user_id FROM circle_members WHERE circle_id = ? AND user_id != ?').all(u.circle_id, u.user_id);
            if (members.some(m => !isSnoozed(db, m.user_id, 'curfew_violation'))) {
                fanOut(u.circle_id, ev, db, u.user_id);
                webPushFanOut(u.circle_id, ev, db, u.user_id);
            }
            dispatchWebhook(u.circle_id, ev);
        }
    }
}
