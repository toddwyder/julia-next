import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findPersonalPaths, scanPersonalPaths, scanForPersonalPaths } from './personal-paths.mjs';

export { scanPersonalPaths, scanForPersonalPaths };

// A literal C:\Users\<name> default (e.g. a fallback for a CLI binary path)
// works on exactly one machine and fails with a raw, unactionable error
// everywhere else -- caught live on the OVH server during JUL-61's closing
// retro (scripts/orca-cli.mjs and scripts/check-readiness.mjs both defaulted
// ORCA_BIN to a personal laptop path). This can't be a CI workflow step: the
// publisher App has no `workflows` permission and can never push a change to
// .github/workflows/*, deliberately -- the machine that publishes code
// shouldn't be able to edit its own CI. A regular test in this suite runs
// under the same `node --test scripts/*.test.mjs` CI already invokes,
// without touching the workflow file at all.
const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts');
const OPS_DIR = path.join(REPO_ROOT, 'ops');

test('no script under scripts/ or ops/ hardcodes a personal-machine path (C:\\Users\\<name>)', () => {
  const offenders = scanPersonalPaths([SCRIPTS_DIR, OPS_DIR], { baseDir: REPO_ROOT });
  assert.deepEqual(offenders, [], `hardcoded personal-machine path found in: ${offenders.join(', ')} -- require the value from an env var instead, with an actionable error if unset`);
});

test('a personal path in a nested folder is caught and reported by the scan', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'personal-paths-nested-'));
  try {
    const nestedDir = path.join(dir, 'nested', 'worker-scripts');
    mkdirSync(nestedDir, { recursive: true });
    const fixturePath = path.join(nestedDir, 'fixture.mjs');
    writeFileSync(fixturePath, "export const workerPath = 'C:\\\\Users\\\\name\\\\worker.mjs';\n");

    const cleanPath = path.join(nestedDir, 'clean.mjs');
    writeFileSync(cleanPath, "export const clean = '/usr/local/bin/worker.mjs';\n");

    const testPath = path.join(nestedDir, 'fixture.test.mjs');
    writeFileSync(testPath, "export const ignoredTest = 'C:\\\\Users\\\\name\\\\test.mjs';\n");

    const offenders = scanPersonalPaths(dir);
    assert.deepEqual(offenders, ['nested/worker-scripts/fixture.mjs']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
