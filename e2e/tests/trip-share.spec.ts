import { test, expect } from '@playwright/test';

test.describe('Trip Sharing', () => {
    test('mint token, public viewer fetches location, revoke returns 410', async ({ request, page }) => {
        const baseUrl = process.env.FG_BASE_URL || 'http://127.0.0.1:18080';

        const loginRes = await request.post(`${baseUrl}/api/auth/login`, {
            data: { email: 'alice@example.com', password: 'hunter2hunter' },
        });
        const admin = await loginRes.json();

        await request.post(`${baseUrl}/api/locations`, {
            headers: { Authorization: `Bearer ${admin.token}` },
            data: { lat: 40.7128, lng: -74.006, accuracyM: 10, speedMps: 0, batteryPct: 80, recordedAt: Date.now() },
        });

        const shareRes = await request.post(`${baseUrl}/api/users/me/trip-shares`, {
            headers: { Authorization: `Bearer ${admin.token}` },
            data: { durationMinutes: 60, destination: { lat: 40.7580, lng: -73.9855, label: 'Times Square' } },
        });
        expect(shareRes.ok()).toBeTruthy();
        const share = await shareRes.json();
        expect(share.token).toBeTruthy();
        expect(share.url).toBeTruthy();

        const locRes = await request.get(`${baseUrl}/share/${share.token}/loc`);
        expect(locRes.ok()).toBeTruthy();
        const loc = await locRes.json();
        expect(loc.lat).not.toBeNull();

        const pageRes = await request.get(`${baseUrl}/share/${share.token}`);
        expect(pageRes.ok()).toBeTruthy();
        expect(pageRes.headers()['content-type']).toContain('text/html');

        const revokeRes = await request.delete(`${baseUrl}/api/trip-shares/${share.token}`, {
            headers: { Authorization: `Bearer ${admin.token}` },
        });
        expect(revokeRes.ok()).toBeTruthy();

        const expiredRes = await request.get(`${baseUrl}/share/${share.token}/loc`);
        expect(expiredRes.status()).toBe(410);
    });
});
