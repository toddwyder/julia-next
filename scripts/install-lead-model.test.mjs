import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { installLeadModel } from './install-lead-model.mjs';

test('installing the Lead setting twice keeps an existing model', t => {
  const dir = mkdtempSync(join(tmpdir(), 'install-lead-model-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'lead-model');

  assert.equal(installLeadModel(file).created, true);
  assert.equal(readFileSync(file, 'utf8'), 'openai/gpt-6.1-sol\n');

  const { created } = installLeadModel(file);
  assert.equal(created, false);
  assert.equal(readFileSync(file, 'utf8'), 'openai/gpt-6.1-sol\n', 'a second install leaves the setting alone');
});
