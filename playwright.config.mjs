import { defineConfig } from '@playwright/test';

const targetUrl = process.env.JULIA_VERIFY_URL;

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: targetUrl ?? 'http://127.0.0.1:3000' },
  ...(targetUrl ? {} : {
    webServer: {
      command: 'npm run dev -- --hostname 127.0.0.1',
      url: 'http://127.0.0.1:3000',
      timeout: 120_000,
    },
  }),
});
