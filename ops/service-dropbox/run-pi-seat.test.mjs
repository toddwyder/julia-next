import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildPiSpawnSpec, runPiSeat, SEATS, readAllStdin, thinkingArgs, parseSeatArgs } from './run-pi-seat.mjs';

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

// JUL-79 step 3: every Pi seat now carries the ticket's Low/Medium/High effort.
// Pi has no graded setting, so Low is thinking off (no flag) and Medium/High
// are thinking on; an omitted effort is Medium. The flag is inserted before
// -p so the prompt text (which may be the whole coordinator skill) always
// stays at the end of the argv array.
test('effort -> --thinking: every seat gets the flag for Medium/High and none for Low', () => {
  for (const seat of Object.keys(SEATS)) {
    const low = buildPiSpawnSpec(seat, 'p', { effort: 'low', readSecretImpl: () => 'tok' });
    assert.ok(!low.args.includes('--thinking'), `${seat}/low must not think`);
    for (const level of ['medium', 'high']) {
      const spec = buildPiSpawnSpec(seat, 'p', { effort: level, readSecretImpl: () => 'tok' });
      assert.ok(spec.args.includes('--thinking'), `${seat}/${level} must think`);
      assert.equal(spec.args.indexOf('--thinking'), spec.args.indexOf('-p') - 1, `${seat}/${level} places the flag before -p`);
    }
  }
});

test('an omitted effort is Medium: the spawn spec is exactly the explicit-medium one', () => {
  for (const seat of Object.keys(SEATS)) {
    const omitted = buildPiSpawnSpec(seat, 'p', { readSecretImpl: () => 'tok' });
    const medium = buildPiSpawnSpec(seat, 'p', { effort: 'medium', readSecretImpl: () => 'tok' });
    assert.deepEqual(omitted.args, medium.args, `${seat} default`);
  }
});

test('thinkingArgs: the pure mapping, including an unknown effort falling back to Medium', () => {
  assert.deepEqual(thinkingArgs('low'), []);
  assert.deepEqual(thinkingArgs('medium'), ['--thinking']);
  assert.deepEqual(thinkingArgs('high'), ['--thinking']);
  assert.deepEqual(thinkingArgs(undefined), ['--thinking']);
  assert.deepEqual(thinkingArgs('turbo'), ['--thinking']);
});

test('orchestrator-deepseek: DeepSeek provider/model, DEEPSEEK_API_KEY in env only, thinking per effort', () => {
  const spec = buildPiSpawnSpec('orchestrator-deepseek', 'run the graph', {
    mode: 'json',
    effort: 'high',
    readSecretImpl: (field) => {
      assert.equal(field, 'deepseek');
      return 'super-secret-deepseek-token';
    },
  });
  assert.deepEqual(spec.args, ['--provider', 'deepseek', '--model', 'deepseek-v4-flash', '--thinking', '-p', 'run the graph', '--mode', 'json']);
  assert.equal(spec.env.DEEPSEEK_API_KEY, 'super-secret-deepseek-token');
  assert.ok(!spec.args.includes('super-secret-deepseek-token'));
});

test('runPiSeat forwards the effort through to the spawn spec (no separate path for a dispatched worker)', () => {
  const seen = {};
  const child = runPiSeat('builder-backup', 'p', {
    effort: 'high',
    readSecretImpl: () => 'tok',
    spawnOpts: { stdio: ['ignore', 'ignore', 'ignore'] },
    spawnImpl: (command, args, opts) => {
      seen.command = command;
      seen.args = args;
      seen.env = opts.env;
      return { on() {} };
    },
  });
  assert.ok(child);
  assert.equal(seen.command, 'pi');
  assert.deepEqual(seen.args, ['--provider', 'deepseek', '--model', 'deepseek-v4-flash', '--thinking', '-p', 'p', '--mode', 'json']);
  assert.equal(seen.env.DEEPSEEK_API_KEY, 'tok');
});

test('parseSeatArgs: seat plus an optional --effort (both spellings), defaulting to medium', () => {
  assert.deepEqual(parseSeatArgs(['orchestrator-deepseek']), { seat: 'orchestrator-deepseek', effort: 'medium' });
  assert.deepEqual(parseSeatArgs(['builder-backup', '--effort', 'low']), { seat: 'builder-backup', effort: 'low' });
  assert.deepEqual(parseSeatArgs(['builder-backup', '--effort=high']), { seat: 'builder-backup', effort: 'high' });
  assert.throws(() => parseSeatArgs(['builder-backup', '--wat']), /unknown argument: --wat/);
});

test('readAllStdin reads the whole piped prompt (fd 0), for the CLI entry launched from a shell pipe', () => {
  const text = readAllStdin({ readFileSyncImpl: (fd, enc) => { assert.equal(fd, 0); assert.equal(enc, 'utf8'); return 'the coordinator skill text\n\nIssue: JUL-63\n'; } });
  assert.equal(text, 'the coordinator skill text\n\nIssue: JUL-63\n');
});

test('run-pi-seat.mjs never uses exec or shell:true -- spawn with an argv array only', () => {
  const path = new URL('./run-pi-seat.mjs', import.meta.url);
  const text = readFileSync(path, 'utf8');
  assert.doesNotMatch(text, /\bexecFile\b|\bexec\(/, 'run-pi-seat.mjs must never shell out via exec/execFile');
  assert.doesNotMatch(text, /shell:\s*true/, 'run-pi-seat.mjs must never spawn with shell:true');
});
