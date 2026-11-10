import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ROLE_GROUPS } from '../../dashboard/lib/model-settings.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const indexUrl = new URL('./index.ts', import.meta.url).href;
const controlUrl = new URL('../../machine/budget/control.mjs', import.meta.url).href;
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

function runCardPathCase(t, extraEnv) {
  const { home, env } = setupEnvironment(t, extraEnv);
  // Reset exitCode after mastra.shutdown() because createBuildBudget's abort listener sets it to 1 on stop.
  const childScript = `
    import assert from 'node:assert/strict';
    import { STUDIO_DOLLAR_CAP, STUDIO_TOKEN_CAP, mastra } from ${JSON.stringify(indexUrl)};
    import { closeGraphify } from ${JSON.stringify(graphifyUrl)};

    try {
      assert.equal(STUDIO_DOLLAR_CAP, 4);
      assert.equal(STUDIO_TOKEN_CAP, 2_000_000);
      const workflow = mastra.getWorkflow('card-path');
      const run = await workflow.createRun();
      const result = await run.start({ inputData: { card: 'JUL-363-TEST', kind: 'machine' } });
      assert.equal(result.status, 'failed');
    } finally {
      await mastra.shutdown();
      await mastra.getStorage()?.close();
      await closeGraphify();
    }
    process.exitCode = 0;
  `;

  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });
  assert.equal(
    child.status,
    0,
    `child exited ${child.status}\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`,
  );

  const recordPath = join(home, '.local/state/julia/budget/record.json');
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  const sliceStart = record.events.find(entry => entry.kind === 'slice_start');
  assert.ok(sliceStart, 'budget record must include a slice_start event');
  assert.equal(sliceStart.dollarCap, 4);
  assert.equal(sliceStart.tokenCap, 2_000_000);
  assert.notEqual(record.stop?.reason, 'missing_or_invalid_caps');
  assert.equal(record.stop?.reason, 'no_price');
  assert.equal(record.stop?.numbers?.role, 'lead');
  assert.equal(record.stop?.numbers?.model, 'test/unpriced');
}

for (const [label, extraEnv] of [
  ['with FLOW_DOLLAR_CAP and FLOW_TOKEN_CAP unset', {}],
  ['ignoring invalid FLOW_DOLLAR_CAP and zero FLOW_TOKEN_CAP', { FLOW_DOLLAR_CAP: 'invalid', FLOW_TOKEN_CAP: '0' }],
]) {
  test(`Studio card-path starts under built-in limits ${label}`, t => {
    runCardPathCase(t, extraEnv);
  });
}

test('createSliceControl accepts Studio built-in limits and completes a clean slice', t => {
  const { root, env } = setupEnvironment(t);
  const directory = join(root, 'direct-budget');
  const childScript = `
    import assert from 'node:assert/strict';
    import { STUDIO_DOLLAR_CAP, STUDIO_TOKEN_CAP, mastra } from ${JSON.stringify(indexUrl)};
    import { createSliceControl } from ${JSON.stringify(controlUrl)};
    import { closeGraphify } from ${JSON.stringify(graphifyUrl)};

    try {
      const control = createSliceControl({
        directory: ${JSON.stringify(directory)},
        dollarCap: STUDIO_DOLLAR_CAP,
        tokenCap: STUDIO_TOKEN_CAP,
      });
      control.assertStart();
      const started = control.snapshot();
      assert.equal(started.dollarCap, 4);
      assert.equal(started.tokenCap, 2_000_000);
      assert.equal(started.phase, 'idle');
      const finished = control.finish();
      assert.equal(finished.phase, 'finished');
    } finally {
      await mastra.shutdown();
      await mastra.getStorage()?.close();
      await closeGraphify();
    }
  `;

  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });
  assert.equal(
    child.status,
    0,
    `child exited ${child.status}\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`,
  );
});
