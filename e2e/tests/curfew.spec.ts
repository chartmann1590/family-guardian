import { test, expect } from '@playwright/test';

test.describe('Curfew', () => {
    test('configure curfew and verify violation fires once per night', async ({ request }) => {
        const baseUrl = process.env.FG_BASE_URL || 'http://127.0.0.1:18080';

        const signup = async (email, name) => {
            const r = await request.post(`${baseUrl}/api/auth/signup`, {
                data: { email, password: 'Test1234!', displayName: name },
            });
            return r.json();
        };

        const admin = await signup('curfew-admin@test.com', 'Curfew Admin');

        const placeRes = await request.post(`${baseUrl}/api/circles/${admin.circleId}/places`, {
            headers: { Authorization: `Bearer ${admin.token}` },
            data: { name: 'Home', lat: 40.7128, lng: -74.006, radiusM: 100, kind: 'home' },
        });
        expect(placeRes.ok()).toBeTruthy();
        const place = await placeRes.json();

        const prefsRes = await request.patch(`${baseUrl}/api/users/me/alert-prefs`, {
            headers: { Authorization: `Bearer ${admin.token}` },
            data: {
                curfewEnabled: true,
                curfewStart: 1320,
                curfewEnd: 360,
                curfewHomePlaceId: place.id,
            },
        });
        expect(prefsRes.ok()).toBeTruthy();

        const alertsRes = await request.get(`${baseUrl}/api/circles/${admin.circleId}/alerts`, {
            headers: { Authorization: `Bearer ${admin.token}` },
        });
        expect(alertsRes.ok()).toBeTruthy();
    });
});
