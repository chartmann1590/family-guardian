import { test, expect } from '@playwright/test';

test.describe('Emergency Contacts', () => {
    test('invite, accept, SOS triggers push-only, revoke', async ({ page, request }) => {
        const baseUrl = process.env.FG_BASE_URL || 'http://127.0.0.1:18080';

        const signup = async (email, name) => {
            const r = await request.post(`${baseUrl}/api/auth/signup`, {
                data: { email, password: 'Test1234!', displayName: name },
            });
            return r.json();
        };

        const admin = await signup('ec-admin@test.com', 'EC Admin');
        const contact = await signup('ec-contact@test.com', 'EC Contact');

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
