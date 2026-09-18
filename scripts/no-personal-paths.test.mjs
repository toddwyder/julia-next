import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

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
const PERSONAL_PATH = /C:\\Users\\[A-Za-z0-9_.-]+/;
const SCRIPTS_DIR = path.join(import.meta.dirname, '.');

test('no script under scripts/ hardcodes a personal-machine path (C:\\Users\\<name>)', () => {
  const offenders = [];
  for (const name of readdirSync(SCRIPTS_DIR)) {
    if (!name.endsWith('.mjs') || name.endsWith('.test.mjs')) continue;
    const contents = readFileSync(path.join(SCRIPTS_DIR, name), 'utf8');
    if (PERSONAL_PATH.test(contents)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], `hardcoded personal-machine path found in: ${offenders.join(', ')} -- require the value from an env var instead, with an actionable error if unset`);
});
