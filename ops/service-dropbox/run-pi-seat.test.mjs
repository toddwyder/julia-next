import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildPiSpawnSpec, SEATS } from './run-pi-seat.mjs';

test('builder-backup spawns pi with DEEPSEEK_API_KEY in env, never in argv', () => {
  const spec = buildPiSpawnSpec('builder-backup', 'do the thing', {
    mode: 'json',
    readSecretImpl: (field) => {
      assert.equal(field, 'deepseek');
      return 'super-secret-deepseek-token';
    },
  });
  assert.equal(spec.command, 'pi');
  assert.deepEqual(spec.args, ['--provider', 'deepseek', '--model', 'deepseek-v4-flash', '-p', 'do the thing', '--mode', 'json']);
  assert.equal(spec.env.DEEPSEEK_API_KEY, 'super-secret-deepseek-token');
  // The secret must never appear as its own argv entry.
  assert.ok(!spec.args.includes('super-secret-deepseek-token'));
});

test('reviewer-backup and orchestrator-backup both route to Pi + GLM-5.3 as a custom provider', () => {
  for (const seat of ['reviewer-backup', 'orchestrator-backup']) {
    const spec = buildPiSpawnSpec(seat, 'review this', {
      mode: 'rpc',
      readSecretImpl: (field) => {
        assert.equal(field, 'zai');
        return 'super-secret-zai-token';
      },
    });
    assert.deepEqual(spec.args, ['--provider', 'glm-5-3', '--model', 'glm-5.3', '-p', 'review this', '--mode', 'rpc']);
    assert.equal(spec.env.ZAI_PAYG_API_KEY, 'super-secret-zai-token');
    assert.ok(!spec.args.includes('super-secret-zai-token'));
  }
});

test('builder-backup and reviewer-backup never share a model family (family-check precondition)', () => {
  assert.notEqual(SEATS['builder-backup'].secretField, SEATS['reviewer-backup'].secretField);
});

test('buildPiSpawnSpec refuses an unknown seat', () => {
  assert.throws(() => buildPiSpawnSpec('made-up-seat', 'x'), /unknown seat/);
});

test('run-pi-seat.mjs never uses exec or shell:true -- spawn with an argv array only', () => {
  const path = new URL('./run-pi-seat.mjs', import.meta.url);
  const text = readFileSync(path, 'utf8');
  assert.doesNotMatch(text, /\bexecFile\b|\bexec\(/, 'run-pi-seat.mjs must never shell out via exec/execFile');
  assert.doesNotMatch(text, /shell:\s*true/, 'run-pi-seat.mjs must never spawn with shell:true');
});
