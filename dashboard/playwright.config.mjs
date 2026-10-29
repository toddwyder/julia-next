import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: { baseURL: process.env.DASHBOARD_URL || 'http://127.0.0.1:3101', trace: 'retain-on-failure' },
  webServer: process.env.DASHBOARD_URL ? undefined : {
    command: 'node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3101',
    url: 'http://127.0.0.1:3101',
    reuseExistingServer: false,
    env: { LINEAR_API_KEY: '' },
  },
  projects: [
    { name: 'phone', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
});
