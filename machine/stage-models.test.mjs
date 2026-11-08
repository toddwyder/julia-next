import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { stageModels } from '../dashboard/lib/model-settings.js';

const root = fileURLToPath(new URL('..', import.meta.url));

// Every program that starts or carries a machine stage that calls a model. A
// built-in model here would answer for Todd instead of the pick he saved.
const ENTRY_POINTS = [
  'machine/remediation/run.mjs',
  'machine/remediation/reviews.mjs',
  'machine/remediation/workflow.mjs',
  'machine/merge/run.mjs',
  'machine/merge/retro.mjs',
  'machine/merge/workflow.mjs',
  'machine/shipping/workflow.mjs',
  'machine/flow/agents.mjs',
  'machine/flow/schema.mjs',
];

test('no machine stage carries a built-in model default', () => {
  const findings = [];
  for (const relative of ENTRY_POINTS) {
    const lines = readFileSync(join(root, relative), 'utf8').split('\n');
    for (const [index, line] of lines.entries()) {
      if (/commandcode\/reflection\/beam:free|FREE_MODEL/.test(line)) {
        findings.push(`${relative}:${index + 1}: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(findings, []);
});

test('a missing machine stage pick stops and names the stage', () => {
  assert.throws(() => stageModels('/dev/null'), /Missing Shipping pick/);
  assert.throws(() => stageModels('/dev/null'), /\/dev\/null/);
});
