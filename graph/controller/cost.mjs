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

import { costOf, claudeUsageFromTranscript, parseTranscriptLines, peakPromptTokens, RATE_TABLE } from '../rate-table.mjs';

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
    where: "the seat's own JSON output -- provider/model off the last assistant message_end, usage SUMMED across every assistant message_end (each is that one turn's figures, not a running total -- JUL-98, fixed 2026-09-22); duration timed by the controller, which starts the process and sees it exit. TWO shapes read this way now (JUL-98/JUL-100 follow-up): the one-shot `--mode json` stream directly, and an ADOPT-route interactive session's own `.jsonl` under `~/.pi/agent/sessions/`, re-tagged from `message` to `message_end` first (cost-read.mjs's `piSessionEventsFromLines`) so this is still the one place that sums a DeepSeek seat's usage. A Command Code run (provider `commandcode`) is priced under the rate table's OWN namespaced id, not the bare one Pi echoes -- see `deepseekExtractFromSeatStream`'s own comment",
    provenOn: 'JUL-109 findings section 5; graph/fixtures/orca-1.4.205/cost.pi.seat-json-stream.multi-turn.jsonl, pi.timing.*.txt, and cost.pi.interactive-session.jsonl (a real adopted-route session)',
    lowerBound: false,
  }),
  gemini: Object.freeze({
    where: 'the ALLOWANCE, not tokens: `agy -p "/usage" --output-format json` read once before the worker starts and once after it reports, differenced per bucket (gemini-weekly, gemini-5h). agy records no per-session token count anywhere on disk for an interactive session',
    provenOn: 'JUL-98 step 6, measured on this host 2026-09-22 (agy 1.2.7/1.2.8); graph/rate-table.mjs records the search that found no token record',
    lowerBound: false,
  }),
});

function minutesBetween(startedAt, endedAt) {
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  return Number((ms / 60000).toFixed(2));
}

// THE ONE WAY A TOKEN TOTAL IS COMPUTED. Every seat, every extract and the
// posted line go through this function and nowhere else.
//
// THE RULE: where the record states its own total, THAT is the total. A sum of
// the component fields is used only when no record total exists.
//
// WHY, with the arithmetic. Codex's `input_tokens` already includes the cached
// part (`total_tokens = input + output`, findings section 5), so summing the
// fields of the recorded session gives 50,976 + 45,312 + 0 + 223 = 96,511
// against the record's own 51,199 -- nearly double
// (graph/fixtures/orca-1.4.205/cost.codex-session.json). This is the same
// failure mode JUL-109 recorded for Claude in PR #64, where summing one line
// per content block counted messages twice. Attempt 1 of this step had TWO
// totals -- `codexExtractFromRollout` got it right and `seatCostLine` summed --
// and they disagreed by that factor. A doubled cost line is worse than a blank
// one: it is the figure Todd reads to decide which seat moves to DeepSeek, and
// it points the decision the wrong way.
export function tokenTotal(tokens, recordedTotal) {
  const own = Number(recordedTotal);
  if (Number.isFinite(own)) return own;
  if (!tokens) return null;
  return Object.values(tokens).reduce((total, value) => total + (Number(value) || 0), 0);
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

export function claudeExtractFromTranscript(rawLines) {
  // Parsed once, through the one reader, so the totals and the peak/duration
  // below see the same lines whether the caller handed over objects or the raw
  // JSONL text a `.jsonl` file is read as. Handing over text used to give
  // totals of nothing at all -- the silent {} that made JUL-98's builder cost
  // lines blank.
  const lines = parseTranscriptLines(rawLines);
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
    // Claude's transcript states no total of its own, so this is the sum over
    // fields already de-duplicated by message id (findings section 5, trap 1).
    totalTokens: tokenTotal(tokens),
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
    totalTokens: tokenTotal(tokens, total.total_tokens),
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
  // SUMMED across every turn, not just the last one (JUL-98, fixed
  // 2026-09-22). Found live: a real Command Code review's last message_end
  // carried 535 output tokens, which cannot have produced its 10.6KB review
  // file. Each assistant message_end's usage.* is that ONE turn's figures,
  // not a running cumulative total the way Codex's token_count events are
  // (codexExtractFromRollout's "last is the total" is correct for Codex
  // specifically; it was wrongly assumed to hold here too). Proof in the
  // fixture itself: turn 2's usage.input (226) is smaller than turn 1's
  // (1975) -- a cumulative counter cannot go down.
  const tokens = assistants.reduce((sum, event) => ({
    input: sum.input + (event.message.usage.input ?? 0),
    output: sum.output + (event.message.usage.output ?? 0),
    cacheRead: sum.cacheRead + (event.message.usage.cacheRead ?? 0),
  }), { input: 0, output: 0, cacheRead: 0 });
  const peakContext = peakPromptTokens(assistants.map((event) => ({
    input: event.message.usage.input ?? 0,
    cacheRead: event.message.usage.cacheRead ?? 0,
    cacheWrite: event.message.usage.cacheWrite ?? 0,
  })));
  // totalTokens is likewise summed across every turn's own usage.totalTokens
  // -- each one is that turn's total, same per-turn shape as the other
  // fields, so summing them (rather than trusting one recorded field) is the
  // real session total. tokenTotal's own fallback (summing `tokens`) would
  // undercount here too, since `tokens` excludes cacheWrite/reasoning.
  const totalTokens = assistants.reduce((sum, event) => sum + (Number(event.message.usage.totalTokens) || 0), 0);

  // Pi's own `--model` argv is the API-facing id: `deepseek-v4-flash` (native
  // DeepSeek), or `deepseek/deepseek-v4-pro`/`-flash` (Command Code --
  // namespaced, confirmed live against its own `/models` listing,
  // ops/service-dropbox/README.md "Command Code as the reviewer's Pi
  // provider"). Pi echoes that same id back on `message.model`/`message_end.
  // model` (confirmed live in a real adopted-route reviewer session,
  // graph/fixtures/orca-1.4.205/cost.pi.interactive-session.jsonl:
  // `provider: "commandcode"`, `model: "deepseek/deepseek-v4-pro"`), but
  // graph/rate-table.mjs prices the Command Code pair under its OWN id,
  // `commandcode/deepseek-v4-pro`/`-flash` (pricing is per PROVIDER endpoint,
  // not per underlying model -- that file's own header). Unremapped,
  // `costOf(last.model, ...)` throws `no rate for model
  // 'deepseek/deepseek-v4-pro'` on every real Command Code review.
  const pricedModel = last.provider === 'commandcode' ? `commandcode/${last.model.replace(/^deepseek\//, '')}` : last.model;

  return {
    // Command Code and native DeepSeek are different billing relationships
    // (README, same section) even when the underlying model is identical, so
    // the vendor the rate table actually priced against travels with the
    // line -- never a fixed 'pi-deepseek' regardless of which one ran.
    vendor: RATE_TABLE.models[pricedModel]?.vendor ?? 'pi-deepseek',
    provider: last.provider ?? null,
    model: last.model,
    tokens,
    totalTokens: tokenTotal(tokens, totalTokens),
    peakContext,
    startedAt,
    endedAt,
    minutes: minutesBetween(startedAt, endedAt),
    // Priced at DeepSeek's published rate for the hour the run started, which
    // is the cautious figure: see the rate table's own header.
    usd: costOf(pricedModel, tokens, { at: new Date(startedAt) }),
    lowerBound: false,
  };
}

// ---------------------------------------------------------------------------
// Gemini, through the Antigravity CLI -- an ALLOWANCE, not a token bill
// ---------------------------------------------------------------------------

// Two `/usage` readings, one taken before the worker was started and one after
// it reported, differenced per bucket. `before`/`after` are
// `{ <bucket id>: { remaining, resetTime } }` -- which is what ./cost-read.mjs's
// `geminiAllowanceFromUsage` pulls out of agy's own answer.
//
// THE RESET TIME IS THERE FOR ONE REASON. A bucket's window can roll over in
// the middle of a run -- agy's 5-hour limit does so every five hours -- and the
// two readings then measure different windows, so their difference is not what
// the seat spent. Subtracting anyway gives a NEGATIVE number, which clamped at
// zero reads as "this seat spent nothing": a blank cost line in a plausible
// costume, which is the one failure this whole module exists to stop. agy
// reports `reset_time` per bucket, so the rollover is a FACT, not a guess: a
// bucket whose reset time moved is reported as not measurable (`null`), and
// `assertCostLineComplete` below then requires at least one bucket that IS.
//
// WHY THERE ARE NO TOKENS ON THIS LINE. There is no token record to read: see
// graph/rate-table.mjs's `gemini-3.8-flash` entry for the search. The line says
// so in words rather than posting a zero that would read as "this seat did
// nothing"; `assertCostLineComplete` below then requires the allowance figure
// in their place, so an allowance line with NOTHING on it is still blank and
// still fails the step.
export function geminiExtractFromAllowance({ model, before, after, startedAt, endedAt } = {}) {
  if (!startedAt || !endedAt) {
    throw new Error('geminiExtractFromAllowance: a Gemini seat is timed by the controller, which starts it and sees it report -- there is no duration in anything agy writes');
  }
  if (!before || Object.keys(before).length === 0) {
    throw new Error('geminiExtractFromAllowance: no allowance reading was taken before the worker started, so nothing can be differenced -- the reading is taken at dispatch, before the agent runs');
  }
  const allowanceUsed = {};
  for (const [bucket, readingBefore] of Object.entries(before)) {
    const readingAfter = after?.[bucket];
    if (!Number.isFinite(readingAfter?.remaining)) {
      throw new Error(`geminiExtractFromAllowance: the after reading has no '${bucket}' bucket, so its allowance cannot be differenced -- refusing to guess`);
    }
    allowanceUsed[bucket] = readingAfter.resetTime === readingBefore.resetTime
      ? readingBefore.remaining - readingAfter.remaining
      : null;
  }
  return {
    vendor: 'gemini',
    billing: 'allowance',
    model,
    tokens: null,
    totalTokens: null,
    peakContext: null,
    startedAt,
    endedAt,
    minutes: minutesBetween(startedAt, endedAt),
    usd: null,
    allowanceUsed,
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
  totalTokens,
  billing = null,
  allowanceUsed = null,
  capped = false,
  failedOverTo = null,
} = {}) {
  const resolvedMinutes = minutes ?? (startedAt && endedAt ? minutesBetween(startedAt, endedAt) : null);
  if (billing === 'allowance') {
    // An allowance seat has no token record at all, so nothing here may invent
    // one -- not even by letting `usd` fall through to costOf, which refuses
    // this vendor on purpose (graph/rate-table.mjs).
    return {
      seat,
      vendor: vendor ?? RATE_TABLE.models[model]?.vendor ?? null,
      model,
      billing,
      allowanceUsed,
      tokens: null,
      totalTokens: null,
      peakContext: null,
      startedAt: startedAt ?? null,
      endedAt: endedAt ?? null,
      minutes: resolvedMinutes,
      usd: null,
      capped,
      failedOverTo,
    };
  }
  return {
    seat,
    vendor: vendor ?? RATE_TABLE.models[model]?.vendor ?? null,
    model,
    tokens,
    // The SAME function the extracts use, given the extract's own total: a
    // spread extract carries `totalTokens`, and the line must never re-derive
    // a figure the record already stated.
    totalTokens: tokenTotal(tokens, totalTokens),
    peakContext,
    startedAt: startedAt ?? null,
    endedAt: endedAt ?? null,
    minutes: resolvedMinutes,
    usd: usd ?? (model && tokens ? costOf(model, tokens, { at: startedAt ? new Date(startedAt) : new Date() }) : null),
    capped,
    failedOverTo,
  };
}

// A WORKER THAT NEVER STARTED. There is no session file to read a cost from --
// no turn began, so Claude wrote no transcript, Codex no rollout and Pi no
// message_end. The honest figure is zero, and it must be MARKED, never posted
// as a bare empty line: `neverStarted: true` is what makes
// `assertCostLineComplete` accept it, so an ordinary blank (the step-1 failure:
// figures lost because cleanup ran first) still fails exactly as before.
export function neverStartedCostLine({ seat, model = null, reason = 'no turn was ever observed to start' } = {}) {
  return {
    seat,
    neverStarted: true,
    reason,
    vendor: null,
    model,
    tokens: null,
    totalTokens: 0,
    peakContext: 0,
    minutes: 0,
    usd: 0,
    capped: false,
    failedOverTo: null,
  };
}

// A WORKER WHOSE COST READ FAILED (JUL-98 step 6, round 4). For a worker that
// is possibly running, or where reading figures threw an error, this explicit
// line names the failure reason rather than substituting a zero never-started line.
export function readFailedCostLine({ seat, model = null, reason = 'cost read failed' } = {}) {
  return {
    seat,
    readFailed: true,
    reason,
    vendor: null,
    model,
    tokens: null,
    totalTokens: null,
    peakContext: null,
    minutes: null,
    usd: null,
    capped: false,
    failedOverTo: null,
  };
}

const REQUIRED_FIELDS = ['seat', 'model', 'totalTokens', 'peakContext', 'minutes'];
// The same rule for a seat billed against an allowance: the same "no blank
// line" gate, on the figures that seat actually has. The allowance replaces the
// token fields; it does not excuse them.
const REQUIRED_ALLOWANCE_FIELDS = ['seat', 'model', 'minutes'];

// A blank cost line for any seat FAILS the step. This is the check that makes
// that true rather than hoped for.
export function assertCostLineComplete(line) {
  // The two explicit exceptions: a worker that never started spent nothing,
  // and a possibly-running worker whose figures could not be read carries an
  // explicit read-failure reason. Neither is an uncosted blank line.
  if (line?.neverStarted === true) {
    if (!line.seat) throw new Error('a never-started cost line must still name its seat');
    return line;
  }
  if (line?.readFailed === true) {
    if (!line.seat) throw new Error('a read-failed cost line must still name its seat');
    return line;
  }
  const required = line?.billing === 'allowance' ? REQUIRED_ALLOWANCE_FIELDS : REQUIRED_FIELDS;
  const blank = required.filter((field) => {
    const value = line?.[field];
    return value === null || value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value));
  });
  if (line?.billing === 'allowance') {
    // At least one bucket has to carry a real figure. A bucket whose window
    // rolled over mid-run is honestly `null` and says so on the line; a line on
    // which EVERY bucket is null has measured nothing and is blank.
    const used = Object.values(line.allowanceUsed ?? {});
    if (used.length === 0 || !used.some((value) => Number.isFinite(value))) {
      blank.push('allowanceUsed');
    }
  }
  if (blank.length > 0) {
    throw new Error(`the ${line?.seat ?? 'unnamed'} seat's cost line is blank in: ${blank.join(', ')} -- a blank cost line fails the step (JUL-98, 21 Sep: step 1's builder line came back blank because cleanup ran first)`);
  }
  return line;
}

const number = (value) => Number(value).toLocaleString('en-US');

// The one place the cap/failover note is worded, so the allowance line and the
// token line cannot drift apart.
function capNoteOf(line) {
  if (line.capped) return `hit its usage cap${line.failedOverTo ? `, failed over to ${line.failedOverTo}` : ''}`;
  return line.failedOverTo ? `failed over to ${line.failedOverTo}` : 'no cap, no failover';
}

export function formatCostLine(line) {
  assertCostLineComplete(line);
  const seat = line.seat.charAt(0).toUpperCase() + line.seat.slice(1);
  if (line.neverStarted === true) {
    return `- **${seat}** -- never started -- no turn began, so there is no session to read a cost from: 0 tokens, $0.0000 (${line.reason ?? 'no turn was ever observed to start'})`;
  }
  if (line.readFailed === true) {
    return `- **${seat}** -- cost read failed: ${line.reason ?? 'cost could not be read'}`;
  }
  if (line.billing === 'allowance') {
    const used = Object.entries(line.allowanceUsed)
      .map(([bucket, fraction]) => {
        const name = bucket.replace(/^gemini-/, '');
        return Number.isFinite(fraction)
          ? `${name} ${(fraction * 100).toFixed(2)}%`
          : `${name} not measurable (the window reset mid-run)`;
      })
      .join(', ');
    return `- **${seat}** -- ${line.model} -- allowance used: ${used} -- no token count is recorded for a ${line.vendor} seat -- ${line.minutes} min -- ${capNoteOf(line)}`;
  }
  const capNote = capNoteOf(line);
  const dollars = line.usd === null || line.usd === undefined ? 'not priced' : `$${Number(line.usd).toFixed(4)}`;
  return `- **${seat}** -- ${line.model} -- ${number(line.totalTokens)} tokens -- peak context ${number(line.peakContext)} -- ${line.minutes} min -- ${dollars} -- ${capNote}`;
}
