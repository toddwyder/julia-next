import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const checkout = '/home/ubuntu/julia-machine-main';
const jobs = '/home/ubuntu/.local/state/julia-jul231/jobs-attempt-2';
const settingsPath = join(checkout, 'ops/build-runner/machine-settings.json');
const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
const sdkPath = join(checkout, 'ops/build-runner/node_modules/@mastra/code-sdk');
const sdk = JSON.parse(readFileSync(join(sdkPath, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(checkout, 'ops/build-runner/package-lock.json'), 'utf8'));
const authPaths = new Set(['/home/ubuntu/.local/share/mastracode/auth.json']);
if (settings.authPath) authPaths.add(settings.authPath);
if (existsSync(jobs)) {
  for (const name of readdirSync(jobs)) {
    const job = join(jobs, name);
    if (!statSync(job).isDirectory()) continue;
    authPaths.add(join(job, 'state/auth.json'));
    const jobSettings = join(job, 'settings.json');
    if (existsSync(jobSettings)) {
      const parsed = JSON.parse(readFileSync(jobSettings, 'utf8'));
      if (parsed.authPath) authPaths.add(parsed.authPath);
    }
  }
}
const credentials = [...authPaths].map(path => {
  const exists = existsSync(path);
  const stored = exists ? JSON.parse(readFileSync(path, 'utf8')) : {};
  return {
    path, exists,
    chatgptOAuthPresent: stored['openai-codex']?.type === 'oauth',
    anthropicOAuthPresent: stored.anthropic?.type === 'oauth',
  };
});
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  principal: execFileSync('id', ['-un'], { encoding: 'utf8' }).trim(),
  checkout,
  deployedCommit: execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  nodeVersion: process.version,
  sdkVersion: sdk.version,
  lockedSdkVersion: lock.packages['node_modules/@mastra/code-sdk'].version,
  sdkAutoUpdate: 'No SDK updater invoked; installed version matches lockfile.',
  settingsPath,
  configuredAuthPath: settings.authPath ?? null,
  roles: settings.roles,
  solUnavailable: settings.models['openai/gpt-6-sol']?.unavailable ?? null,
  credentials,
  commandCodeCredentialPresent: Boolean(process.env.COMMANDCODE_API_KEY),
  linearCredentialPresent: Boolean(process.env.LINEAR_API_KEY),
  inferenceRequestsMade: 0,
}, null, 2));
