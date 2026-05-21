import { readFileSync } from 'node:fs';

let messaging = null;
let disabled = false;
let loggedOnce = false;

const SERVICE_ACCOUNT_PATH = process.env.FCM_SERVICE_ACCOUNT_PATH;

if (SERVICE_ACCOUNT_PATH) {
    try {
        const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
        const admin = await import('firebase-admin');
        const app = admin.default.initializeApp({
            credential: admin.default.credential.cert(serviceAccount),
        });
        messaging = admin.default.messaging(app);
    } catch (err) {
        console.error(`FCM init failed (${err.message}). Push notifications disabled.`);
        disabled = true;
    }
} else {
    disabled = true;
}

export function isFcmDisabled() {
    if (disabled && !loggedOnce) {
        console.log('FCM disabled — set FCM_SERVICE_ACCOUNT_PATH to enable push notifications.');
        loggedOnce = true;
    }
    return disabled;
}

export async function fanOut(circleId, payload, db, excludeUserId) {
    if (isFcmDisabled()) return;

    const rows = db
        .prepare(
            `SELECT ft.token, ft.user_id FROM fcm_tokens ft
             JOIN circle_members cm ON cm.user_id = ft.user_id
             WHERE cm.circle_id = ? AND ft.user_id != ?`,
        )
        .all(circleId, excludeUserId ?? -1);

    if (rows.length === 0) return;

    const tokens = rows.map((r) => r.token);
    const message = {
        data: payload,
        android: { priority: 'high' },
        tokens,
    };

    try {
        const response = await messaging.sendEachForMulticast(message);
        if (response.failureCount > 0) {
            const toDelete = [];
            response.responses.forEach((resp, idx) => {
                if (
                    !resp.success &&
                    resp.error?.code === 'messaging/registration-token-not-registered'
                ) {
                    toDelete.push(rows[idx].token);
                }
            });
            if (toDelete.length > 0) {
                const del = db.prepare('DELETE FROM fcm_tokens WHERE token = ?');
                for (const t of toDelete) del.run(t);
            }
        }
    } catch (err) {
        console.error(`FCM fanOut failed: ${err.message}`);
    }
}

export async function fanOutToUsers(userIds, payload, db) {
    if (isFcmDisabled() || !userIds?.length) return;

    const placeholders = userIds.map(() => '?').join(',');
    const rows = db.prepare(
        `SELECT token FROM fcm_tokens WHERE user_id IN (${placeholders})`
    ).all(...userIds);

    if (rows.length === 0) return;

    const tokens = rows.map((r) => r.token);
    const message = {
        data: payload,
        android: { priority: 'high' },
        tokens,
    };

    try {
        const response = await messaging.sendEachForMulticast(message);
        if (response.failureCount > 0) {
            const toDelete = [];
            response.responses.forEach((resp, idx) => {
                if (
                    !resp.success &&
                    resp.error?.code === 'messaging/registration-token-not-registered'
                ) {
                    toDelete.push(rows[idx].token);
                }
            });
            if (toDelete.length > 0) {
                const del = db.prepare('DELETE FROM fcm_tokens WHERE token = ?');
                for (const t of toDelete) del.run(t);
            }
        }
    } catch (err) {
        console.error(`FCM fanOutToUsers failed: ${err.message}`);
    }
}
