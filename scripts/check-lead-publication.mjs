import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAgents } from '../machine/flow/agents.mjs';

export async function checkLeadPublication({ repo = process.cwd() } = {}) {
  const workspace = await createAgents({ repo }).build.getWorkspace();
  const sandbox = workspace.sandbox;
  try {
    await sandbox.start();
    const identity = await sandbox.executeCommand('gh', ['api', 'user', '--jq', '.login']);
    assert.equal(identity.exitCode, 0, 'Lead must find the existing GitHub sign-in.');
    const access = await sandbox.executeCommand('gh', ['api', 'repos/toddwyder/julia-next', '--jq', '.permissions.push']);
    assert.equal(access.exitCode, 0, 'Lead must read the repository permissions.');
    assert.equal(access.stdout.trim(), 'true', 'Lead must have repository push access.');
    const push = await sandbox.executeCommand('git', ['push', '--dry-run', 'origin', 'HEAD:refs/heads/build/jul-339-lead']);
    assert.equal(push.exitCode, 0, 'Lead must authenticate a Git push dry run.');
    return {
      githubLogin: identity.stdout.trim(),
      repository: 'toddwyder/julia-next',
      pushAccess: true,
      gitPushDryRun: 'PASS',
      source: 'existing ubuntu GitHub sign-in and Git credential helper',
    };
  } finally {
    await sandbox.stop();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const output = JSON.stringify(await checkLeadPublication(), null, 2) + '\n';
    if (process.argv[2]) writeFileSync(resolve(process.argv[2]), output);
    console.log(output);
  } catch (error) {
    console.error(error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'The Lead publication check could not complete.');
    process.exitCode = 1;
  }
}
