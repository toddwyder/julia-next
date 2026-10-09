import { defineConfig } from '@playwright/test';
if (!process.env.JULIA_SMOKE_URL || !process.env.JULIA_SMOKE_COMMIT) throw Error('release smoke needs URL and expected deployment commit');
export default defineConfig({
  testDir: './e2e', testMatch: ['home.spec.mjs', 'release.spec.mjs'],
  use: { baseURL: process.env.JULIA_SMOKE_URL }, retries: 0,
});
