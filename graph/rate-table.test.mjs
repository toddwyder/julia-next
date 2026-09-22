// rate-table.test.mjs -- proves graph/rate-table.mjs against real recorded sessions, not against itself.
// The recorded sessions are in graph/fixtures/orca-1.4.205/ (its README says where each came from).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RATE_TABLE, costOf, isDeepseekPeak, piReportedCostOf, peakPromptTokens, claudeUsageFromTranscript,
} from './rate-table.mjs';

const fx = (name) => new URL(`./fixtures/orca-1.4.205/${name}`, import.meta.url);
const json = (name) => JSON.parse(readFileSync(fx(name), 'utf8'));
const lines = (name) => readFileSync(fx(name), 'utf8').split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
const close = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 1e-9, `${msg}: got ${actual}, expected ${expected}`);

test('every rate says where it came from and when it was checked', () => {
  assert.match(RATE_TABLE.asOf, /^\d{4}-\d{2}-\d{2}$/);
  for (const [model, r] of Object.entries(RATE_TABLE.models)) {
    assert.ok(r.source, `${model} needs a source`);
    assert.match(r.checkedOn, /^\d{4}-\d{2}-\d{2}$/, `${model} needs a checkedOn date`);
  }
});

// ---- Claude: the table must reproduce Claude Code's own dollar figure from Claude Code's own tokens.
for (const file of ['cost.claude-vs-claude-code.session-1.json', 'cost.claude-vs-claude-code.session-2.json']) {
  test(`Claude rates reproduce Claude Code's own cost, per model (${file})`, () => {
    const usage = json(file).claudeCodeRecord.lastModelUsage;
    assert.ok(Object.keys(usage).length >= 2, 'expected a Sonnet and a Haiku line');
    for (const [model, u] of Object.entries(usage)) {
      const ours = costOf(model, {
        input: u.inputTokens, output: u.outputTokens, cacheRead: u.cacheReadInputTokens,
        cacheWrite1h: u.cacheCreationInputTokens,
      });
      close(ours, u.costUSD, `${model} cost`);
    }
  });
}

test('fixture check: the recorded Claude transcript really does repeat messages (this reads data, it runs no code)', () => {
  const t = json('cost.claude-vs-claude-code.session-2.json').transcript;
  assert.ok(t.assistant_lines > t.distinct_messages, 'the fixture must show the duplication');
  const sonnet = t.totals_by_model['claude-sonnet-5'];
  assert.equal(sonnet.messages, t.distinct_messages);
});

test('a deduplicated Claude transcript is a lower bound on Claude Code\'s own total, and close to it', () => {
  const rec = json('cost.claude-vs-claude-code.session-2.json');
  const own = rec.claudeCodeRecord.lastCost;
  const s = rec.transcript.totals_by_model['claude-sonnet-5'];
  const fromTranscript = costOf('claude-sonnet-5', {
    input: s.input, output: s.output, cacheRead: s.cacheRead, cacheWrite5m: s.cacheWrite5m, cacheWrite1h: s.cacheWrite1h,
  });
  assert.ok(fromTranscript < own, 'Claude Code makes calls the transcript does not hold, so the transcript can only undercount');
  const ratio = fromTranscript / own;
  assert.ok(ratio > 0.8 && ratio < 1, `transcript-derived cost should be within 20% below Claude Code's own; ratio ${ratio}`);
});

// ---- Codex: no dollar figure exists in the record, so the proof is the arithmetic and the token semantics.
test('Codex: cached tokens sit inside input tokens, and the table prices the uncached part separately', () => {
  const s = json('cost.codex-session.json');
  const u = s.total_token_usage;
  assert.equal(u.total_tokens, u.input_tokens + u.output_tokens, 'total = input + output, so cached is a subset of input');
  const usd = costOf(s.model, { input: u.input_tokens, cachedInput: u.cached_input_tokens, output: u.output_tokens });
  // (50976-45312) uncached x $10 + 45312 cached x $1 + 223 output x $50, per million
  close(usd, (5664 * 10 + 45312 * 1 + 223 * 50) / 1e6, 'codex session cost');
  close(usd, 0.113102, 'codex session cost as a number a person can check');
});

test('Codex: a request over 272,000 input tokens is billed at the long-context multipliers', () => {
  const base = costOf('gpt-6-astra', { input: 272000, cachedInput: 0, output: 1000 });
  const over = costOf('gpt-6-astra', { input: 272001, cachedInput: 0, output: 1000 });
  close(base, (272000 * 10 + 1000 * 50) / 1e6, 'at the threshold');
  close(over, (272001 * 10 * 2 + 1000 * 50 * 1.5) / 1e6, 'just over the threshold');
});

// ---- Pi / DeepSeek
test('Pi: the registry rates reproduce the dollar figure Pi itself prints, for both seats', () => {
  for (const f of ['seat-probe.reviewer-backup.json', 'seat-probe.builder-backup.json']) {
    const p = json(f);
    close(piReportedCostOf(p.model, p.usage), p.usage.cost.total, `${f} Pi-reported cost`);
  }
});

test('Pi: DeepSeek\'s published price is HIGHER than the figure Pi prints (recorded discrepancy)', () => {
  // Both probes ran on a Sunday, which is off-peak. If this test starts failing, DeepSeek or Pi changed a
  // price: re-check the table and the runbook's note before trusting any DeepSeek cost line.
  for (const [f, minRatio, maxRatio] of [['seat-probe.reviewer-backup.json', 1.4, 1.7], ['seat-probe.builder-backup.json', 1.05, 1.15]]) {
    const p = json(f);
    const published = costOf(p.model, p.usage, { at: new Date('2026-09-20T20:34:00Z') });
    const ratio = published / p.usage.cost.total;
    assert.ok(ratio > minRatio && ratio < maxRatio, `${f}: published/Pi-printed = ${ratio}`);
  }
});

test('DeepSeek peak hours: 01-04 and 06-10 UTC on weekdays only', () => {
  assert.equal(isDeepseekPeak('2026-09-21T02:00:00Z'), true); // Monday
  assert.equal(isDeepseekPeak('2026-09-21T07:30:00Z'), true);
  assert.equal(isDeepseekPeak('2026-09-21T05:00:00Z'), false);
  assert.equal(isDeepseekPeak('2026-09-21T10:00:00Z'), false);
  // every edge of both windows
  for (const [at, want] of [['00:59', false], ['01:00', true], ['03:59', true], ['04:00', false], ['05:59', false], ['06:00', true], ['09:59', true], ['10:00', false]]) {
    assert.equal(isDeepseekPeak(`2026-09-22T${at}:00Z`), want, `Tuesday ${at} UTC`);
  }
  assert.equal(isDeepseekPeak('2026-09-20T02:00:00Z'), false); // Sunday
  const u = { input: 1000, output: 1000, cacheRead: 1000 };
  close(costOf('deepseek-v4-pro', u, { at: '2026-09-21T02:00:00Z' }), 2 * costOf('deepseek-v4-pro', u, { at: '2026-09-21T05:00:00Z' }), 'peak is twice off-peak');
});

test("DeepSeek rates and context windows in the table match Pi's own registry extract", () => {
  const reg = json('pi-registry.deepseek.json').models;
  for (const model of ['deepseek-v4-pro', 'deepseek-v4-flash']) {
    const r = RATE_TABLE.models[model];
    assert.deepEqual(r.piRegistry, { input: reg[model].cost.input, output: reg[model].cost.output, cacheRead: reg[model].cost.cacheRead }, `${model} registry rates`);
    assert.equal(r.contextWindow, reg[model].contextWindow, `${model} context window`);
  }
});

test('Pi: peak context comes from the per-call usage in the seat\'s own JSON output; Pi\'s own figure agrees', () => {
  const events = lines('cost.pi.seat-json-stream.multi-turn.jsonl');
  const calls = events.filter((e) => e.type === 'message_end' && e.message.role === 'assistant').map((e) => e.message.usage);
  assert.ok(calls.length >= 2, 'the fixture must be a multi-turn run');
  assert.equal(peakPromptTokens(calls), 2530); // turn 1: 1975+384, turn 2: 226+2304
  // the stream has no context field of its own; that is why the derivation above is needed
  assert.doesNotMatch(readFileSync(fx('cost.pi.seat-json-stream.multi-turn.jsonl'), 'utf8'), /"[A-Za-z_]*[Cc]ontext[A-Za-z_]*"\s*:/);
  // Pi's own answer, asked in RPC mode: contextUsage.tokens is the last call's total, and the window is the table's
  const rpc = json('cost.pi.rpc-get-session-stats.json');
  const last = rpc.assistant_usage.at(-1);
  assert.equal(rpc.stats.data.contextUsage.tokens, last.totalTokens);
  assert.equal(rpc.stats.data.contextUsage.contextWindow, RATE_TABLE.models['deepseek-v4-flash'].contextWindow);
});

test('fixture check: Pi duration, by two clocks that agree (this reads data, it runs no code)', () => {
  const start = Date.parse(readFileSync(fx('pi.timing.start.txt'), 'utf8').trim());
  const exit = Date.parse(readFileSync(fx('pi.timing.exit.txt'), 'utf8').trim());
  const wrapper = Number(readFileSync(fx('pi.timing.wrapper-result.txt'), 'utf8').match(/wall_seconds=([\d.]+)/)[1]);
  assert.ok(Math.abs((exit - start) / 1000 - wrapper) < 0.01, 'two clocks agree');
});

test('costOf refuses a model it has no rate for, instead of returning zero', () => {
  assert.throws(() => costOf('no-such-model', { input: 1 }), /no rate for model/);
});

// ---- the code that does the counting (added after the PR #65 review found the tests above only read fixtures)
const asstLine = (id, blocks, usage) => ({ type: 'assistant', message: { id, model: 'claude-sonnet-5', content: blocks, usage } });

test('claudeUsageFromTranscript counts a message once even when its content blocks are written as two lines', () => {
  const usage = { input_tokens: 2, output_tokens: 259, cache_read_input_tokens: 59988, cache_creation: { ephemeral_1h_input_tokens: 1072 }, cache_creation_input_tokens: 1072 };
  const lines = [
    asstLine('m1', [{ type: 'text' }], { input_tokens: 2, output_tokens: 80, cache_read_input_tokens: 47801, cache_creation: { ephemeral_1h_input_tokens: 12187 }, cache_creation_input_tokens: 12187 }),
    asstLine('m2', [{ type: 'text' }], usage),
    asstLine('m2', [{ type: 'tool_use' }], usage), // the SAME message, second content block, identical usage
    { type: 'user', message: { id: 'u1' } },
  ];
  const t = claudeUsageFromTranscript(lines)['claude-sonnet-5'];
  assert.equal(t.messages, 2);
  assert.equal(t.output, 80 + 259, 'summing lines would give 598');
  assert.equal(t.cacheRead, 47801 + 59988);
  assert.equal(t.cacheWrite1h, 12187 + 1072);
});

test('claudeUsageFromTranscript: a cache write with no lifetime split is counted as 1-hour; synthetic messages are ignored', () => {
  const lines = [
    asstLine('a', [{ type: 'text' }], { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 500 }),
    { type: 'assistant', message: { id: 's', model: '<synthetic>', usage: { input_tokens: 9, output_tokens: 9 } } },
  ];
  const out = claudeUsageFromTranscript(lines);
  assert.equal(out['claude-sonnet-5'].cacheWrite1h, 500);
  assert.equal(out['<synthetic>'], undefined);
});

test('peakPromptTokens counts Claude cache writes under both of Claude\'s field names, and Pi\'s cacheWrite', () => {
  assert.equal(peakPromptTokens([{ input: 10, cacheRead: 1000, cacheWrite1h: 500 }]), 1510);
  assert.equal(peakPromptTokens([{ input: 10, cacheRead: 1000, cacheWrite5m: 200, cacheWrite1h: 300 }]), 1510);
  assert.equal(peakPromptTokens([{ input: 10, cacheRead: 1000, cacheWrite: 500 }]), 1510);
  assert.equal(peakPromptTokens([{ input: 10, cacheRead: 5, output: 99999 }, { input: 1, cacheRead: 1 }]), 15, 'output is never part of the prompt; the peak is one call, not a sum');
});

test('Codex cache writes are priced at the cache-write rate, not the input rate (synthetic; the placement inside input_tokens is unproven)', () => {
  const usd = costOf('gpt-6-astra', { input: 1000, cachedInput: 200, cacheWrite: 300, output: 0 });
  close(usd, (500 * 10 + 200 * 1 + 300 * 12.5) / 1e6, 'codex with cache writes');
  assert.ok(RATE_TABLE.models['gpt-6-astra'].unconfirmed, 'the table must say this is unproven');
});

// ---- the PR #65 review run: what Pi printed, what the published price gives, what the account was charged
test('the review run: Pi printed the fetched model-store prices (DeepSeek\'s peak price at every hour), not its built-in ones', () => {
  const run = json('review.pr65.deepseek-pro.run.json');
  assert.equal(run.model, 'deepseek-v4-pro');
  assert.ok(run.calls.length >= 10 && run.toolCalls > 0, 'a real multi-call review');
  for (const c of run.calls) {
    close(piReportedCostOf(run.model, c, { source: 'store' }), c.piCost, 'each call priced at the store rates');
  }
  const store = json('pi-models-store.deepseek.json').deepseek.models.find((m) => m.id === 'deepseek-v4-pro');
  assert.deepEqual(RATE_TABLE.models['deepseek-v4-pro'].piModelStore,
    { input: store.cost.input, output: store.cost.output, cacheRead: store.cost.cacheRead });
  const builtIn = run.calls.reduce((s, c) => s + piReportedCostOf(run.model, c, { source: 'registry' }), 0);
  assert.ok(run.totalsAsPrintedByPi.cost > 3 * builtIn, 'the built-in list would have printed far less');
});

test('the review run: the published price is above what the account balance shows it cost', () => {
  const run = json('review.pr65.deepseek-pro.run.json');
  const published = run.calls.reduce((s, c) => s + costOf(run.model, c, { at: new Date(c.ts) }), 0);
  const spent = Number(run.deepseekBalanceUsd.beforeRun) - Number(run.deepseekBalanceUsd.afterRun);
  assert.ok(Math.abs(spent - 0.09) < 1e-9);
  // Both readings are to the cent, so the real charge is 0.08 to 0.10 (one run, one measurement).
  assert.ok(published > 0.10, `published-price estimate ${published} should exceed the charge`);
  assert.ok(run.totalsAsPrintedByPi.cost > 2 * spent, 'Pi printed more than twice the charge');
});

// ---- The transcript reader must work on a REAL builder transcript, as it is read off disk.
//
// Measured by the coordinator on 21 Sep against the real transcript of this card's own step-3
// attempt-1 worker (/home/runner/.claude/projects/-home-runner-orca-workspaces-julia-next-jul98-step-3,
// 777 lines, 133 of them assistant lines carrying claude-opus-5 usage): claudeUsageFromTranscript
// returned an EMPTY object, which is why every builder cost line on this card read "not captured".
//
// The mismatch is the INPUT CONTRACT, not the usage shape. A `.jsonl` file read off disk is a list of
// STRINGS; the function only ever looked at `l.type`, which on a string is `undefined`, so it skipped
// every line and returned {} without complaint. A silent {} is exactly the blank cost line the card
// says must fail. `cost.claude-transcript.real-builder-lines.jsonl` is nine of those real lines,
// verbatim except that `message.content` is elided (no cost extractor reads it): three distinct
// assistant messages, each repeated as the transcript really repeats them one line per content block,
// plus one real `user` line that also carries `output_tokens` and must stay uncounted.
const REAL_TRANSCRIPT = 'cost.claude-transcript.real-builder-lines.jsonl';
const REAL_TRANSCRIPT_TOTALS = { input: 6, output: 779, cacheRead: 141743, cacheWrite5m: 0, cacheWrite1h: 29707, messages: 3 };

test('a real builder transcript read off disk as JSONL text gives usage, not a silent empty object', () => {
  const text = readFileSync(fx(REAL_TRANSCRIPT), 'utf8').split('\n').filter(Boolean);
  const usage = claudeUsageFromTranscript(text);
  assert.deepEqual(Object.keys(usage), ['claude-opus-5'], 'the real transcript is claude-opus-5 and must not come back empty');
  assert.deepEqual(usage['claude-opus-5'], REAL_TRANSCRIPT_TOTALS);
});

test('the same real transcript already parsed gives the identical figures -- one reading, two input forms', () => {
  assert.deepEqual(claudeUsageFromTranscript(lines(REAL_TRANSCRIPT))['claude-opus-5'], REAL_TRANSCRIPT_TOTALS);
});

test('the real transcript repeats messages and carries a user line with output_tokens: both stay uncounted', () => {
  const parsed = lines(REAL_TRANSCRIPT);
  assert.equal(parsed.length, 9, 'nine real lines');
  assert.equal(parsed.filter((l) => l.type === 'assistant').length, 8);
  assert.equal(parsed.filter((l) => l.type === 'user' && JSON.stringify(l).includes('output_tokens')).length, 1);
  assert.equal(claudeUsageFromTranscript(parsed)['claude-opus-5'].messages, 3, 'eight assistant lines, three distinct messages');
});

// ---------------------------------------------------------------------------
// JUL-98 step 6: Gemini, which is not priced per token at all.
//
// The Antigravity CLI signs in to a Google AI Pro subscription and spends a
// WEEKLY and a FIVE-HOUR allowance, proportionally to token cost -- its own
// words, read off `agy -p "/usage" --output-format json` on this host on
// 2026-09-22. There is no per-token charge to look up and no vendor token
// record to price, so this table states the billing rather than inventing a
// dollar figure, and costOf refuses instead of returning a plausible zero.
// ---------------------------------------------------------------------------

test('the dispatched Gemini model is in the table, declared as allowance-billed', () => {
  for (const id of ['gemini-3.8-flash']) {
    const entry = RATE_TABLE.models[id];
    assert.ok(entry, `graph/rate-table.mjs has no entry for the dispatched model id ${id}`);
    assert.equal(entry.vendor, 'gemini');
    assert.equal(entry.billing, 'allowance');
    assert.deepEqual(entry.allowanceBuckets, ['gemini-weekly', 'gemini-5h']);
    assert.ok(entry.source, `${id} does not say where its figures came from`);
    assert.ok(entry.checkedOn, `${id} does not say when it was checked`);
  }
});

test('costOf refuses a Gemini model rather than returning a dollar figure nobody is billed', () => {
  assert.throws(
    () => costOf('gemini-3.8-flash', { input: 1000, output: 1000 }),
    /allowance/,
  );
});
