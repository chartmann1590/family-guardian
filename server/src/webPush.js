import webpush from 'web-push';

let disabled = false;
let loggedOnce = false;

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@familyguardian.local';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    try {
        webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    } catch (err) {
        console.error(`Web Push VAPID init failed (${err.message}). Web push disabled.`);
        disabled = true;
    }
} else {
    disabled = true;
}

export function isWebPushDisabled() {
    if (disabled && !loggedOnce) {
        console.log('Web Push disabled — set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to enable.');
        loggedOnce = true;
    }
    return disabled;
}

export function getPublicKey() {
    return VAPID_PUBLIC_KEY || null;
}

export async function fanOut(circleId, payload, db, excludeUserId) {
    if (isWebPushDisabled()) return;

    const rows = db.prepare(`
        SELECT wps.id, wps.endpoint, wps.p256dh, wps.auth, wps.user_id
        FROM web_push_subscriptions wps
        JOIN circle_members cm ON cm.user_id = wps.user_id
        WHERE cm.circle_id = ? AND wps.user_id != ?
    `).all(circleId, excludeUserId ?? -1);

    if (rows.length === 0) return;

    await sendToMany(rows, payload, db);
}

export async function fanOutToUsers(userIds, payload, db) {
    if (isWebPushDisabled() || !userIds?.length) return;

    const placeholders = userIds.map(() => '?').join(',');
    const rows = db.prepare(
        `SELECT id, endpoint, p256dh, auth, user_id FROM web_push_subscriptions WHERE user_id IN (${placeholders})`
    ).all(...userIds);

    if (rows.length === 0) return;

    await sendToMany(rows, payload, db);
}

async function sendToMany(subscriptions, payload, db) {
    const message = JSON.stringify(payload);
    const toDelete = [];

    await Promise.allSettled(subscriptions.map(async (sub) => {
        try {
            await webpush.sendNotification({
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
            }, message);
            db.prepare('UPDATE web_push_subscriptions SET last_seen_at = ? WHERE id = ?')
                .run(Date.now(), sub.id);
        } catch (err) {
            if (err.statusCode === 410 || err.statusCode === 404) {
                toDelete.push(sub.id);
            }
        }
    }));

    if (toDelete.length > 0) {
        const del = db.prepare('DELETE FROM web_push_subscriptions WHERE id = ?');
        for (const id of toDelete) del.run(id);
    }
}
