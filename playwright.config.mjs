import { defineConfig } from '@playwright/test';

const targetUrl = process.env.JULIA_VERIFY_URL;

// Without a target the specs run against a local dev server wired to the
// Firebase emulators. The emulators hold one shared household library, so
// those runs use one worker.
export default defineConfig({
  testDir: '.',
  respectGitIgnore: true,
  testMatch: /\.spec\.[cm]?[jt]sx?$/,
  use: { baseURL: targetUrl ?? 'http://127.0.0.1:3000' },
  ...(targetUrl ? {} : {
    workers: 1,
    webServer: [
      {
        command: 'node scripts/firebase-emulators.mjs',
        wait: { stdout: /Firebase emulators ready/ },
        timeout: 180_000,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 50_000 },
      },
      {
        command: 'npm run dev -- --hostname 127.0.0.1',
        url: 'http://127.0.0.1:3000',
        timeout: 120_000,
        env: { NEXT_PUBLIC_FIREBASE_EMULATOR: '1', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
      },
    ],
  }),
});
