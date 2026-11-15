import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  ...ROLE_GROUPS.flatMap(group => group.roles.map(role => `${role.name}: commandcode/deepseek/deepseek-v4.1-flash`)),
  '',
].join('\n');

function setupEnvironment(t) {
  const root = mkdtempSync(join(tmpdir(), 'studio-card-path-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const flowDir = join(root, 'flow');
  const repo = join(root, 'repo');
  const juliaConfig = join(home, '.config', 'julia');
  mkdirSync(juliaConfig, { recursive: true });
  mkdirSync(flowDir, { recursive: true });
  mkdirSync(join(repo, '.agents', 'skills', 'poteto-mode'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'skills', 'poteto-mode', 'SKILL.md'), '# poteto\n');
  execFileSync('git', ['init', '-b', 'main', repo]);
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', join(root, 'missing-origin.git')]);
  writeFileSync(join(juliaConfig, 'lead-model'), 'commandcode/deepseek/deepseek-v4.1-flash\n');
  writeFileSync(join(juliaConfig, 'lead-role-models.md'), ROLE_FILE_TEXT);

  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    FLOW_DIR: flowDir,
    FLOW_REPO: repo,
  };
  delete env.JULIA_LEAD_MODEL_FILE;
  delete env.JULIA_LEAD_ROLE_MODELS_FILE;
  delete env.FLOW_CARD;

  return { flowDir, env };
}

test('Studio card-path starts a run from the run form and stops cleanly when origin main cannot be fetched', t => {
  const { env, flowDir } = setupEnvironment(t);
  const childScript = `
    import assert from 'node:assert/strict';
    import { mastra } from ${JSON.stringify(indexUrl)};
    import { closeGraphify } from ${JSON.stringify(graphifyUrl)};

    try {
      const workflow = mastra.getWorkflow('card-path');
      const run = await workflow.createRun();
      const result = await run.start({ inputData: { card: 'JUL-363-TEST', kind: 'machine' } });
      assert.equal(result.status, 'success');
      assert.equal(result.steps.start.status, 'success');
      assert.equal(result.steps.attempt.output.stopped, true);
    } finally {
      await mastra.shutdown();
      await mastra.getStorage()?.close();
      await closeGraphify();
    }
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], { cwd: repoRoot, env, encoding: 'utf8' });
  assert.equal(child.status, 0, `child exited ${child.status}\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`);

  const report = readFileSync(join(flowDir, 'JUL-363-TEST', 'reports', 'JUL-363-TEST.md'), 'utf8');
  assert.match(report, /Part: start-build/);
  assert.match(report, /Failed to fetch latest main from origin/);
});
