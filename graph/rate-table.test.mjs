// rate-table.test.mjs -- proves graph/rate-table.mjs against real recorded sessions, not against itself.
// The recorded sessions are in graph/fixtures/orca-1.4.205/ (its README says where each came from).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RATE_TABLE, costOf, isDeepseekPeak, piReportedCostOf, peakPromptTokens,
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

test('a Claude transcript repeats a message once per content block: count each message id once', () => {
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

test('Pi: duration is measured by whoever starts the process and sees it exit', () => {
  const start = Date.parse(readFileSync(fx('pi.timing.start.txt'), 'utf8').trim());
  const exit = Date.parse(readFileSync(fx('pi.timing.exit.txt'), 'utf8').trim());
  const wrapper = Number(readFileSync(fx('pi.timing.wrapper-result.txt'), 'utf8').match(/wall_seconds=([\d.]+)/)[1]);
  assert.ok(Math.abs((exit - start) / 1000 - wrapper) < 0.01, 'two clocks agree');
});

test('costOf refuses a model it has no rate for, instead of returning zero', () => {
  assert.throws(() => costOf('no-such-model', { input: 1 }), /no rate for model/);
});
