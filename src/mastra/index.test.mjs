import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ROLE_GROUPS } from '../../dashboard/lib/model-settings.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const indexUrl = new URL('./index.ts', import.meta.url).href;
const graphifyUrl = new URL('../../machine/flow/graphify.mjs', import.meta.url).href;

const ROLE_FILE_TEXT = [
  '# budget: medium (high)',
  ...ROLE_GROUPS.flatMap(group => group.roles.map(role => `${role.name}: test/unpriced`)),
  '',
].join('\n');

function setupEnvironment(t, extraEnv = {}) {
  const root = mkdtempSync(join(tmpdir(), 'studio-limits-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const flowDir = join(root, 'flow');
  const juliaConfig = join(home, '.config', 'julia');
  mkdirSync(juliaConfig, { recursive: true });
  mkdirSync(flowDir, { recursive: true });
  writeFileSync(join(juliaConfig, 'lead-model'), 'test/unpriced\n');
  writeFileSync(join(juliaConfig, 'lead-role-models.md'), ROLE_FILE_TEXT);

  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    FLOW_DIR: flowDir,
    ...extraEnv,
  };
  delete env.JULIA_LEAD_MODEL_FILE;
  delete env.JULIA_LEAD_ROLE_MODELS_FILE;
  delete env.FLOW_REPO;
  delete env.FLOW_CARD;
  if (!Object.hasOwn(extraEnv, 'FLOW_DOLLAR_CAP')) delete env.FLOW_DOLLAR_CAP;
  if (!Object.hasOwn(extraEnv, 'FLOW_TOKEN_CAP')) delete env.FLOW_TOKEN_CAP;

  return { root, home, flowDir, env };
}

test('Studio card-path starts a run from the run form and reaches the build step', t => {
  const { env } = setupEnvironment(t);
  const childScript = `
    import assert from 'node:assert/strict';
    import { mastra } from ${JSON.stringify(indexUrl)};
    import { closeGraphify } from ${JSON.stringify(graphifyUrl)};

    try {
      const workflow = mastra.getWorkflow('card-path');
      const run = await workflow.createRun();
      const result = await run.start({ inputData: { card: 'JUL-363-TEST', kind: 'machine' } });
      assert.equal(result.status, 'failed');
      assert.equal(result.steps.start.status, 'success');
      assert.match(JSON.stringify(result), /test\\/unpriced/);
    } finally {
      await mastra.shutdown();
      await mastra.getStorage()?.close();
      await closeGraphify();
    }
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], { cwd: repoRoot, env, encoding: 'utf8' });
  assert.equal(child.status, 0, `child exited ${child.status}\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`);
});
