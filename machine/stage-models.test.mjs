import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { stageModels } from '../dashboard/lib/model-settings.js';

const root = fileURLToPath(new URL('..', import.meta.url));

// Every program and README under machine/ that is not a test. A built-in model in any of
// them would answer for Todd instead of the pick he saved.
function machineFiles(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : machineFiles(relative);
    return /\.mjs$/.test(entry.name) && !/\.test\.mjs$/.test(entry.name) || entry.name === 'README.md' ? [relative] : [];
  });
}

test('no machine stage carries a built-in model default', () => {
  const findings = [];
  for (const relative of machineFiles('machine')) {
    const lines = readFileSync(join(root, relative), 'utf8').split('\n');
    for (const [index, line] of lines.entries()) {
      if (/commandcode\/reflection\/beam|FREE_MODEL|\bBeam\b/.test(line)) {
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

test('a stage asked for alone names only itself when its own pick is missing', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'picks-')), 'picks.md');
  writeFileSync(file, 'Shipping: openai/gpt-6.1-sol\nRemediation: openai/gpt-6.1-sol\n');
  assert.deepEqual(stageModels(file, ['shipping']), { shipping: 'openai/gpt-6.1-sol' });
  assert.throws(() => stageModels(file, ['retro']), /Missing Retro pick/);
  assert.throws(() => stageModels(file), /Missing Retro pick/);
});
