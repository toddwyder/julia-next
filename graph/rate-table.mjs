// rate-table.mjs -- JUL-109 (UAT follow-up): what one token costs, per model, kept in the repo so a
// price change is a one-line edit with a date and a source, not a code change somewhere else.
//
// Data plus arithmetic only. No launch route, no secrets, no controller logic: the controller ticket
// that writes the per-worker cost line reads this table. A dollar figure from here is an API
// list-price equivalent. `runner` and `orchestrator-svc` sign in to Claude and Codex with
// subscription logins, which are not billed per token, so for those two seats this number is what the
// work would cost at list price, not an invoice line. DeepSeek is billed per token from a topped-up
// balance, so its figure is a real charge.
//
// Every entry says where its numbers came from and the day they were checked. Change a price by
// changing the entry and its `checkedOn`; graph/rate-table.test.mjs then re-proves the arithmetic
// against the recorded sessions in graph/fixtures/orca-1.4.205/.

export const RATE_TABLE = {
  asOf: '2026-09-20',
  unit: 'USD per million tokens',
  models: {
    // Anthropic list prices. Sonnet 5's $2 / $10 is the standard price now (introductory pricing
    // through 31 Aug 2026 became permanent; the planned $3 / $15 did not happen). Claude Code prices
    // every cache write at the 1-hour rate in its own cost record, so cacheWrite1h is the figure to
    // use when a record does not say which lifetime a write had.
    'claude-sonnet-5': {
      vendor: 'claude',
      input: 2, output: 10, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4,
      source: 'https://platform.claude.com/docs/en/about-claude/pricing',
      checkedOn: '2026-09-20',
    },
    'claude-opus-5': {
      vendor: 'claude',
      input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10,
      source: 'https://platform.claude.com/docs/en/about-claude/pricing',
      checkedOn: '2026-09-20',
    },
    'claude-haiku-4-5-20251001': {
      vendor: 'claude',
      input: 1, output: 5, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2,
      source: 'https://platform.claude.com/docs/en/about-claude/pricing',
      checkedOn: '2026-09-20',
    },
    // OpenAI list prices for the model Codex runs on the server. Codex's token record counts
    // cached_input_tokens INSIDE input_tokens (total_tokens = input_tokens + output_tokens), so
    // the uncached part is input minus cached. Above 272,000 input tokens the whole request is
    // billed at 2x input and cache rates and 1.5x output. cache_write_input_tokens is priced at
    // `cacheWrite`, treated like cached tokens (inside input_tokens); every recorded Codex session
    // has it at 0, so that placement is UNPROVEN (see `unconfirmed`).
    'gpt-6-astra': {
      vendor: 'codex',
      input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50,
      longContextThresholdTokens: 272000, longContextInputMultiplier: 2, longContextOutputMultiplier: 1.5,
      contextWindow: 258400, // model_context_window in the Codex session record
      unconfirmed: 'cache_write_input_tokens has been 0 in every recorded Codex session, so whether it sits inside input_tokens (as cached tokens do) is not proven',
      source: 'https://developers.openai.com/api/docs/models/gpt-6-astra',
      checkedOn: '2026-09-20',
    },
    // DeepSeek, from DeepSeek's own price page. Peak hours are 01:00-04:00 and 06:00-10:00 UTC,
    // Monday to Friday (Chinese public holidays are off-peak but this table does not know them, so
    // it can only overstate on such a day); every other hour is off-peak, at half the peak price.
    // Pi prints usage.cost.total from ONE of two price lists, and which one depends on the model id:
    //   `piRegistry`   Pi's built-in list. Used for ids Pi's model store does not name (deepseek-v4-flash),
    //                  and for everything before the store existed (20 Sep 2026, 20:35Z).
    //   `piModelStore` ~/.pi/agent/models-store.json, which Pi fetches from DeepSeek on a run and
    //                  which then overrides the built-in list for the ids it names (deepseek-v4-pro).
    //                  Its numbers are DeepSeek's published PEAK price, applied at every hour.
    // Neither matches what DeepSeek actually charged: on the PR #65 review run the account balance fell
    // about $0.09 while Pi printed $0.22 and the published price gives about $0.11 to $0.16. Cost lines
    // use the published price (the cautious, higher figure than the balance showed) and say so; see
    // the findings record, section 5.
    'deepseek-v4-pro': {
      vendor: 'pi-deepseek',
      offPeak: { input: 0.66, output: 1.98, cacheRead: 0.022 },
      peak: { input: 1.32, output: 3.96, cacheRead: 0.044 },
      piRegistry: { input: 0.435, output: 0.87, cacheRead: 0.003625 },
      piModelStore: { input: 1.32, output: 3.96, cacheRead: 0.044 },
      contextWindow: 1000000,
      source: 'https://api-docs.deepseek.com/quick_start/pricing (page lists it as deepseek-v4-pro); Pi registry: pi-ai providers/data/deepseek.json; Pi model store: ~/.pi/agent/models-store.json',
      checkedOn: '2026-09-20',
    },
    'deepseek-v4-flash': {
      vendor: 'pi-deepseek',
      offPeak: { input: 0.15, output: 0.6, cacheRead: 0.003 },
      peak: { input: 0.3, output: 1.2, cacheRead: 0.006 },
      piRegistry: { input: 0.14, output: 0.28, cacheRead: 0.0028 },
      contextWindow: 1000000,
      // The page names this model `deepseek-flash` (DeepSeek-V4.1-Flash). Our seat id is
      // `deepseek-v4-flash`. That they are the same billed model is NOT confirmed.
      unconfirmed: 'DeepSeek page lists deepseek-flash; treating it as our deepseek-v4-flash id is unconfirmed',
      source: 'https://api-docs.deepseek.com/quick_start/pricing; Pi registry: pi-ai providers/data/deepseek.json',
      checkedOn: '2026-09-20',
    },
    // Command Code's GOAT plan (JUL-98, Todd's 13:43Z + 15:01:54Z Decisions):
    // the reviewer's DeepSeek route, both the real review (Pro) and the
    // Flash shadow. Own entries, own vendor -- Command Code is a distinct
    // gateway from native DeepSeek (its own `/models` listing uses the
    // namespaced id `deepseek/deepseek-v4-pro`, and the bare native-spelled
    // id 400s there), so a price divergence between the two providers must
    // never silently blend into one number. As of this check the published
    // numbers are IDENTICAL to native DeepSeek's own list price and share
    // the same peak/off-peak schedule -- Command Code passes the underlying
    // vendor's price straight through rather than adding its own markup, at
    // least for these two models. Costed the same way as `pi-deepseek`
    // (see `costOf`'s `commandcode` branch) until the first real review's
    // figure is checked against the Command Code dashboard, per the
    // 15:01:54Z Decision.
    'commandcode/deepseek-v4-pro': {
      vendor: 'commandcode',
      offPeak: { input: 0.66, output: 1.98, cacheRead: 0.02 },
      peak: { input: 1.32, output: 3.96, cacheRead: 0.04 },
      contextWindow: 1000000,
      source: 'https://commandcode.ai/models/deepseek-v4-pro',
      checkedOn: '2026-09-22',
    },
    'commandcode/deepseek-v4-flash': {
      vendor: 'commandcode',
      offPeak: { input: 0.15, output: 0.6, cacheRead: 0.003 },
      peak: { input: 0.3, output: 1.2, cacheRead: 0.006 },
      contextWindow: 1000000,
      source: 'https://commandcode.ai/models/deepseek-v4-flash',
      checkedOn: '2026-09-22',
    },
  },
};

export function isDeepseekPeak(at) {
  const d = at instanceof Date ? at : new Date(at);
  const day = d.getUTCDay(); // 0 Sunday .. 6 Saturday
  if (day === 0 || day === 6) return false;
  const h = d.getUTCHours();
  return (h >= 1 && h < 4) || (h >= 6 && h < 10);
}

const PER = 1e6;

// usage, by vendor (use the field names the vendor's own record uses, mapped once here):
//   claude       { input, output, cacheRead, cacheWrite5m, cacheWrite1h }   (input excludes cache)
//   codex        { input, cachedInput, cacheWrite, output }                  (input INCLUDES both)
//   pi-deepseek  { input, output, cacheRead }                                (input excludes cache)
// `at` (a Date or timestamp) picks DeepSeek's peak or off-peak rate; pass the run's start time.
export function costOf(model, usage = {}, { at = new Date() } = {}) {
  const r = RATE_TABLE.models[model];
  if (!r) throw new Error(`costOf: no rate for model '${model}' in graph/rate-table.mjs`);
  const n = (k) => usage[k] ?? 0;
  if (r.vendor === 'claude') {
    return (n('input') * r.input + n('output') * r.output + n('cacheRead') * r.cacheRead
      + n('cacheWrite5m') * r.cacheWrite5m + n('cacheWrite1h') * r.cacheWrite1h) / PER;
  }
  if (r.vendor === 'codex') {
    const long = n('input') > r.longContextThresholdTokens;
    const inMul = long ? r.longContextInputMultiplier : 1;
    const outMul = long ? r.longContextOutputMultiplier : 1;
    const uncached = n('input') - n('cachedInput') - n('cacheWrite');
    return (uncached * r.input * inMul + n('cachedInput') * r.cachedInput * inMul
      + n('cacheWrite') * r.cacheWrite * inMul + n('output') * r.output * outMul) / PER;
  }
  if (r.vendor === 'pi-deepseek' || r.vendor === 'commandcode') {
    const t = isDeepseekPeak(at) ? r.peak : r.offPeak;
    return (n('input') * t.input + n('output') * t.output + n('cacheRead') * t.cacheRead) / PER;
  }
  throw new Error(`costOf: unknown vendor '${r.vendor}' for model '${model}'`);
}

// What Pi itself prints as usage.cost.total. `source` is 'registry' (Pi's built-in list) or 'store'
// (Pi's fetched model store, which overrides the built-in list for the ids it names). Used only to show
// how far Pi's figure is from the published price and from the account balance.
export function piReportedCostOf(model, usage = {}, { source = 'registry' } = {}) {
  const r = RATE_TABLE.models[model];
  const rates = source === 'store' ? r?.piModelStore : r?.piRegistry;
  if (!rates) throw new Error(`piReportedCostOf: no Pi ${source} rate for '${model}'`);
  const n = (k) => usage[k] ?? 0;
  return (n('input') * rates.input + n('output') * rates.output + n('cacheRead') * rates.cacheRead) / PER;
}

// One Claude session transcript -> usage per model, counting each message id ONCE.
//
// TAKES THE TRANSCRIPT EITHER WAY: already-parsed objects, or the raw JSONL text lines as they come
// off disk. It used to take only the first, and a `.jsonl` file is read as STRINGS: `l.type` on a
// string is `undefined`, so every line was skipped and the answer was an EMPTY OBJECT, silently.
// Measured on 21 Sep against the real transcript of this card's own step-3 attempt-1 builder (777
// lines, 133 of them claude-opus-5 assistant lines): {}. That silent empty is why every builder cost
// line on JUL-98 read "not captured", and a blank cost line fails the step. A line that will not
// parse is skipped (a transcript being written can end mid-line); a line that parses is read as before.
// A transcript writes one line per content block, so a message with a text block and a tool call
// appears twice with identical usage; summing lines double-counts (the PR #64 mistake). A cache write
// with no lifetime split is counted at the 1-hour rate, which is what Claude Code's own record does.
// The result is a lower bound on the session's cost: Claude Code makes calls the transcript omits.
// The ONE place a transcript's lines are turned into objects, so every reader of a transcript takes
// it the same way: parsed objects pass through, raw JSONL text is parsed, an unparseable line is
// dropped (a transcript being written can end mid-line).
export function parseTranscriptLines(lines) {
  const out = [];
  for (const raw of lines ?? []) {
    if (typeof raw !== 'string') { out.push(raw); continue; }
    try { out.push(JSON.parse(raw)); } catch { /* a half-written last line is not usage */ }
  }
  return out;
}

export function claudeUsageFromTranscript(lines) {
  const byId = new Map();
  for (const l of parseTranscriptLines(lines)) {
    if (l?.type !== 'assistant' || !l.message?.id || !l.message.usage) continue;
    if (l.message.model === '<synthetic>') continue;
    byId.set(l.message.id, l.message);
  }
  const out = {};
  for (const m of byId.values()) {
    const u = m.usage;
    const split = u.cache_creation;
    const t = out[m.model] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, messages: 0 };
    t.input += u.input_tokens ?? 0;
    t.output += u.output_tokens ?? 0;
    t.cacheRead += u.cache_read_input_tokens ?? 0;
    if (split) {
      t.cacheWrite5m += split.ephemeral_5m_input_tokens ?? 0;
      t.cacheWrite1h += split.ephemeral_1h_input_tokens ?? 0;
    } else {
      t.cacheWrite1h += u.cache_creation_input_tokens ?? 0;
    }
    t.messages += 1;
  }
  return out;
}

// Peak context for any vendor: the largest prompt any one model call carried. Each call's
// prompt = uncached input + cached input (read + written); output is not part of the prompt. Takes
// each vendor's own cache-write field names: cacheWrite (Pi, Codex) or cacheWrite5m/cacheWrite1h (Claude).
// For Codex pass last_token_usage.input_tokens as `input`: it already includes the cached part.
export function peakPromptTokens(calls) {
  return Math.max(0, ...calls.map((c) => (c.input ?? 0) + (c.cacheRead ?? 0) + (c.cacheWrite ?? 0)
    + (c.cacheWrite5m ?? 0) + (c.cacheWrite1h ?? 0)));
}
