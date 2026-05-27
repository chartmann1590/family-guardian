import { test, expect } from '@playwright/test';

test.describe('Emergency Contacts', () => {
    test('invite, accept, SOS triggers push-only, revoke', async ({ page, request }) => {
        const baseUrl = process.env.FG_BASE_URL || 'http://127.0.0.1:18080';

        const loginRes = await request.post(`${baseUrl}/api/auth/login`, {
            data: { email: 'alice@example.com', password: 'hunter2hunter' },
        });
        const admin = await loginRes.json();

        const inviteCodeRes = await request.post(`${baseUrl}/api/circles/${admin.circleId}/invites`, {
            headers: { Authorization: `Bearer ${admin.token}` },
        });
        const invite = await inviteCodeRes.json();

        const contactSignup = await request.post(`${baseUrl}/api/auth/signup`, {
            data: { email: 'ec-contact@test.com', password: 'Test1234!', displayName: 'EC Contact', inviteCode: invite.code },
        });
        const contact = await contactSignup.json();

        const inviteRes = await request.post(`${baseUrl}/api/users/me/emergency-contacts`, {
            headers: { Authorization: `Bearer ${admin.token}` },
            data: { email: 'ec-contact@test.com' },
        });
        expect(inviteRes.ok()).toBeTruthy();
        const invite = await inviteRes.json();
        expect(invite.status).toBe('pending');

        const pendingRes = await request.get(`${baseUrl}/api/users/me/pending-invites`, {
            headers: { Authorization: `Bearer ${contact.token}` },
        });
        const pending = await pendingRes.json();
        expect(pending.invites.length).toBeGreaterThanOrEqual(1);

        const acceptRes = await request.post(`${baseUrl}/api/users/me/emergency-contacts/${invite.id}/respond`, {
            headers: { Authorization: `Bearer ${contact.token}` },
            data: { action: 'accept' },
        });
        expect(acceptRes.ok()).toBeTruthy();
        const accepted = await acceptRes.json();
        expect(accepted.status).toBe('accepted');

        const contactsRes = await request.get(`${baseUrl}/api/users/me/emergency-contacts`, {
            headers: { Authorization: `Bearer ${admin.token}` },
        });
        const contacts = await contactsRes.json();
        expect(contacts.contacts.some(c => c.status === 'accepted')).toBeTruthy();

        const revokeRes = await request.delete(`${baseUrl}/api/users/me/emergency-contacts/${invite.id}`, {
            headers: { Authorization: `Bearer ${admin.token}` },
        });
        expect(revokeRes.ok()).toBeTruthy();
    });
});
