import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkEvidence } from './trial-board.mjs';
import { GithubIntegration } from '@mastra/factory/integrations/github/integration';

const dir = '/var/lib/julia-factory/evidence/jul183';
const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
const checks = {
  'Agreed behavioral seam and acceptance criteria recorded': 'seam',
  'RED: browser test fails because the version behavior is missing': 'red',
  'GREEN: the same browser test passes with the minimal implementation': 'green',
  'Full relevant suite, framework lint and production build pass': 'suite',
  'Guard: removing the implementation in an isolated copy makes the browser test fail again': 'guard',
  'Separate Standards review report': 'standards',
  'Separate Spec review report': 'spec',
  'DeepSeek adversarial verdict on every acceptance criterion': 'deepseek',
  'Exact candidate and all required evidence verified before UAT': 'verified',
  'Rehearsal copy built from the exact candidate; review request sent to Todd': 'phone',
  'Todd accepts that candidate on the PR after using the rehearsal copy': 'approval',
  'Accepted candidate merged': 'merged',
};
const requirements = {
  seam: ['seam'], red: ['red'], green: ['green'], suite: ['suite'], guard: ['guard'],
  standards: ['standards'], spec: ['spec'], deepseek: ['deepseek'],
  verified: ['red', 'green', 'suite', 'guard', 'standards', 'spec', 'deepseek'],
  phone: ['rehearsal', 'review-request'], approval: ['approval'], merged: ['merged'],
};
const { requiredEvidence } = await import('./trial-board.mjs');
const github = new GithubIntegration({ appId: process.env.GITHUB_APP_ID,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY, clientId: process.env.GITHUB_APP_CLIENT_ID,
  clientSecret: process.env.GITHUB_APP_CLIENT_SECRET, slug: process.env.GITHUB_APP_SLUG,
});
const client = github.getInstallationOctokit(165438606);
const params = { owner: 'toddwyder', repo: 'julia-next', issue_number: 129 };
const { data: issue } = await client.rest.issues.get(params);
let body = issue.body;
for (const [label, key] of Object.entries(checks)) {
  // Same validator as the live transition policy. Never trust agent checkmarks.
  requiredEvidence[key] = requirements[key];
  const failures = await checkEvidence(dir, manifest.candidate, key);
  body = body.split('\n').map(line =>
    line.startsWith('- [') && line.slice(6) === label
      ? `- [${failures.length ? ' ' : 'X'}] ${label}` : line).join('\n');
  console.log(`${failures.length ? 'WAIT' : 'VERIFIED'}: ${key}`);
}
if (body !== issue.body) await client.rest.issues.update({ ...params, body });
console.log('GitHub issue checklist synchronized from verified artifacts');
