import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.FG_BASE_URL || 'http://127.0.0.1:18080';

export default defineConfig({
    testDir: './tests',
    fullyParallel: false, // server has a shared SQLite — tests must run in order
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
    timeout: 30_000,
    use: {
        baseURL: BASE_URL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
});
