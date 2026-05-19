import { test, expect } from '@playwright/test';

/**
 * Fresh-DB happy path: visiting `/` redirects to `/setup`, the wizard creates
 * the admin, and we land on the dashboard. Run against a server with a fresh
 * volume; the docker-ci workflow does `docker compose down -v` between runs.
 */
test.describe('first-run setup', () => {
    test('root redirects to /setup when DB is empty', async ({ page }) => {
        const res = await page.goto('/');
        expect(res?.status()).toBeLessThan(400);
        await expect(page).toHaveURL(/\/setup$/);
        await expect(page.getByRole('heading', { name: /welcome to family guardian/i })).toBeVisible();
    });

    test('the setup wizard creates the admin and redirects to dashboard', async ({ page }) => {
        await page.goto('/setup');
        await page.getByRole('button', { name: /get started/i }).click();

        await page.locator('input[name="displayName"]').fill('Alice');
        await page.locator('input[name="email"]').fill('alice@example.com');
        await page.locator('input[name="password"]').fill('hunter2hunter');
        // circleName left blank — should default to "Alice's Family"

        await page.getByRole('button', { name: /create my account/i }).click();

        await expect(page.getByRole('heading', { name: /you're all set/i })).toBeVisible({ timeout: 10_000 });

        // The success screen links to /dashboard.
        const dashLink = page.getByRole('link', { name: /go to the dashboard/i });
        await expect(dashLink).toBeVisible();
        await dashLink.click();
        await expect(page).toHaveURL(/\/dashboard$/);
    });
});

test.describe('static pages', () => {
    test('/how-it-works renders', async ({ page }) => {
        await page.goto('/how-it-works');
        await expect(page.getByRole('heading', { name: /how family guardian works/i })).toBeVisible();
    });

    test('/download serves the APK', async ({ request }) => {
        const r = await request.head('/download/family-guardian.apk');
        expect(r.status()).toBe(200);
        expect(r.headers()['content-type']).toBe('application/vnd.android.package-archive');
        expect(Number(r.headers()['content-length'])).toBeGreaterThan(1024 * 1024); // > 1 MB
    });

    test('/download/qr.svg returns SVG', async ({ request }) => {
        const r = await request.get('/download/qr.svg');
        expect(r.status()).toBe(200);
        expect(r.headers()['content-type']).toContain('svg');
        const body = await r.text();
        expect(body).toContain('<svg');
    });
});
