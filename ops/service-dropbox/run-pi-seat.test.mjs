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

test('reviewer-backup routes to Pi + DeepSeek Pro through Command Code, secret in env only (JUL-98, 15:01:54Z Decision)', () => {
  const spec = buildPiSpawnSpec('reviewer-backup', 'review this', {
    mode: 'rpc',
    readSecretImpl: (field) => {
      assert.equal(field, 'commandcode');
      return 'super-secret-commandcode-token';
    },
  });
  assert.equal(spec.command, 'pi');
  assert.deepEqual(spec.args, ['--provider', 'commandcode', '--model', 'deepseek/deepseek-v4-pro', '--thinking', 'medium', '-p', '--mode', 'rpc', '--', 'review this']);
  assert.equal(spec.env.COMMANDCODE_API_KEY, 'super-secret-commandcode-token');
  // Never argv, never a shell string.
  assert.ok(!spec.args.some((arg) => arg.includes('super-secret-commandcode-token')));
});

test('reviewer-shadow-flash routes to Pi + DeepSeek Flash through Command Code, same secret field as reviewer-backup (JUL-98, 13:43Z + 15:01:54Z Decisions)', () => {
  const spec = buildPiSpawnSpec('reviewer-shadow-flash', 'review this', {
    mode: 'rpc',
    readSecretImpl: (field) => {
      assert.equal(field, 'commandcode');
      return 'super-secret-commandcode-token';
    },
  });
  assert.equal(spec.command, 'pi');
  assert.deepEqual(spec.args, ['--provider', 'commandcode', '--model', 'deepseek/deepseek-v4-flash', '--thinking', 'medium', '-p', '--mode', 'rpc', '--', 'review this']);
  assert.equal(spec.env.COMMANDCODE_API_KEY, 'super-secret-commandcode-token');
  assert.ok(!spec.args.some((arg) => arg.includes('super-secret-commandcode-token')));
});

// The two model ids reviewer-backup/reviewer-shadow-flash pass to `pi
// --model` must be exactly the ids the committed models.json fragment
// declares (installed at runner's ~/.pi/agent/models.json, README.md) --
// otherwise Pi has a provider entry with no matching model, or a launch
// asks for a model Pi was never told about. Both fail the same way: a 400
// `unsupported_model` no test in this file would otherwise catch.
test('the committed Command Code models.json fragment declares exactly the model ids reviewer-backup and reviewer-shadow-flash actually launch', () => {
  const fragment = JSON.parse(readFileSync(new URL('./pi-models.commandcode.json', import.meta.url), 'utf8'));
  const declaredIds = fragment.providers.commandcode.models.map((m) => m.id).sort();
  const launchedIds = ['reviewer-backup', 'reviewer-shadow-flash']
    .map((seat) => SEATS[seat].piArgs('json')[SEATS[seat].piArgs('json').indexOf('--model') + 1])
    .sort();
  assert.deepEqual(declaredIds, launchedIds);
  assert.equal(fragment.providers.commandcode.baseUrl, 'https://api.commandcode.ai/provider/v1');
  assert.equal(fragment.providers.commandcode.apiKey, '$COMMANDCODE_API_KEY', 'a literal secret must never be committed here');
});

// JUL-98 step 8 (23 Sep): with no `maxTokens` here, Pi capped every Command
// Code reply at its own 16,384-token default, and a high-effort DeepSeek review
// spent the whole budget thinking and stopped at `length` with no verdict (twice,
// on a real review). The limits are the models' own, as Pi's built-in DeepSeek
// registry declares them (graph/fixtures/orca-1.4.205/pi-registry.deepseek.json).
// Effort stays high; the seat's time limit and cost line are the guards.
test('the Command Code models declare the models\' own output and context limits, not Pi\'s 16,384-token default', () => {
  const fragment = JSON.parse(readFileSync(new URL('./pi-models.commandcode.json', import.meta.url), 'utf8'));
  const registry = JSON.parse(readFileSync(new URL('../../graph/fixtures/orca-1.4.205/pi-registry.deepseek.json', import.meta.url), 'utf8'));
  for (const model of fragment.providers.commandcode.models) {
    const native = registry.models[model.id.replace(/^deepseek\//, '')];
    assert.ok(native, `${model.id} has a native registry entry to take its limits from`);
    assert.equal(model.maxTokens, native.maxTokens, `${model.id} output limit`);
    assert.equal(model.contextWindow, native.contextWindow, `${model.id} context window`);
  }
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

test('the one-shot launch carries the seat\'s provider, model, thinking, json mode and the prompt last', () => {
  const spec = buildPiSpawnSpec('builder-backup', 'do the thing', { effort: 'low', readSecretImpl: () => 'SECRET' });
  assert.deepEqual(spec.args, ['--provider', 'deepseek', '--model', 'deepseek-v4-flash', '--thinking', 'off', '-p', '--mode', 'json', '--', 'do the thing']);
});

test('a seat with no --effort runs at the default effort, and --interactive is no longer an argument', () => {
  assert.deepEqual(parseSeatArgs(['reviewer-backup']), { seat: 'reviewer-backup', effort: DEFAULT_EFFORT });
  assert.throws(() => parseSeatArgs(['reviewer-backup', '--interactive']), /unknown argument: --interactive/);
});
