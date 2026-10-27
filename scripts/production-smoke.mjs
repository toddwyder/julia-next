// Checks that Julia's production address serves the given commit, and that its
// pages load. The address is the one Google sign-in authorises, so a wrong address
// in the code fails here instead of in front of Todd.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AUTHORISED_DOMAIN } from './provision-firebase.mjs';

export function smokeEnvironment({ commit, address = AUTHORISED_DOMAIN }) {
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) throw new Error('production smoke needs the full 40-character merge commit');
  return { JULIA_VERIFY_URL: `https://${address}`, JULIA_SMOKE_COMMIT: commit };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [commit, address] = process.argv.slice(2);
  const env = smokeEnvironment({ commit, address });
  console.log(`Checking ${env.JULIA_VERIFY_URL} serves ${commit}`);
  const run = spawnSync('npx', ['--no-install', 'playwright', 'test', '.agents/skills/verify-julia/tests/release.spec.mjs', '--retries=2'], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  process.exitCode = run.status ?? 1;
}
