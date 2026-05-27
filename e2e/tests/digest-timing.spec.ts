import { test, expect } from '@playwright/test';

test.describe('Digest Timing', () => {
    test('set timezone + day-of-week + hour, verify prefs persist', async ({ request }) => {
        const baseUrl = process.env.FG_BASE_URL || 'http://127.0.0.1:18080';

        const loginRes = await request.post(`${baseUrl}/api/auth/login`, {
            data: { email: 'alice@example.com', password: 'hunter2hunter' },
        });
        const admin = await loginRes.json();

        const prefsRes = await request.patch(`${baseUrl}/api/users/me/digest-prefs`, {
            headers: { Authorization: `Bearer ${admin.token}` },
            data: {
                weeklyDigestEnabled: true,
                digestDayOfWeek: 0,
                digestHourLocal: 18,
                digestTimezone: 'America/Chicago',
            },
        });
        expect(prefsRes.ok()).toBeTruthy();

        const checkRes = await request.get(`${baseUrl}/api/users/me/alert-prefs`, {
            headers: { Authorization: `Bearer ${admin.token}` },
        });
        const prefs = await checkRes.json();
        expect(prefs.digest_day_of_week).toBe(0);
        expect(prefs.digest_hour_local).toBe(18);
        expect(prefs.digest_timezone).toBe('America/Chicago');
    });
});
