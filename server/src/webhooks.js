import { createHmac } from 'node:crypto';

const EVENTS = [
    'sos_active', 'crash_pending', 'geofence_enter', 'geofence_exit',
    'low_battery', 'curfew_violation', 'routine_deviation',
];

let dbRef = null;

export function initWebhooks(db) {
    dbRef = db;
}

export function dispatchWebhook(circleId, event) {
    if (!dbRef) return;
    const eventType = event.type;
    if (!EVENTS.includes(eventType)) return;

    const hooks = dbRef.prepare(
        'SELECT * FROM webhooks WHERE circle_id = ? AND active = 1'
    ).all(circleId);

    for (const hook of hooks) {
        const hookEvents = hook.events.split(',').map(e => e.trim());
        if (!hookEvents.includes(eventType) && !hookEvents.includes('*')) continue;

        const payload = JSON.stringify(event);
        const signature = createHmac('sha256', hook.secret).update(payload).digest('hex');

        const now = Date.now();
        fetch(hook.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-FG-Signature': `sha256=${signature}`,
                'X-FG-Event': eventType,
            },
            body: payload,
        }).then(() => {
            dbRef.prepare(
                'UPDATE webhooks SET last_dispatched_at = ?, last_error = NULL WHERE id = ?'
            ).run(now, hook.id);
        }).catch((err) => {
            dbRef.prepare(
                'UPDATE webhooks SET last_error = ? WHERE id = ?'
            ).run(err.message, hook.id);
        });
    }
}
