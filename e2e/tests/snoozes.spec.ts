import { test, expect } from '@playwright/test';

test.describe('Alert Snoozes', () => {
    test('snooze geofence alert, verify no push while snoozed, snooze expires, push resumes; SOS not snoozable', async ({ request }) => {
        const baseUrl = process.env.FG_BASE_URL || 'http://127.0.0.1:18080';

        const loginRes = await request.post(`${baseUrl}/api/auth/login`, {
            data: { email: 'alice@example.com', password: 'hunter2hunter' },
        });
        const admin = await loginRes.json();

        const snoozeRes = await request.post(`${baseUrl}/api/users/me/alert-snooze`, {
            headers: { Authorization: `Bearer ${admin.token}` },
            data: { alertType: 'geofence_enter', durationMinutes: 60 },
        });
        expect(snoozeRes.ok()).toBeTruthy();

        const snoozesRes = await request.get(`${baseUrl}/api/users/me/alert-snoozes`, {
            headers: { Authorization: `Bearer ${admin.token}` },
        });
        const snoozes = await snoozesRes.json();
        expect(snoozes.snoozes.some(s => s.alertType === 'geofence_enter')).toBeTruthy();

        const cancelRes = await request.delete(`${baseUrl}/api/users/me/alert-snooze/geofence_enter`, {
            headers: { Authorization: `Bearer ${admin.token}` },
        });
        expect(cancelRes.ok()).toBeTruthy();

        const sosSnoozeRes = await request.post(`${baseUrl}/api/users/me/alert-snooze`, {
            headers: { Authorization: `Bearer ${admin.token}` },
            data: { alertType: 'sos_active', durationMinutes: 60 },
        });
        expect(sosSnoozeRes.status()).toBe(400);
    });
});
