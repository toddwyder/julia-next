import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import {
  buildAgySpawnSpec, runAgySeat, parseAgyJsonResult, superviseAgySeat,
  readAllStdin, parseAgyArgs, normalizeEffort, EFFORT_LEVELS, DEFAULT_EFFORT,
} from './run-agy-seat.mjs';

function fakeAgyChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

function collectWriters() {
  let stdout = '';
  let stderr = '';
  return {
    stdout: { write: (chunk) => { stdout += chunk.toString(); } },
    stderr: { write: (chunk) => { stderr += chunk.toString(); } },
    get stdoutText() { return stdout; },
    get stderrText() { return stderr; },
  };
}

test('buildAgySpawnSpec: a headless turn, --print last and immediately followed by the prompt', () => {
  const spec = buildAgySpawnSpec('do the thing');
  assert.equal(spec.command, 'agy');
  assert.deepEqual(spec.args, [
    '--output-format', 'json',
    '--print-timeout', '0',
    '--dangerously-skip-permissions',
    '--effort', 'medium',
    '--print', 'do the thing',
  ]);
  assert.equal(spec.args[spec.args.length - 2], '--print');
  assert.equal(spec.args[spec.args.length - 1], 'do the thing');
});

// Live-reproduced 2026-09-22: `--print` followed by another flag swallows
// that flag's text as the prompt instead ("agy --print took --output-format
// as its prompt"). --print must always be the last flag.
test('--print is always the last flag in the argv array, whatever effort or model is passed', () => {
  for (const effort of [...EFFORT_LEVELS, undefined, 'not-a-level']) {
    for (const model of [undefined, 'gemini-3.8-flash-high']) {
      const spec = buildAgySpawnSpec('p', { effort, model });
      const at = spec.args.indexOf('--print');
      assert.equal(at, spec.args.length - 2, `effort=${effort} model=${model}`);
      assert.equal(spec.args[at + 1], 'p');
    }
  }
});

test('a prompt starting with dashes is passed through unchanged', () => {
  const prompt = ['---', 'name: example', '---', '# Example'].join('\n');
  const spec = buildAgySpawnSpec(prompt);
  assert.equal(spec.args[spec.args.length - 1], prompt);
});

test('effort maps straight through to --effort, defaulting an omitted or unrecognized level to Medium', () => {
  assert.equal(normalizeEffort('low'), 'low');
  assert.equal(normalizeEffort('high'), 'high');
  assert.equal(normalizeEffort(undefined), DEFAULT_EFFORT);
  assert.equal(normalizeEffort('turbo'), DEFAULT_EFFORT);
  for (const effort of EFFORT_LEVELS) {
    const spec = buildAgySpawnSpec('p', { effort });
    const at = spec.args.indexOf('--effort');
    assert.equal(spec.args[at + 1], effort);
  }
});

test('a model, when given, is passed as --model before --print', () => {
  const spec = buildAgySpawnSpec('p', { model: 'gemini-3.8-flash-high' });
  assert.deepEqual(spec.args.slice(-4), ['--model', 'gemini-3.8-flash-high', '--print', 'p']);
});

test('cwd, when given, becomes the spawn option -- not an argv entry', () => {
  const spec = buildAgySpawnSpec('p', { cwd: '/home/runner/orca/workspaces/julia-next/jul98-step-6g' });
  assert.deepEqual(spec.options, { cwd: '/home/runner/orca/workspaces/julia-next/jul98-step-6g' });
  assert.ok(!spec.args.includes('/home/runner/orca/workspaces/julia-next/jul98-step-6g'));
});

test('runAgySeat forwards effort/model/cwd through to the spawn call', () => {
  const seen = {};
  const child = runAgySeat('p', {
    effort: 'high',
    model: 'gemini-3.8-flash-high',
    cwd: '/wt',
    spawnOpts: { stdio: ['ignore', 'ignore', 'ignore'] },
    spawnImpl: (command, args, opts) => {
      seen.command = command;
      seen.args = args;
      seen.opts = opts;
      return { on() {} };
    },
  });
  assert.ok(child);
  assert.equal(seen.command, 'agy');
  assert.deepEqual(seen.args, [
    '--output-format', 'json', '--print-timeout', '0', '--dangerously-skip-permissions',
    '--effort', 'high', '--model', 'gemini-3.8-flash-high', '--print', 'p',
  ]);
  assert.equal(seen.opts.cwd, '/wt');
  assert.deepEqual(seen.opts.stdio, ['ignore', 'ignore', 'ignore']);
});

test('parseAgyArgs: an optional --effort and --model, both spellings, defaulting effort to medium', () => {
  assert.deepEqual(parseAgyArgs([]), { effort: 'medium', model: undefined });
  assert.deepEqual(parseAgyArgs(['--effort', 'low']), { effort: 'low', model: undefined });
  assert.deepEqual(parseAgyArgs(['--effort=high']), { effort: 'high', model: undefined });
  assert.deepEqual(parseAgyArgs(['--model', 'gemini-3.8-flash-high']), { effort: 'medium', model: 'gemini-3.8-flash-high' });
  assert.deepEqual(parseAgyArgs(['--model=gemini-3.8-flash-high', '--effort=low']), { effort: 'low', model: 'gemini-3.8-flash-high' });
  assert.throws(() => parseAgyArgs(['--wat']), /unknown argument: --wat/);
});

test('readAllStdin reads the whole piped prompt (fd 0)', () => {
  const text = readAllStdin({ readFileSyncImpl: (fd, enc) => { assert.equal(fd, 0); assert.equal(enc, 'utf8'); return 'the brief\n'; } });
  assert.equal(text, 'the brief\n');
});

test('run-agy-seat.mjs never uses exec or shell:true -- spawn with an argv array only', () => {
  const path = new URL('./run-agy-seat.mjs', import.meta.url);
  const text = readFileSync(path, 'utf8');
  assert.doesNotMatch(text, /\bexecFile\b|\bexec\(/, 'run-agy-seat.mjs must never shell out via exec/execFile');
  assert.doesNotMatch(text, /shell:\s*true/, 'run-agy-seat.mjs must never spawn with shell:true');
});

// Live-shaped fixture: the real one-shot JSON object `agy --output-format
// json --print` printed on 2026-09-22 (conversation id/duration redacted).
const LIVE_SUCCESS_SHAPE = {
  conversation_id: 'da2b854a-83f6-4324-990f-0b322a36ab71',
  status: 'SUCCESS',
  response: 'ARGV-ARRAY-OK\n',
  duration_seconds: 1.784743803,
  num_turns: 1,
  usage: { input_tokens: 11871, output_tokens: 47, thinking_tokens: 41, cache_read_tokens: 0, total_tokens: 11918 },
};

test('parseAgyJsonResult: a real successful result carries real token usage -- the adopt route never had this', () => {
  const result = parseAgyJsonResult(JSON.stringify(LIVE_SUCCESS_SHAPE));
  assert.equal(result.ok, true);
  assert.equal(result.errorText, null);
  assert.deepEqual(result.usage, LIVE_SUCCESS_SHAPE.usage);
  assert.equal(result.response, 'ARGV-ARRAY-OK\n');
});

test('parseAgyJsonResult: a non-SUCCESS status is a failure carrying whatever reason agy gave', () => {
  const result = parseAgyJsonResult(JSON.stringify({ status: 'ERROR', error: 'rate limited' }));
  assert.equal(result.ok, false);
  assert.match(result.errorText, /rate limited/);
});

test('parseAgyJsonResult: unparseable output is a failure, never a silent pass', () => {
  const result = parseAgyJsonResult('not json at all');
  assert.equal(result.ok, false);
  assert.match(result.errorText, /parseable JSON/);
});

test('superviseAgySeat: a successful turn exits 0, prints nothing to stderr, tees stdout through', async () => {
  const child = fakeAgyChild();
  const out = collectWriters();
  const done = superviseAgySeat(child, out);
  child.stdout.end(JSON.stringify(LIVE_SUCCESS_SHAPE));
  child.emit('close', 0);
  const code = await done;
  assert.equal(code, 0);
  assert.equal(out.stderrText, '');
  assert.match(out.stdoutText, /ARGV-ARRAY-OK/);
});

test('superviseAgySeat: a non-SUCCESS result exits non-zero and prints the reason to stderr', async () => {
  const child = fakeAgyChild();
  const out = collectWriters();
  const done = superviseAgySeat(child, out);
  child.stdout.end(JSON.stringify({ status: 'ERROR', error: 'agent_readiness would have hidden this' }));
  child.emit('close', 0);
  const code = await done;
  assert.equal(code, 1);
  assert.match(out.stderrText, /agent_readiness would have hidden this/);
});
