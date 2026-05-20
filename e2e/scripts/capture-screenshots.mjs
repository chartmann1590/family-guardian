#!/usr/bin/env node
// Capture PWA screenshots into docs/screenshots/.
//
// Expects a Family Guardian server (the throwaway e2e container is fine) to
// already be running with a bootstrapped admin account. Credentials and base
// URL are read from env vars with defaults that match the e2e suite:
//   FG_BASE_URL    default http://127.0.0.1:18080
//   FG_E2E_USER    default alice@example.com
//   FG_E2E_PASS    default hunter2hunter
//
// Usage: node e2e/scripts/capture-screenshots.mjs

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE_URL = process.env.FG_BASE_URL || 'http://127.0.0.1:18080';
const EMAIL = process.env.FG_E2E_USER || 'alice@example.com';
const PASSWORD = process.env.FG_E2E_PASS || 'hunter2hunter';
const OUT = resolve(import.meta.dirname, '..', '..', 'docs', 'screenshots');

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true };

mkdirSync(OUT, { recursive: true });

async function login(page) {
    await page.goto(`${BASE_URL}/`);
    if (page.url().endsWith('/setup')) {
        // Fresh DB — run bootstrap so this script also works on a clean container.
        await page.getByRole('button', { name: /get started/i }).click();
        await page.locator('input[name="displayName"]').fill('Alice');
        await page.locator('input[name="email"]').fill(EMAIL);
        await page.locator('input[name="password"]').fill(PASSWORD);
        await page.getByRole('button', { name: /create my account/i }).click();
        await page.getByRole('link', { name: /go to the dashboard/i }).click();
        return;
    }
    // The login form is hidden until JS detects an existing admin; wait for it.
    await page.locator('#login-form').waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('#login-email').fill(EMAIL);
    await page.locator('#login-password').fill(PASSWORD);
    const submit = page.locator('#login-form button[type="submit"]');
    await submit.scrollIntoViewIfNeeded();
    await submit.click();
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
}

async function dismissCoach(page) {
    const skip = page.locator('#coach-skip');
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.waitForTimeout(400);
}

async function shot(page, name) {
    const file = join(OUT, `${name}.png`);
    // Retry up to 3 times — chromium occasionally returns "Unable to capture
    // screenshot" on the first try after a navigation while it's still
    // composing layers, especially on Windows with software rendering.
    let lastErr;
    for (let i = 0; i < 3; i++) {
        try {
            await page.waitForTimeout(300);
            await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
            console.log(`  saved ${file}`);
            return;
        } catch (err) {
            lastErr = err;
            await page.waitForTimeout(500);
        }
    }
    throw lastErr;
}

async function capture(viewport, label) {
    const browser = await chromium.launch({
        args: ['--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox']
    });
    const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true });
    const page = await context.newPage();

    console.log(`\n=== ${label} viewport ${viewport.width}x${viewport.height} ===`);

    // Public pages (no auth)
    await page.goto(`${BASE_URL}/how-it-works`);
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await shot(page, `pwa-how-it-works-${label}`);

    await page.goto(`${BASE_URL}/download`);
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await shot(page, `pwa-download-${label}`);

    // Auth flow
    await login(page);
    await dismissCoach(page);
    await page.waitForTimeout(1_000); // let the leaflet map paint

    await shot(page, `pwa-dashboard-${label}`);

    await page.goto(`${BASE_URL}/places`);
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await shot(page, `pwa-places-${label}`);

    await page.goto(`${BASE_URL}/chat`);
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await shot(page, `pwa-chat-${label}`);

    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await shot(page, `pwa-settings-${label}`);

    await page.goto(`${BASE_URL}/welcome`);
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await shot(page, `pwa-welcome-${label}`);

    await browser.close();
}

await capture(DESKTOP, 'desktop');
await capture(MOBILE, 'mobile');

console.log(`\nAll screenshots written to ${OUT}`);
