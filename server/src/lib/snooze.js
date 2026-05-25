const NEVER_SNOOZABLE = new Set(['sos_active', 'crash_pending', 'crash_detected']);

export function isSnoozed(db, userId, alertType) {
    if (NEVER_SNOOZABLE.has(alertType)) return false;
    const row = db.prepare(
        'SELECT 1 FROM alert_snoozes WHERE user_id = ? AND alert_type = ? AND snooze_until > ?'
    ).get(userId, alertType, Date.now());
    return !!row;
}

export function setSnooze(db, userId, alertType, untilMs) {
    if (NEVER_SNOOZABLE.has(alertType)) return false;
    db.prepare(
        'INSERT OR REPLACE INTO alert_snoozes (user_id, alert_type, snooze_until) VALUES (?, ?, ?)'
    ).run(userId, alertType, untilMs);
    return true;
}

export function clearSnooze(db, userId, alertType) {
    db.prepare('DELETE FROM alert_snoozes WHERE user_id = ? AND alert_type = ?').run(userId, alertType);
}

export function listSnoozes(db, userId) {
    return db.prepare(
        'SELECT alert_type AS alertType, snooze_until AS snoozeUntil FROM alert_snoozes WHERE user_id = ? AND snooze_until > ?'
    ).all(userId, Date.now());
}
