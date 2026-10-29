import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// On 29 October a config read at module scope crashed the build of this app, and the branch
// passed every check because CI never ran `next build` for the dashboard. This test is that
// gate, so the lint and the build both fail a pull request instead of reaching a person.

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const installed = existsSync(join(directory, 'node_modules', 'next')) && existsSync(join(directory, 'node_modules', '.bin', 'eslint'));
const missing = installed ? false : 'the dashboard has no node_modules, so run `npm ci` in dashboard/ first';

function run(script, timeout = 20 * 60 * 1000) {
  const state = mkdtempSync(join(tmpdir(), 'dashboard-build-test-'));
  try {
    const result = spawnSync('npm', ['run', script], {
      cwd: directory,
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
        DASHBOARD_STATE_DIR: state,
        NEXT_TELEMETRY_DISABLED: '1',
      },
      encoding: 'utf8',
      timeout,
    });
    if (result.error) throw result.error;
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
}

function reported(name, { status, output }) {
  const lines = output.split('\n');
  return `${name} exited ${status}:\n${lines.slice(-40).join('\n')}`;
}

test('the dashboard passes its own lint', { skip: missing }, () => {
  const answer = run('lint');
  assert.equal(answer.status, 0, reported('npm run lint', answer));
});

test('the dashboard builds', { skip: missing }, () => {
  const answer = run('build');
  assert.equal(answer.status, 0, reported('npm run build', answer));
  assert.match(answer.output, /Compiled successfully|✓ Compiled/, 'the build said it compiled');
});
