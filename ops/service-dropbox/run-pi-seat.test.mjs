import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import {
  buildPiSpawnSpec, runPiSeat, SEATS, readAllStdin, thinkingArgs, parseSeatArgs,
  parsePiJsonStream, supervisePiSeat,
} from './run-pi-seat.mjs';
import { DEFAULT_EFFORT } from '../../scripts/effort.mjs';

// A stand-in for a spawned `pi` process: an EventEmitter with pipe-able
// stdout/stderr, so the JSON-stream detection can be exercised without a
// live vendor call.
function fakePiChild() {
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

test('builder-backup spawns pi with DEEPSEEK_API_KEY in env, never in argv', () => {
  const spec = buildPiSpawnSpec('builder-backup', 'do the thing', {
    mode: 'json',
    readSecretImpl: (field) => {
      assert.equal(field, 'deepseek');
      return 'super-secret-deepseek-token';
    },
  });
  assert.equal(spec.command, 'pi');
  // Medium effort (the default) -> --thinking; see the effort tests below.
  assert.deepEqual(spec.args, ['--provider', 'deepseek', '--model', 'deepseek-v4-flash', '--thinking', 'medium', '-p', '--mode', 'json', '--', 'do the thing']);
  assert.equal(spec.env.DEEPSEEK_API_KEY, 'super-secret-deepseek-token');
  // The secret must never appear as its own argv entry.
  assert.ok(!spec.args.includes('super-secret-deepseek-token'));
});

test('reviewer-backup routes to Pi + DeepSeek Pro on the native provider, secret in env only (JUL-89)', () => {
  const spec = buildPiSpawnSpec('reviewer-backup', 'review this', {
    mode: 'rpc',
    readSecretImpl: (field) => {
      assert.equal(field, 'deepseek');
      return 'super-secret-deepseek-token';
    },
  });
  assert.equal(spec.command, 'pi');
  assert.deepEqual(spec.args, ['--provider', 'deepseek', '--model', 'deepseek-v4-pro', '--thinking', 'medium', '-p', '--mode', 'rpc', '--', 'review this']);
  assert.equal(spec.env.DEEPSEEK_API_KEY, 'super-secret-deepseek-token');
  // Never argv, never a shell string.
  assert.ok(!spec.args.some((arg) => arg.includes('super-secret-deepseek-token')));
});

// The cost rule (JUL-89, finished by JUL-93): GLM is barred and removed. No seat
// of any kind launches it, and the old `orchestrator-backup` seat that did is
// gone, so a wake can never fall onto the barred vendor. A seat name that no
// longer exists is refused, not defaulted.
test('no seat launches GLM, and the old GLM orchestrator-backup seat is refused as unknown', () => {
  for (const [seat, def] of Object.entries(SEATS)) {
    assert.ok(!def.piArgs('json').includes('glm-5-3'), `${seat} must not use the GLM provider`);
    assert.notEqual(def.secretField, 'zai', `${seat} must not read the Z.ai secret`);
    assert.notEqual(def.envVar, 'ZAI_PAYG_API_KEY', `${seat} must not use the Z.ai key variable`);
  }
  assert.ok(!Object.hasOwn(SEATS, 'orchestrator-backup'));
  assert.throws(() => buildPiSpawnSpec('orchestrator-backup', 'wake up'), /unknown seat/);
});

test('buildPiSpawnSpec refuses an unknown seat', () => {
  assert.throws(() => buildPiSpawnSpec('made-up-seat', 'x'), /unknown seat/);
});

// JUL-79 step 3: every Pi seat now carries the ticket's Low/Medium/High effort.
// Pi has no graded setting, so Low is thinking off (no flag) and Medium/High
// are thinking on; an omitted effort is Medium. The flag is inserted before
// -p so the prompt text (which may be the whole coordinator skill) always
// stays at the end of the argv array.
test('effort -> --thinking <level>: Low is off, Medium/High are on, and the flag always carries its value', () => {
  const want = { low: 'off', medium: 'medium', high: 'high' };
  for (const seat of Object.keys(SEATS)) {
    for (const [effort, level] of Object.entries(want)) {
      const spec = buildPiSpawnSpec(seat, 'p', { effort, readSecretImpl: () => 'tok' });
      const at = spec.args.indexOf('--thinking');
      assert.ok(at !== -1, `${seat}/${effort} must pass --thinking`);
      assert.equal(spec.args[at + 1], level, `${seat}/${effort}: --thinking needs its level, or Pi swallows the next flag`);
      assert.equal(spec.args[at + 2], '-p', `${seat}/${effort} places the pair right before -p`);
    }
  }
});

// The live failure (JUL-79 relaunches): a bare `--thinking` made Pi read `-p`
// as the thinking level, so the coordinator prompt -- which begins with the
// skill's `---` front matter -- was parsed as an unknown option and the seat
// died before doing anything. The prompt now follows a `--` separator.
test('a prompt that starts with dashes (the coordinator skill front matter) is the last argv entry, after `--`', () => {
  const prompt = ['---', 'name: julia-coordinator', '---', '# Julia-next coordinator'].join('\n');
  for (const seat of Object.keys(SEATS)) {
    for (const effort of ['low', 'medium', 'high']) {
      const spec = buildPiSpawnSpec(seat, prompt, { effort, readSecretImpl: () => 'tok' });
      assert.equal(spec.args[spec.args.length - 1], prompt, `${seat}/${effort}: prompt is last`);
      assert.equal(spec.args[spec.args.length - 2], '--', `${seat}/${effort}: separator before the prompt`);
      assert.equal(spec.args.filter((arg) => arg === prompt).length, 1);
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
  assert.deepEqual(thinkingArgs('low'), ['--thinking', 'off']);
  assert.deepEqual(thinkingArgs('medium'), ['--thinking', 'medium']);
  assert.deepEqual(thinkingArgs('high'), ['--thinking', 'high']);
  assert.deepEqual(thinkingArgs(undefined), ['--thinking', 'medium']);
  assert.deepEqual(thinkingArgs('turbo'), ['--thinking', 'medium']);
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
  assert.deepEqual(spec.args, ['--provider', 'deepseek', '--model', 'deepseek-v4-flash', '--thinking', 'high', '-p', '--mode', 'json', '--', 'run the graph']);
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
  assert.deepEqual(seen.args, ['--provider', 'deepseek', '--model', 'deepseek-v4-flash', '--thinking', 'high', '-p', '--mode', 'json', '--', 'p']);
  assert.equal(seen.env.DEEPSEEK_API_KEY, 'tok');
});

test('parseSeatArgs: seat plus an optional --effort (both spellings), defaulting to medium', () => {
  assert.deepEqual(parseSeatArgs(['orchestrator-deepseek']), { seat: 'orchestrator-deepseek', effort: 'medium', interactive: false });
  assert.deepEqual(parseSeatArgs(['builder-backup', '--effort', 'low']), { seat: 'builder-backup', effort: 'low', interactive: false });
  assert.deepEqual(parseSeatArgs(['builder-backup', '--effort=high']), { seat: 'builder-backup', effort: 'high', interactive: false });
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

test('parsePiJsonStream: a normal successful turn has no vendor error', () => {
  const stream = [
    '{"type":"session","version":3,"id":"abc"}',
    '{"type":"agent_start"}',
    '{"type":"message_start","message":{"role":"assistant","content":[],"stopReason":"pending"}}',
    '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"stopReason":"stop"}}',
    '{"type":"agent_end","messages":[{"role":"assistant","stopReason":"stop"}],"willRetry":false}',
    '{"type":"agent_settled"}',
  ].join('\n');
  assert.deepEqual(parsePiJsonStream(stream), { ok: true, errorText: null });
});

test('parsePiJsonStream: the live Z.ai 429 insufficiency error is a vendor error carrying its text', () => {
  const vendor = '429 {"code":"1113","message":"Insufficient balance or no resource package. Please recharge."}';
  const stream = [
    '{"type":"session","version":3,"id":"abc"}',
    `{"type":"message_start","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":${JSON.stringify(vendor)}}}`,
    `{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":${JSON.stringify(vendor)}}}`,
    `{"type":"turn_end","message":{"role":"assistant","stopReason":"error","errorMessage":${JSON.stringify(vendor)}},"toolResults":[]}`,
    '{"type":"agent_settled"}',
  ].join('\n');
  const result = parsePiJsonStream(stream);
  assert.equal(result.ok, false);
  assert.match(result.errorText, /Insufficient balance or no resource package/);
});

test('parsePiJsonStream: a transient error followed by a successful turn is NOT a failure', () => {
  const stream = [
    '{"type":"message_end","message":{"role":"assistant","stopReason":"error","errorMessage":"429 rate limited"}}',
    '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"ok"}],"stopReason":"stop"}}',
    '{"type":"agent_settled"}',
  ].join('\n');
  assert.deepEqual(parsePiJsonStream(stream), { ok: true, errorText: null });
});

test('parsePiJsonStream: plain, non-JSON output never invents a vendor error', () => {
  assert.deepEqual(parsePiJsonStream('hello there\nnot json at all\n'), { ok: true, errorText: null });
  assert.deepEqual(parsePiJsonStream(''), { ok: true, errorText: null });
});

test('supervisePiSeat: a turn that ends in a vendor error exits non-zero and prints the error to stderr', async () => {
  const child = fakePiChild();
  const out = collectWriters();
  const done = supervisePiSeat(child, out);
  const vendor = '429 {"code":"1113","message":"Insufficient balance or no resource package. Please recharge."}';
  child.stdout.end(`{"type":"message_end","message":{"role":"assistant","stopReason":"error","errorMessage":${JSON.stringify(vendor)}}}\n{"type":"agent_settled"}\n`);
  child.emit('close', 0);
  const code = await done;
  assert.equal(code, 1);
  assert.match(out.stderrText, /Insufficient balance or no resource package/);
});

test('supervisePiSeat: a normal successful turn exits 0 and prints nothing to stderr', async () => {
  const child = fakePiChild();
  const out = collectWriters();
  const done = supervisePiSeat(child, out);
  child.stdout.end('{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"ok"}],"stopReason":"stop"}}\n{"type":"agent_settled"}\n');
  child.emit('close', 0);
  const code = await done;
  assert.equal(code, 0);
  assert.equal(out.stderrText, '');
  assert.match(out.stdoutText, /agent_settled/);
});

// ---------------------------------------------------------------------------
// JUL-98 step 6: the INTERACTIVE launch, for the start-then-adopt route.
//
// `-p --mode json` is a one-shot with no worker contract, so a Pi seat started
// that way cannot report to the mailbox at all (JUL-109 findings, section 4).
// The route that CAN report starts Pi interactively and lets Orca adopt the
// terminal -- so this file, which is the one place that knows how a Pi seat
// authenticates, gains that launch rather than a second launcher being written
// beside it.
// ---------------------------------------------------------------------------

test('the interactive launch drops -p and the json mode, and keeps the seat\'s provider, model, thinking and secret', () => {
  const spec = buildPiSpawnSpec('reviewer-backup', null, { interactive: true, effort: 'high', readSecretImpl: () => 'SECRET' });
  assert.equal(spec.command, 'pi');
  assert.deepEqual(spec.args, ['--provider', 'deepseek', '--model', 'deepseek-v4-pro', '--thinking', 'high']);
  assert.ok(!spec.args.includes('-p'), 'a one-shot cannot report to the mailbox');
  assert.ok(!spec.args.includes('--mode'));
  assert.ok(!spec.args.includes('--'), 'there is no prompt: Orca types the brief in when it adopts the terminal');
  assert.equal(spec.env.DEEPSEEK_API_KEY, 'SECRET', 'the secret still reaches the child, and only the child');
});

test('the one-shot launch is unchanged by the interactive one', () => {
  const spec = buildPiSpawnSpec('builder-backup', 'do the thing', { effort: 'low', readSecretImpl: () => 'SECRET' });
  assert.deepEqual(spec.args, ['--provider', 'deepseek', '--model', 'deepseek-v4-flash', '--thinking', 'off', '-p', '--mode', 'json', '--', 'do the thing']);
});

test('--interactive is a recognized argument, and is off by default', () => {
  assert.deepEqual(parseSeatArgs(['reviewer-backup', '--interactive', '--effort', 'high']), { seat: 'reviewer-backup', effort: 'high', interactive: true });
  assert.deepEqual(parseSeatArgs(['reviewer-backup']), { seat: 'reviewer-backup', effort: DEFAULT_EFFORT, interactive: false });
});
