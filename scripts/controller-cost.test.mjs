// controller-cost.test.mjs -- JUL-98 step 3, item 5: one cost line per worker,
// read from the sources JUL-109 proved and no others.
//
// The sources, from docs/research/jul109-orca-1.4.205-findings.md section 5:
//
//   Claude   the session transcript (model, usage per message counting each
//            message id ONCE, peak = max over messages of input + cache read +
//            cache creation, duration = last minus first line timestamp)
//   Codex    the rollout record (model from turn_context.payload.model, tokens
//            from the LAST token_count info.total_token_usage, peak from max
//            info.last_token_usage.input_tokens, window from
//            info.model_context_window)
//   DeepSeek the seat's own JSON output (provider/model/usage on the last
//            assistant message_end; peak = max over assistant messages of
//            input + cacheRead + cacheWrite), with the duration timed by the
//            CONTROLLER, which starts the process and sees it exit
//
// Dollars come from graph/rate-table.mjs, which is itself proven against these
// same recordings in graph/rate-table.test.mjs. Nothing here re-prices anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  COST_SOURCES,
  claudeExtractFromTranscript,
  codexExtractFromRollout,
  deepseekExtractFromSeatStream,
  seatCostLine,
  tokenTotal,
  neverStartedCostLine,
  assertCostLineComplete,
  formatCostLine,
} from '../graph/controller/cost.mjs';
import { ORCA_FIXTURE_DIR } from '../graph/controller/fixture-orca.mjs';
import { join } from 'node:path';

const json = (name) => JSON.parse(readFileSync(join(ORCA_FIXTURE_DIR, name), 'utf8'));
const jsonl = (name) => readFileSync(join(ORCA_FIXTURE_DIR, name), 'utf8')
  .split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));

test('every seat names where its figures come from, and the three are the proven ones', () => {
  assert.deepEqual(Object.keys(COST_SOURCES).sort(), ['claude', 'codex', 'pi-deepseek']);
  for (const [vendor, source] of Object.entries(COST_SOURCES)) {
    assert.ok(source.where.length > 0, `${vendor} must say where its figures are read from`);
    assert.match(source.provenOn, /JUL-109/);
  }
});

// --- Claude -----------------------------------------------------------------
//
// The transcript lines below use Claude Code's own transcript field names, the
// same ones graph/rate-table.mjs's `claudeUsageFromTranscript` is proven
// against. The recorded extract of a real session
// (cost.claude-session.json) is used as the check on the SHAPE this produces.

const asst = (id, blocks, usage) => ({
  type: 'assistant',
  timestamp: usage.timestamp,
  message: { id, model: 'claude-sonnet-5', content: blocks, usage: usage.usage },
});

test('Claude: usage comes off the transcript with each message counted once, and peak context is the largest prompt', () => {
  const small = { timestamp: '2026-09-20T20:31:32.967Z', usage: { input_tokens: 6, output_tokens: 400, cache_read_input_tokens: 40000, cache_creation_input_tokens: 7000 } };
  const big = { timestamp: '2026-09-20T20:32:15.610Z', usage: { input_tokens: 6, output_tokens: 405, cache_read_input_tokens: 55524, cache_creation_input_tokens: 7000 } };
  const lines = [
    asst('m1', [{ type: 'text' }], small),
    asst('m2', [{ type: 'text' }], big),
    // The SAME message a second time, its other content block: counted once.
    asst('m2', [{ type: 'tool_use' }], big),
  ];

  const extract = claudeExtractFromTranscript(lines);
  assert.equal(extract.model, 'claude-sonnet-5');
  assert.equal(extract.tokens.input, 12);
  assert.equal(extract.tokens.output, 805, 'the repeated line must not be counted twice');
  assert.equal(extract.tokens.cacheRead, 95524);
  assert.equal(extract.peakContext, 6 + 55524 + 7000, 'the largest single prompt, not the sum');
  assert.equal(extract.startedAt, '2026-09-20T20:31:32.967Z');
  assert.equal(extract.endedAt, '2026-09-20T20:32:15.610Z');
  assert.ok(extract.usd > 0);
});

test('Claude: the recorded real session\'s own totals produce a cost line with every field filled', () => {
  const recorded = json('cost.claude-session.json').transcript;
  const totals = recorded.totals_by_model['claude-sonnet-5'];
  const line = seatCostLine({
    seat: 'builder',
    vendor: 'claude',
    model: 'claude-sonnet-5',
    tokens: { input: totals.input, output: totals.output, cacheRead: totals.cacheRead, cacheWrite1h: totals.cacheWrite1h },
    peakContext: recorded.peak_context_tokens,
    startedAt: recorded.first_timestamp,
    endedAt: recorded.last_timestamp,
  });

  assert.equal(line.seat, 'builder');
  assert.equal(line.model, 'claude-sonnet-5');
  assert.equal(line.totalTokens, totals.input + totals.output + totals.cacheRead + totals.cacheWrite1h);
  assert.equal(line.peakContext, 62524);
  assert.equal(line.minutes, Number((recorded.duration_seconds / 60).toFixed(2)));
  assert.ok(line.usd > 0);
  assert.equal(line.capped, false);
  assert.doesNotThrow(() => assertCostLineComplete(line));
});

// --- Codex ------------------------------------------------------------------

test('Codex: the rollout\'s last token_count is the total, and the peak is the largest single turn\'s input', () => {
  const recorded = json('cost.codex-session.json');
  // Built from the field paths the recording's own `how_read` names; no raw
  // Codex rollout file is in the fixtures, so this pins the reading recipe
  // against the recorded extract, not against raw lines.
  const lines = [
    { timestamp: recorded.first_timestamp, type: 'turn_context', payload: { model: recorded.model } },
    { timestamp: '2026-09-20T20:41:30.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 10, total_tokens: 110 }, last_token_usage: { input_tokens: recorded.peak_last_turn_input_tokens }, model_context_window: recorded.model_context_window } } },
    { timestamp: recorded.last_timestamp, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: recorded.total_token_usage, last_token_usage: { input_tokens: 9000 }, model_context_window: recorded.model_context_window } } },
  ];

  const extract = codexExtractFromRollout(lines);
  assert.equal(extract.model, 'gpt-6-astra');
  assert.equal(extract.tokens.input, recorded.total_token_usage.input_tokens, 'the LAST token_count, which is cumulative');
  assert.equal(extract.tokens.cachedInput, recorded.total_token_usage.cached_input_tokens);
  assert.equal(extract.peakContext, recorded.peak_last_turn_input_tokens);
  assert.equal(extract.contextWindow, recorded.model_context_window);
  assert.equal(Math.round((Date.parse(extract.endedAt) - Date.parse(extract.startedAt)) / 1000), Math.round(recorded.duration_seconds));
  // The same arithmetic graph/rate-table.test.mjs proves against this record.
  assert.ok(Math.abs(extract.usd - 0.113102) < 1e-6);
});

// --- DeepSeek (Pi) ----------------------------------------------------------

test('DeepSeek: model, tokens and peak context come off the seat\'s own JSON output', () => {
  const events = jsonl('cost.pi.seat-json-stream.multi-turn.jsonl');
  const extract = deepseekExtractFromSeatStream(events, {
    // The controller times the process: it starts it and sees it exit. These
    // are the recorded wrapper stamps (pi.timing.start.txt / .exit.txt), whose
    // difference is the 2.416 s pi.timing.wrapper-result.txt reports.
    startedAt: readFileSync(join(ORCA_FIXTURE_DIR, 'pi.timing.start.txt'), 'utf8').trim(),
    endedAt: readFileSync(join(ORCA_FIXTURE_DIR, 'pi.timing.exit.txt'), 'utf8').trim(),
  });

  assert.equal(extract.model, 'deepseek-v4-flash');
  assert.equal(extract.provider, 'deepseek');
  assert.equal(extract.peakContext, 2530, 'the recorded peak: 226 + 2,304 on the second turn');
  assert.equal(extract.tokens.input, 226, 'the last assistant message_end\'s own usage');
  assert.equal(extract.minutes, Number((2.416 / 60).toFixed(2)), 'timed by the controller, as the wrapper stamps prove');
  assert.ok(extract.usd > 0);
});

test('DeepSeek: the duration is the controller\'s, because the seat output has none -- a missing timing is refused, not guessed', () => {
  const events = jsonl('cost.pi.seat-json-stream.multi-turn.jsonl');
  assert.throws(
    () => deepseekExtractFromSeatStream(events, {}),
    /timed by the controller/,
  );
});

// --- The line itself --------------------------------------------------------

test('a blank field in any seat\'s cost line fails the step, and the refusal names the field', () => {
  const good = {
    seat: 'reviewer', model: 'deepseek-v4-pro', totalTokens: 12345, peakContext: 2530, minutes: 4.1, usd: 0.0151, capped: false, failedOverTo: null,
  };
  assert.doesNotThrow(() => assertCostLineComplete(good));

  for (const field of ['model', 'totalTokens', 'peakContext', 'minutes']) {
    assert.throws(
      () => assertCostLineComplete({ ...good, [field]: null }),
      new RegExp(field),
      `a blank ${field} must fail the step, not be posted as an empty cost line`,
    );
  }
});

test('the posted line says seat, model, tokens, peak context, minutes and whether the seat was capped or failed over', () => {
  const text = formatCostLine({
    seat: 'builder', model: 'claude-opus-5', totalTokens: 369994, peakContext: 62524, minutes: 0.71, usd: 0.1057164, capped: true, failedOverTo: 'pi-deepseek',
  });
  assert.match(text, /Builder/i);
  assert.match(text, /claude-opus-5/);
  assert.match(text, /369,994/);
  assert.match(text, /62,524/);
  assert.match(text, /0\.71 min/);
  assert.match(text, /\$0\.1057/);
  assert.match(text, /usage cap/i);
  assert.match(text, /pi-deepseek/);
});

test('a seat that was neither capped nor failed over says so explicitly, so a blank never reads as "no cap"', () => {
  const text = formatCostLine({
    seat: 'reviewer', model: 'deepseek-v4-pro', totalTokens: 121247, peakContext: 2530, minutes: 10, usd: 0.0151, capped: false, failedOverTo: null,
  });
  assert.match(text, /no cap/i);
});

// --- ONE way a token total is computed ---------------------------------------
//
// The review finding this pins (JUL-98 step 3, attempt 1): cost.mjs had TWO
// token totals. `codexExtractFromRollout` used the record's own
// `total_tokens`; `seatCostLine` summed the component fields instead, and for
// the recorded Codex session those disagree by nearly a factor of two --
// 50,976 + 45,312 + 0 + 223 = 96,511 against the record's own 51,199, because
// Codex's `input_tokens` ALREADY INCLUDES the cached part
// (graph/fixtures/orca-1.4.205/cost.codex-session.json, and the findings'
// section 5 note "total_tokens = input + output").
//
// This is the same failure mode JUL-109 recorded in PR #64, where a naive sum
// over Claude transcript lines double-counted messages. A doubled figure is
// worse than a blank one: it is what Todd reads to decide which seat moves to
// DeepSeek, and it points the decision the wrong way.

test('a record that carries its own token total IS the total -- summing the fields would nearly double the Codex seat', () => {
  const recorded = json('cost.codex-session.json');
  const total = recorded.total_token_usage;
  const summed = total.input_tokens + total.cached_input_tokens + total.cache_write_input_tokens + total.output_tokens;
  assert.equal(summed, 96511, 'the recorded fields really do sum to nearly double -- this is the trap, not a hypothetical');
  assert.equal(total.total_tokens, 51199);

  assert.equal(
    tokenTotal({ input: total.input_tokens, cachedInput: total.cached_input_tokens, cacheWrite: total.cache_write_input_tokens, output: total.output_tokens }, total.total_tokens),
    51199,
    "the record's own total, never a sum of the fields",
  );
});

test('the Codex seat gets the SAME token total whether it is read off the rollout or put through the cost line', () => {
  const recorded = json('cost.codex-session.json');
  const lines = [
    { timestamp: recorded.first_timestamp, type: 'turn_context', payload: { model: recorded.model } },
    { timestamp: recorded.last_timestamp, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: recorded.total_token_usage, last_token_usage: { input_tokens: recorded.peak_last_turn_input_tokens }, model_context_window: recorded.model_context_window } } },
  ];
  const extract = codexExtractFromRollout(lines);
  assert.equal(extract.totalTokens, 51199);

  const line = seatCostLine({ seat: 'reviewer', ...extract });
  assert.equal(line.totalTokens, extract.totalTokens, 'one token total, not two that disagree');
  assert.notEqual(line.totalTokens, 96511, 'the summed figure is the bug -- it must not reappear on the posted line');
  assert.match(formatCostLine(line), /51,199 tokens/);
});

test("a record with no total of its own -- Claude's transcript -- still totals by summing its de-duplicated fields", () => {
  const recorded = json('cost.claude-session.json').transcript;
  const totals = recorded.totals_by_model['claude-sonnet-5'];
  // The Claude fixture has no record-own total: the findings say the figure is
  // the sum over messages counted once, and this is that sum.
  assert.equal(tokenTotal({ input: totals.input, output: totals.output, cacheRead: totals.cacheRead, cacheWrite5m: totals.cacheWrite5m, cacheWrite1h: totals.cacheWrite1h }), 369994);

  const line = seatCostLine({
    seat: 'builder',
    model: 'claude-sonnet-5',
    tokens: { input: totals.input, output: totals.output, cacheRead: totals.cacheRead, cacheWrite5m: totals.cacheWrite5m, cacheWrite1h: totals.cacheWrite1h },
    peakContext: recorded.peak_context_tokens,
    startedAt: recorded.first_timestamp,
    endedAt: recorded.last_timestamp,
  });
  assert.equal(line.totalTokens, 369994);
});

test("the DeepSeek seat's own totalTokens is used, not a re-sum of its usage fields", () => {
  const events = jsonl('cost.pi.seat-json-stream.multi-turn.jsonl');
  const extract = deepseekExtractFromSeatStream(events, {
    startedAt: readFileSync(join(ORCA_FIXTURE_DIR, 'pi.timing.start.txt'), 'utf8').trim(),
    endedAt: readFileSync(join(ORCA_FIXTURE_DIR, 'pi.timing.exit.txt'), 'utf8').trim(),
  });
  // The recorded last assistant message_end carries usage.totalTokens 2534.
  assert.equal(extract.totalTokens, 2534);
  assert.equal(seatCostLine({ seat: 'reviewer', ...extract }).totalTokens, 2534, 'the line does not re-derive what the record already states');
});

// --- A worker that never started ---------------------------------------------

test("a worker that never started yields an explicit never-started cost line, not a blank one", () => {
  const line = neverStartedCostLine({ seat: 'builder', reason: 'no turn_started was ever observed' });
  assert.equal(line.neverStarted, true);
  assert.equal(line.totalTokens, 0);
  assert.equal(line.usd, 0);
  assert.doesNotThrow(() => assertCostLineComplete(line), 'it is complete BECAUSE it is marked never-started, not because it is blank');
  assert.match(formatCostLine(line), /never started/i);
  // And a line that merely LOOKS empty, without the mark, still fails.
  assert.throws(() => assertCostLineComplete({ seat: 'builder', model: null, totalTokens: null, peakContext: null, minutes: null }), /blank/);
});

test('the Claude seat extract works on the real transcript as it is read off disk, and its peak and duration are not lost', () => {
  const text = readFileSync(join(ORCA_FIXTURE_DIR, 'cost.claude-transcript.real-builder-lines.jsonl'), 'utf8').split('\n').filter(Boolean);
  const extract = claudeExtractFromTranscript(text);
  assert.equal(extract.model, 'claude-opus-5');
  assert.equal(extract.totalTokens, 6 + 779 + 141743 + 0 + 29707, 'the real transcript, counted once per message');
  assert.ok(extract.peakContext > 0, 'the peak must survive the raw-text form too, not silently read 0');
  assert.ok(extract.startedAt && extract.endedAt, 'the duration comes off the same lines');
  assert.ok(extract.usd > 0);
});
