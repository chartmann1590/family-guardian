import { test, expect } from '@playwright/test';

test.describe('Digest Timing', () => {
    test('set timezone + day-of-week + hour, verify prefs persist', async ({ request }) => {
        const baseUrl = process.env.FG_BASE_URL || 'http://127.0.0.1:18080';

        const loginRes = await request.post(`${baseUrl}/api/auth/login`, {
            data: { email: 'alice@example.com', password: 'hunter2hunter' },
        });
        const admin = await loginRes.json();

        const prefsRes = await request.patch(`${baseUrl}/api/users/me/alert-prefs`, {
            headers: { Authorization: `Bearer ${admin.token}` },
            data: {
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
        expect(prefs.digestDayOfWeek).toBe(0);
        expect(prefs.digestHourLocal).toBe(18);
        expect(prefs.digestTimezone).toBe('America/Chicago');
    });
});
