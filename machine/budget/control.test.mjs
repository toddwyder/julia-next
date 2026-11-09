import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createSliceControl, priceUsage } from './control.mjs';

const sol = 'openai/gpt-6.1-sol';
const beam = 'commandcode/reflection/beam:free';
const price = { input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 10,
  longInputThreshold: 272000, longInputMultiplier: 2, longOutputMultiplier: 1.5 };
const testRoot = new URL('../../.artifacts/budget-unit/', import.meta.url);
mkdirSync(testRoot, { recursive: true });
function fixture(t, options = {}) {
  const directory = mkdtempSync(join(testRoot.pathname, 'slice-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const config = { directory, dollarCap: 4, tokenCap: 2e6, ...options };
  return { control: createSliceControl(config), config, directory };
}
function span(model = sol, usage = { inputTokens: 100, outputTokens: 10 }, id = 'span-1') {
  return { type: 'model_inference', id, traceId: 'trace-1', endTime: new Date(), attributes: { model, usage } };
}
function call(control, usage, id) { control.begin({ model: sol, role: 'lead' }); return control.recordSpan(span(sol, usage, id)); }

test('Sol cache and reasoning accounting includes reasoning once', () => {
  const result = priceUsage({ inputTokens: 1000, outputTokens: 200,
    inputDetails: { cacheRead: 300, cacheWrite: 100 }, outputDetails: { reasoning: 150 } }, price);
  assert.equal(result.tokens, 1200);
  assert.equal(result.dollars, (600 * 2 + 300 * 0.1 + 100 * 2.5 + 200 * 10) / 1e6);
});
for (const inputTokens of [271999, 272000, 272001]) test(`Sol whole-call long-context boundary ${inputTokens}`, () => {
  const result = priceUsage({ inputTokens, outputTokens: 100, inputDetails: { cacheRead: 100, cacheWrite: 50 } }, price);
  const multiplier = inputTokens > 272000 ? 2 : 1;
  assert.equal(result.dollars, ((inputTokens - 150) * 2 + 100 * 0.1 + 50 * 2.5) * multiplier / 1e6
    + 100 * 10 * (inputTokens > 272000 ? 1.5 : 1) / 1e6);
  assert.equal(result.longInput, inputTokens > 272000);
});
for (const usage of [{}, { inputTokens: 1 }, { inputTokens: -1, outputTokens: 1 },
  { inputTokens: NaN, outputTokens: 1 }, { inputTokens: 1.1, outputTokens: 1 },
  { inputTokens: 1, outputTokens: Infinity }, { inputTokens: 1, outputTokens: 1, inputDetails: { cacheRead: 2 } },
  { inputTokens: 1, outputTokens: 1, inputDetails: { cacheRead: null } },
  { inputTokens: 1, outputTokens: 1, inputDetails: { cacheWrite: null } },
  { inputTokens: 1, outputTokens: 1, outputDetails: { reasoning: null } },
  { inputTokens: 1, outputTokens: 1, outputDetails: { reasoning: 2 } }]) {
  test(`invalid or absent trace usage stops: ${JSON.stringify(usage)}`, t => {
    const { control } = fixture(t); call(control, usage);
    assert.equal(control.snapshot().stop.reason, 'invalid_trace_usage');
    assert.equal(control.snapshot().exitCode, 1);
  });
}
for (const caps of [{ dollarCap: undefined }, { tokenCap: undefined }, { dollarCap: 0 },
  { dollarCap: NaN }, { tokenCap: -1 }, { tokenCap: 1.5 }]) test(`caps refused before model call: ${JSON.stringify(caps)}`, t => {
  const { control } = fixture(t, caps);
  assert.throws(() => control.begin({ model: sol, role: 'lead' }), /missing_or_invalid_caps/);
  assert.equal(control.snapshot().calls.length, 0);
  assert.ok(existsSync(control.stopPath));
});
for (const role of ['lead', 'observer', 'reflector']) test(`unpriced ${role} refused before provider`, async t => {
  const { control } = fixture(t); let invoked = false;
  const wrapped = control.wrapModel({ modelId: 'unknown', provider: 'test', async doGenerate() { invoked = true; } }, { id: 'unpriced', role });
  await assert.rejects(wrapped.doGenerate({}), /no_price/);
  assert.equal(invoked, false);
  assert.equal(control.snapshot().stop.numbers.role, role);
});
test('Beam free calls still consume tokens and are recorded', t => {
  const { control } = fixture(t);
  control.begin({ model: beam, role: 'observer' });
  control.recordSpan(span(beam));
  assert.deepEqual(control.snapshot().totals, { dollars: 0, tokens: 110 });
  assert.equal(control.snapshot().calls[0].role, 'observer');
  control.finish();
});
for (const caps of [{ tokenCap: 110 }, { tokenCap: 109 }, { dollarCap: 0.0003 }, { dollarCap: 0.00029 }]) {
  test(`crossed or reached cap latches with trace numbers: ${JSON.stringify(caps)}`, t => {
    const { control, config } = fixture(t, caps); call(control);
    assert.equal(control.snapshot().phase, 'stopped');
    assert.deepEqual(control.snapshot().stop.totals, { dollars: 0.0003, tokens: 110 });
    assert.throws(() => control.begin({ model: sol, role: 'retry' }), /slice_stopped/);
    assert.throws(() => createSliceControl(config).begin({ model: sol, role: 'fresh' }), /slice_stopped/);
    assert.equal(control.snapshot().calls.length, 1);
  });
}
test('cap record survives independent Node process relaunch', t => {
  const { control, config } = fixture(t, { tokenCap: 100 }); call(control);
  const code = `import {createSliceControl} from ${JSON.stringify(new URL('./control.mjs', import.meta.url).href)};
    try { createSliceControl(${JSON.stringify(config)}).begin({model:${JSON.stringify(sol)},role:'lead'});process.exitCode=0; }
    catch {process.exitCode=9;}`;
  assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', code]).status, 9);
});
test('clear requires attribution, records reason, and permits a new slice', t => {
  const { control, config } = fixture(t, { tokenCap: 100 }); call(control);
  assert.throws(() => control.clear({ reason: 'reviewed' }), /reason and actor/);
  control.clear({ reason: 'planted failure cleared after review', actor: 'operator' });
  assert.equal(control.signal.aborted, false);
  const next = createSliceControl(config); next.begin({ model: beam, role: 'observer' });
  next.recordSpan(span(beam, { inputTokens: 1, outputTokens: 1 })); next.finish();
  const saved = JSON.parse(readFileSync(next.recordPath, 'utf8'));
  assert.equal(saved.events.filter(e => e.kind === 'clear').length, 1);
  assert.equal(saved.slices[0].stop.reason, 'cap_reached');
});
test('a second controller cannot enter or clear a live controller lock', t => {
  const { control, config } = fixture(t); control.assertStart();
  const other = createSliceControl(config);
  assert.throws(() => other.begin({ model: sol, role: 'lead' }), /slice_locked/);
  assert.throws(() => other.clear({ reason: 'bad', actor: 'operator' }), /live process/);
  assert.equal(control.snapshot().phase, 'idle'); control.finish();
});
test('unresolved accounting blocks direct next admission and finish', t => {
  const { control } = fixture(t); control.begin({ model: sol, role: 'lead' });
  assert.throws(() => control.begin({ model: sol, role: 'lead' }), /unrecorded_call_cost/);
  assert.equal(control.snapshot().pending.model, sol);
  assert.throws(() => control.finish(), /slice_stopped/);
});
test('only completed inference spans count and duplicate exports count once', t => {
  const { control } = fixture(t); control.begin({ model: sol, role: 'lead' });
  control.recordSpan({ ...span(), endTime: undefined });
  control.recordSpan({ ...span(), type: 'model_step' });
  assert.equal(control.snapshot().calls.length, 0);
  control.recordSpan(span()); control.recordSpan(span());
  assert.equal(control.snapshot().calls.length, 1); control.finish();
});
test('wrong model and missing span identity latch before next call', t => {
  const { control } = fixture(t); control.begin({ model: sol, role: 'lead' });
  control.recordSpan(span(beam));
  assert.equal(control.snapshot().stop.reason, 'trace_model_mismatch');
});
test('an unadmitted inference fails closed', t => {
  const { control } = fixture(t); control.recordSpan(span());
  assert.equal(control.snapshot().stop.reason, 'unexpected_model_call');
});
test('wrapped concurrent calls serialize through completed trace, not provider result', async t => {
  const { control } = fixture(t); let calls = 0;
  const wrapped = control.wrapModel({ modelId: 'sol', provider: 'openai', async doGenerate() { calls++; return { value: calls }; } }, { id: sol, role: 'lead' });
  assert.deepEqual(await wrapped.doGenerate({}), { value: 1 });
  const second = wrapped.doGenerate({});
  await Promise.resolve(); assert.equal(calls, 1);
  control.recordSpan({ ...span(), attributes: { model: 'sol', provider: 'openai', usage: { inputTokens: 10, outputTokens: 1 } } });
  assert.deepEqual(await second, { value: 2 });
  control.recordSpan({ ...span(sol, undefined, 'second'), attributes: { model: 'sol', provider: 'openai', usage: { inputTokens: 10, outputTokens: 1 } } });
  assert.equal(control.snapshot().calls.length, 2); control.finish();
});
test('missing trace cost deadline stops and wakes waiting calls without invoking them', async t => {
  const { control } = fixture(t, { traceTimeoutMs: 10 }); let calls = 0;
  const wrapped = control.wrapModel({ modelId: 'sol', provider: 'openai', async doGenerate() { calls++; return {}; } }, { id: sol, role: 'lead' });
  await wrapped.doGenerate({});
  await assert.rejects(wrapped.doGenerate({}), /slice_stopped/);
  assert.equal(calls, 1); assert.equal(control.snapshot().stop.reason, 'unrecorded_call_cost');
});
test('provider errors latch without retry and later trace still records spend', async t => {
  const { control } = fixture(t); let calls = 0;
  const wrapped = control.wrapModel({ modelId: 'sol', provider: 'openai', async doGenerate() { calls++; throw new Error('sensitive provider message'); } }, { id: sol, role: 'lead' });
  await assert.rejects(wrapped.doGenerate({}));
  control.recordSpan({ ...span(), attributes: { model: 'sol', provider: 'openai', usage: { inputTokens: 10, outputTokens: 1 } } });
  assert.equal(control.snapshot().calls.length, 1);
  assert.equal(control.snapshot().phase, 'stopped');
  await assert.rejects(wrapped.doGenerate({}), /slice_stopped/);
  assert.equal(calls, 1); assert.doesNotMatch(readFileSync(control.recordPath, 'utf8'), /sensitive provider/);
});
test('stream cancellation latches and propagates cancel to provider', async t => {
  const { control } = fixture(t); let cancelled = false;
  const wrapped = control.wrapModel({ modelId: 'sol', provider: 'openai', async doStream() {
    return { stream: new ReadableStream({ cancel() { cancelled = true; } }) };
  } }, { id: sol, role: 'lead' });
  const result = await wrapped.doStream({}); await result.stream.cancel();
  assert.equal(cancelled, true); assert.equal(control.snapshot().stop.reason, 'model_stream_cancelled');
});
test('interrupted process leaves a durable stop on relaunch and explicit clear archives pending call', t => {
  const { control, config } = fixture(t);
  const code = `import {createSliceControl} from ${JSON.stringify(new URL('./control.mjs', import.meta.url).href)};
    createSliceControl(${JSON.stringify(config)}).begin({model:${JSON.stringify(sol)},role:'lead'});`;
  assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', code]).status, 0);
  const next = createSliceControl(config);
  assert.throws(() => next.assertStart(), /interrupted_slice/);
  assert.equal(next.snapshot().stop.reason, 'interrupted_slice');
  next.clear({ reason: 'interrupted worker confirmed gone', actor: 'operator' });
  assert.equal(next.snapshot().slices[0].pending.model, sol);
  control.assertStart(); control.finish();
});
test('invalid price values refuse admission and create a stop record', t => {
  const { control } = fixture(t, { prices: { [sol]: { ...price, output: -1 } } });
  assert.throws(() => control.begin({ model: sol, role: 'lead' }), /invalid_price_entry/);
  assert.equal(control.snapshot().calls.length, 0);
});
test('completed inference with unknown usage stops before another provider call', async t => {
  const { control } = fixture(t); let calls = 0;
  const wrapped = control.wrapModel({ modelId: sol, async doGenerate() { calls++; return {}; } }, { id: sol, role: 'lead' });
  await wrapped.doGenerate({}); control.recordSpan(span(sol, {}));
  await assert.rejects(wrapped.doGenerate({}), /slice_stopped/);
  assert.equal(calls, 1);
});
test('a stopped background memory call with priced late usage is still costed', t => {
  const { control } = fixture(t);
  control.begin({ model: beam, role: 'reflector' });
  control.stop('planted_memory_failure', { observed: true });
  control.recordSpan(span(beam));
  assert.equal(control.snapshot().calls[0].dollars, 0);
  assert.equal(control.snapshot().calls[0].tokens, 110);
  assert.equal(control.snapshot().stop.reason, 'planted_memory_failure');
});
test('repeated fractional-dollar calls stop at the exhausted cap despite binary roundoff', t => {
  const { control } = fixture(t, { dollarCap: 0.003 });
  for (let index = 0; index < 10; index++) call(control, undefined, `span-${index}`);
  assert.equal(control.snapshot().calls.length, 10);
  assert.equal(control.snapshot().stop.reason, 'cap_reached');
  assert.throws(() => control.begin({ model: sol, role: 'lead' }), /slice_stopped/);
});
test('a clear-in-progress refuses admissions and competing clears', t => {
  const { control, directory } = fixture(t);
  writeFileSync(join(directory, 'clear.lock'), JSON.stringify({ pid: process.pid }));
  assert.throws(() => control.begin({ model: sol, role: 'lead' }), /slice_clear_in_progress/);
  assert.throws(() => control.clear({ reason: 'concurrent clear', actor: 'operator' }), /EEXIST/);
  assert.equal(control.snapshot().calls.length, 0);
});
test('the stop latch alone refuses launches if a crash preceded saving the detailed record', t => {
  const { control, directory, config } = fixture(t);
  writeFileSync(join(directory, 'stop.lock'), JSON.stringify({ reason: 'planted_crash' }));
  const next = createSliceControl(config);
  assert.equal(next.snapshot().exitCode, 1);
  assert.throws(() => next.assertStart(), /slice_stopped/);
  control.stop('another_reason');
  assert.equal(control.snapshot().stop.reason, 'planted_crash');
});
test('a stale controller stop preserves spend and the owner costs its late trace under that stop', t => {
  const { control, config } = fixture(t);
  const stale = createSliceControl(config);
  call(control);
  control.begin({ model: sol, role: 'lead' });
  stale.stop('operator_stop', { planted: true });
  control.recordSpan(span(sol, undefined, 'span-2'));
  assert.equal(control.snapshot().calls.length, 2);
  assert.equal(control.snapshot().totals.tokens, 220);
  assert.equal(control.snapshot().phase, 'stopped');
  assert.equal(control.snapshot().stop.reason, 'operator_stop');
});
test('finished slice releases lock and a fresh slice archives its ledger', t => {
  const { control, config } = fixture(t); call(control); control.finish();
  assert.equal(existsSync(control.lockPath), false);
  const next = createSliceControl(config); call(next, { inputTokens: 1, outputTokens: 0 }, 'next'); next.finish();
  assert.equal(next.snapshot().calls.length, 1);
  assert.equal(next.snapshot().slices[0].calls.length, 1);
});

test('a planted call whose worst case token count would cross a token cap is refused before it is sent', async t => {
  const { control } = fixture(t, { tokenCap: 1000000 });
  let invoked = false;
  const wrapped = control.wrapModel({ modelId: sol, async doGenerate() { invoked = true; return {}; } }, { id: sol, role: 'lead' });
  await assert.rejects(wrapped.doGenerate({ maxTokens: 1000001 }), /cap_reached/);
  assert.equal(invoked, false);
  assert.equal(control.snapshot().calls.length, 0);
  assert.equal(control.snapshot().phase, 'stopped');
  assert.equal(control.snapshot().stop.reason, 'cap_reached');
  assert.ok(existsSync(control.stopPath));
});

test('a planted call whose worst case dollar cost would cross a dollar cap is refused before it is sent', async t => {
  const { control } = fixture(t, { dollarCap: 4.0, tokenCap: 2000000 });
  let invoked = false;
  const wrapped = control.wrapModel({ modelId: sol, async doGenerate() { invoked = true; return {}; } }, { id: sol, role: 'lead' });
  await assert.rejects(wrapped.doGenerate({ maxTokens: 500000 }), /cap_reached/);
  assert.equal(invoked, false);
  assert.equal(control.snapshot().calls.length, 0);
  assert.equal(control.snapshot().phase, 'stopped');
  assert.equal(control.snapshot().stop.reason, 'cap_reached');
});

test('a planted call whose worst case with long-input threshold crossed is refused before it is sent', async t => {
  const { control } = fixture(t, { dollarCap: 4.0, tokenCap: 2000000 });
  let invoked = false;
  const wrapped = control.wrapModel({ modelId: sol, async doGenerate() { invoked = true; return {}; } }, { id: sol, role: 'lead' });
  await assert.rejects(wrapped.doGenerate({ inputTokens: 300000, maxTokens: 200000 }), /cap_reached/);
  assert.equal(invoked, false);
  assert.equal(control.snapshot().calls.length, 0);
  assert.equal(control.snapshot().phase, 'stopped');
  assert.equal(control.snapshot().stop.reason, 'cap_reached');
});

test('a direct begin call whose worst case would cross a cap is refused', t => {
  const { control } = fixture(t, { tokenCap: 500 });
  assert.throws(() => control.begin({ model: sol, role: 'lead', maxTokens: 501 }), /cap_reached/);
  assert.equal(control.snapshot().calls.length, 0);
  assert.equal(control.snapshot().phase, 'stopped');
});
