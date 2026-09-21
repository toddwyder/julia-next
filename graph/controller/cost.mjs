// cost.mjs -- JUL-98 step 3, item 5: one cost line per worker, from the sources
// JUL-109 proved and from no others.
//
// THE RULE TODD ADDED ON 21 SEPTEMBER, and the reason it exists: step 1's
// Claude builder line came back BLANK because cleanup ran before anything read
// the figures. So a blank cost line for any seat fails the step. This file
// makes that mechanical (`assertCostLineComplete`); ./release.mjs makes the
// ORDER mechanical.
//
// WHERE EACH FIGURE COMES FROM. docs/research/jul109-orca-1.4.205-findings.md
// section 5, and nowhere else. Orca itself exposes no token or cost figure at
// all (`worktree ps`, `worker-show` and `terminal list` were searched), so
// there is no Orca route to invent.
//
//   Claude    the session transcript: model per message, usage per message
//             counting each message id ONCE (a transcript writes one line per
//             content block, so summing lines double-counts -- the PR #64
//             mistake), peak context = the largest single prompt, duration =
//             last minus first line timestamp. The transcript is a LOWER BOUND
//             on Claude Code's own record (about 15% under on the proof
//             session, because Claude Code makes calls the transcript omits);
//             `lowerBound: true` says so on every Claude line rather than
//             letting a card imply an exact invoice.
//   Codex     the rollout record: `turn_context.payload.model`, the LAST
//             `token_count` `info.total_token_usage` (cumulative), peak =
//             largest `info.last_token_usage.input_tokens`, window =
//             `info.model_context_window`.
//   DeepSeek  the seat's OWN JSON output: provider/model/usage on the last
//             assistant `message_end`, peak = max over assistant messages of
//             input + cacheRead + cacheWrite. Its `--mode json` output has NO
//             duration and no context field, so the controller times the
//             process: it starts it and sees it exit. A DeepSeek extract with
//             no controller timing is refused rather than guessed.
//
// Dollars are graph/rate-table.mjs's, which graph/rate-table.test.mjs proves
// against these same recordings. Nothing is re-priced here. For Claude and
// Codex the figure is a list-price equivalent (both sign in with subscriptions,
// which are not billed per token); for DeepSeek it is a real charge, and the
// rate table's own header records that the published price runs above what the
// account balance actually moved.

import { costOf, claudeUsageFromTranscript, peakPromptTokens, RATE_TABLE } from '../rate-table.mjs';

export const COST_SOURCES = Object.freeze({
  claude: Object.freeze({
    where: '~/.claude/projects/<worktree path>/<session>.jsonl -- model, per-message usage (each message id once), peak prompt, first/last line timestamps',
    provenOn: 'JUL-109 findings section 5; graph/fixtures/orca-1.4.205/cost.claude-session.json',
    lowerBound: true,
  }),
  codex: Object.freeze({
    where: '~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl -- turn_context.payload.model, the last token_count info.total_token_usage, max info.last_token_usage.input_tokens',
    provenOn: 'JUL-109 findings section 5; graph/fixtures/orca-1.4.205/cost.codex-session.json',
    lowerBound: false,
  }),
  'pi-deepseek': Object.freeze({
    where: "the seat's own JSON output -- provider/model/usage on the last assistant message_end; duration timed by the controller, which starts the process and sees it exit",
    provenOn: 'JUL-109 findings section 5; graph/fixtures/orca-1.4.205/cost.pi.seat-json-stream.multi-turn.jsonl and pi.timing.*.txt',
    lowerBound: false,
  }),
});

function minutesBetween(startedAt, endedAt) {
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  return Number((ms / 60000).toFixed(2));
}

function sumTokens(tokens) {
  return Object.values(tokens).reduce((total, value) => total + (Number(value) || 0), 0);
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

export function claudeExtractFromTranscript(lines) {
  const byModel = claudeUsageFromTranscript(lines);
  const models = Object.keys(byModel);
  if (models.length === 0) throw new Error('claudeExtractFromTranscript: the transcript holds no assistant usage, so this seat has no cost figures');
  // The seat's model is the one that did the work: the model with the most
  // output tokens (Claude Code also makes small Haiku calls of its own).
  const model = models.sort((a, b) => byModel[b].output - byModel[a].output)[0];
  const totals = byModel[model];

  // Peak context: the largest single prompt, per the findings. Each message's
  // prompt is input + cache read + cache creation.
  const seen = new Map();
  for (const line of lines) {
    if (line?.type !== 'assistant' || !line.message?.id || !line.message.usage) continue;
    seen.set(line.message.id, line);
  }
  const calls = [...seen.values()].map((line) => ({
    input: line.message.usage.input_tokens ?? 0,
    cacheRead: line.message.usage.cache_read_input_tokens ?? 0,
    cacheWrite1h: line.message.usage.cache_creation_input_tokens ?? 0,
  }));
  const timestamps = [...seen.values()].map((line) => line.timestamp).filter(Boolean).sort();

  const tokens = {
    input: totals.input,
    output: totals.output,
    cacheRead: totals.cacheRead,
    cacheWrite5m: totals.cacheWrite5m,
    cacheWrite1h: totals.cacheWrite1h,
  };
  return {
    vendor: 'claude',
    model,
    tokens,
    totalTokens: sumTokens(tokens),
    peakContext: peakPromptTokens(calls),
    startedAt: timestamps[0] ?? null,
    endedAt: timestamps[timestamps.length - 1] ?? null,
    usd: costOf(model, tokens),
    lowerBound: true,
  };
}

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

function codexTokenCountEvents(lines) {
  return lines.filter((line) => line?.type === 'event_msg' && line.payload?.type === 'token_count' && line.payload.info);
}

export function codexExtractFromRollout(lines) {
  const model = lines.find((line) => line?.type === 'turn_context')?.payload?.model;
  const events = codexTokenCountEvents(lines);
  if (!model || events.length === 0) {
    throw new Error('codexExtractFromRollout: the rollout has no turn_context model or no token_count event, so this seat has no cost figures');
  }
  // The LAST one: Codex's total_token_usage is cumulative.
  const last = events[events.length - 1].payload.info;
  const total = last.total_token_usage;
  const tokens = {
    input: total.input_tokens ?? 0,
    cachedInput: total.cached_input_tokens ?? 0,
    cacheWrite: total.cache_write_input_tokens ?? 0,
    output: total.output_tokens ?? 0,
  };
  const timestamps = lines.map((line) => line?.timestamp).filter(Boolean).sort();

  return {
    vendor: 'codex',
    model,
    tokens,
    // Codex's input_tokens already INCLUDES the cached part, so the total is
    // the record's own total, never a sum of the fields above.
    totalTokens: total.total_tokens ?? (tokens.input + tokens.output),
    peakContext: Math.max(...events.map((event) => event.payload.info.last_token_usage?.input_tokens ?? 0)),
    contextWindow: last.model_context_window ?? RATE_TABLE.models[model]?.contextWindow ?? null,
    startedAt: timestamps[0] ?? null,
    endedAt: timestamps[timestamps.length - 1] ?? null,
    usd: costOf(model, tokens),
    lowerBound: false,
  };
}

// ---------------------------------------------------------------------------
// DeepSeek, through Pi
// ---------------------------------------------------------------------------

export function deepseekExtractFromSeatStream(events, { startedAt, endedAt } = {}) {
  if (!startedAt || !endedAt) {
    // Pi's `--mode json` output carries no duration at all (every key in a real
    // multi-turn run was searched, JUL-109 section 5), so the only honest
    // source is the controller's own clock around the process.
    throw new Error('deepseekExtractFromSeatStream: a DeepSeek seat has no duration in its own output -- it must be timed by the controller, which starts the process and sees it exit');
  }
  const assistants = events.filter((event) => event?.type === 'message_end' && event.message?.role === 'assistant' && event.message.usage);
  if (assistants.length === 0) {
    throw new Error('deepseekExtractFromSeatStream: the seat output holds no assistant message_end, so this seat has no cost figures');
  }
  const last = assistants[assistants.length - 1].message;
  const tokens = {
    input: last.usage.input ?? 0,
    output: last.usage.output ?? 0,
    cacheRead: last.usage.cacheRead ?? 0,
  };
  const peakContext = peakPromptTokens(assistants.map((event) => ({
    input: event.message.usage.input ?? 0,
    cacheRead: event.message.usage.cacheRead ?? 0,
    cacheWrite: event.message.usage.cacheWrite ?? 0,
  })));

  return {
    vendor: 'pi-deepseek',
    provider: last.provider ?? null,
    model: last.model,
    tokens,
    totalTokens: last.usage.totalTokens ?? sumTokens(tokens),
    peakContext,
    startedAt,
    endedAt,
    minutes: minutesBetween(startedAt, endedAt),
    // Priced at DeepSeek's published rate for the hour the run started, which
    // is the cautious figure: see the rate table's own header.
    usd: costOf(last.model, tokens, { at: new Date(startedAt) }),
    lowerBound: false,
  };
}

// ---------------------------------------------------------------------------
// The line
// ---------------------------------------------------------------------------

// Everything the card needs for one seat, in one object. `capped` and
// `failedOverTo` are the controller's own knowledge (a cap is learned when a
// dispatch is refused), not something a transcript can tell it.
export function seatCostLine({
  seat,
  vendor,
  model,
  tokens,
  peakContext,
  startedAt,
  endedAt,
  minutes,
  usd,
  capped = false,
  failedOverTo = null,
} = {}) {
  const resolvedMinutes = minutes ?? (startedAt && endedAt ? minutesBetween(startedAt, endedAt) : null);
  return {
    seat,
    vendor: vendor ?? RATE_TABLE.models[model]?.vendor ?? null,
    model,
    tokens,
    totalTokens: tokens ? sumTokens(tokens) : null,
    peakContext,
    startedAt: startedAt ?? null,
    endedAt: endedAt ?? null,
    minutes: resolvedMinutes,
    usd: usd ?? (model && tokens ? costOf(model, tokens, { at: startedAt ? new Date(startedAt) : new Date() }) : null),
    capped,
    failedOverTo,
  };
}

const REQUIRED_FIELDS = ['seat', 'model', 'totalTokens', 'peakContext', 'minutes'];

// A blank cost line for any seat FAILS the step. This is the check that makes
// that true rather than hoped for.
export function assertCostLineComplete(line) {
  const blank = REQUIRED_FIELDS.filter((field) => {
    const value = line?.[field];
    return value === null || value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value));
  });
  if (blank.length > 0) {
    throw new Error(`the ${line?.seat ?? 'unnamed'} seat's cost line is blank in: ${blank.join(', ')} -- a blank cost line fails the step (JUL-98, 21 Sep: step 1's builder line came back blank because cleanup ran first)`);
  }
  return line;
}

const number = (value) => Number(value).toLocaleString('en-US');

export function formatCostLine(line) {
  assertCostLineComplete(line);
  const seat = line.seat.charAt(0).toUpperCase() + line.seat.slice(1);
  const capNote = line.capped
    ? `hit its usage cap${line.failedOverTo ? `, failed over to ${line.failedOverTo}` : ''}`
    : (line.failedOverTo ? `failed over to ${line.failedOverTo}` : 'no cap, no failover');
  const dollars = line.usd === null || line.usd === undefined ? 'not priced' : `$${Number(line.usd).toFixed(4)}`;
  return `- **${seat}** -- ${line.model} -- ${number(line.totalTokens)} tokens -- peak context ${number(line.peakContext)} -- ${line.minutes} min -- ${dollars} -- ${capNote}`;
}
