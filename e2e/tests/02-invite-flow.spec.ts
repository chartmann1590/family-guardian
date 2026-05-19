import { test, expect } from '@playwright/test';

/**
 * Depends on 01-first-run.spec.ts having created Alice. Logs in as Alice,
 * opens the dashboard, and exercises the "Invite family" modal.
 */
test.describe('invite flow', () => {
    test('admin can log in and open the invite modal', async ({ page }) => {
        await page.goto('/');
        await expect(page).toHaveURL(/\/$/);
        await page.locator('input[name="email"]').fill('alice@example.com');
        await page.locator('input[name="password"]').fill('hunter2hunter');
        await page.getByRole('button', { name: /^sign in$/i }).click();

        await expect(page).toHaveURL(/\/dashboard$/, { timeout: 10_000 });

        // The dashboard shows the coach overlay on first visit; dismiss it.
        const skip = page.getByRole('button', { name: /skip tour/i });
        if (await skip.isVisible().catch(() => false)) await skip.click();

        // Click "Invite family" in the sidebar.
        await page.getByRole('button', { name: /invite family/i }).click();

        // Modal renders with the invite content once minted.
        await expect(page.locator('#invite-content')).toBeVisible({ timeout: 10_000 });
        const code = await page.locator('#invite-code').textContent();
        expect(code?.trim()).toMatch(/^[A-Z0-9]{6,8}$/);
        await expect(page.locator('#invite-qr svg')).toBeVisible();
        const linkVal = await page.locator('#invite-link').inputValue();
        expect(linkVal).toContain('/join?code=');
    });

    test('the join link prefills the invite code', async ({ page }) => {
        // Re-use the invite generated in the previous test. We don't have the
        // value here, but the server also accepts arbitrary codes — the form
        // just submits whatever's in the hidden field. Render and assert.
        await page.goto('/join?code=PLAYWRIGHT-FAKE');
        const hidden = page.locator('input[name="inviteCode"]');
        await expect(hidden).toHaveValue('PLAYWRIGHT-FAKE');
    });
});
