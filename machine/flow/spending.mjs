// The card's spending total. Every model call a card makes adds its dollars to one ledger in the
// card's own folder, and the same ledger decides when the card has spent its limit. The ledger is a
// file, not memory, so the total survives the next step, a rerun and a Studio restart.
//
// Prices come from the list the model picker uses (dashboard/lib/model-prices.js), so a peak-hour
// call costs the peak rate and a model the list cannot price stops the card before its first call.

import { join } from 'node:path';

import { costOfTokens, loadCatalog, priceFor, readCorrections } from '../../dashboard/lib/model-prices.js';
import { readLedger, writeLedger } from './card-ledger.mjs';

// Todd's per-card limit, decided 10 November 2026.
export const CARD_LIMIT_DOLLARS = 4;

// Mastra starts every tool call a model asks for unless a Lead is given a limit, and each extra
// helper is a whole model call finished after the cap was crossed. A fixed number is what lets the
// stop report state the worst overshoot: the call that crossed the limit plus this many helpers.
export const HELPER_CONCURRENCY = 4;

export const STOP_REASONS = {
  limit: 'card spending limit reached',
  unpriced: 'model unpriced',
  usage: 'usage missing',
};

// A saved choice reads `account/model`, and a CommandCode choice may carry the
// `mastracode/` prefix the picker stores. The price list knows neither prefix.
export function splitModelId(id = '') {
  const full = String(id).replace(/^mastracode\//, '');
  const at = full.indexOf('/');
  if (at < 0) return { provider: '', model: full };
  return { provider: full.slice(0, at), model: full.slice(at + 1) };
}

// Mastra's usage counts cache reads inside the input and reasoning inside the output.
export function tokensFromUsage(usage = {}) {
  const number = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const input = number(usage.inputTokens);
  const output = number(usage.outputTokens);
  const cached = number(usage.cachedInputTokens);
  const reasoning = number(usage.reasoningTokens);
  return {
    totalInput: input,
    totalOutput: output,
    inputText: Math.max(input - cached, 0),
    cacheRead: cached,
    cacheWrite: 0,
    outputText: Math.max(output - reasoning, 0),
    outputReasoning: reasoning,
  };
}

export function openSpending({ dir, limit = CARD_LIMIT_DOLLARS, catalog, corrections, now = () => new Date() } = {}) {
  let card = null;
  let file = null;
  let ledger = null;
  let lists = null;

  const priceList = () => {
    if (lists) return lists;
    lists = { catalog: catalog ?? null, corrections: corrections ?? {} };
    if (!catalog) {
      try { lists.catalog = loadCatalog(); } catch { lists.catalog = null; }
    }
    if (!corrections) {
      try { lists.corrections = readCorrections(); } catch { lists.corrections = {}; }
    }
    return lists;
  };

  const persist = () => {
    if (file) writeLedger(file, ledger);
  };

  const begin = nextCard => {
    if (ledger && card === nextCard) return ledger;
    card = nextCard;
    file = join(dir, card, 'spending.json');
    ledger = readLedger(file) ?? { card, limit, total: 0, calls: [], stop: null };
    ledger.card = card;
    ledger.limit = limit;
    return ledger;
  };

  const priceOf = ({ provider, model, at = null }) =>
    priceFor({ ...priceList(), provider, model, at });

  const stop = reason => {
    if (!ledger) return reason;
    if (!ledger.stop) {
      ledger.stop = { reason, at: now().toISOString() };
      persist();
    }
    return ledger.stop.reason;
  };

  const stopReason = () => ledger?.stop?.reason ?? null;

  // Called before a model call. A card that already stopped stays stopped, a card at its limit
  // stops now, and a model the price list cannot price stops the card before it spends anything.
  const blockingReason = ids => {
    if (!ledger) return null;
    const recorded = stopReason();
    if (recorded) return recorded;
    if (ledger.total >= limit) return stop(STOP_REASONS.limit);
    if (ids && !priceOf(ids)) return stop(STOP_REASONS.unpriced);
    return null;
  };

  // Every call that finished is counted, including the ones that finish after the cap was crossed,
  // because the provider bills them all. Only the first crossing call reports a stop, so the calls
  // already in flight are not turned into errors; the stage in front of the next agent refuses.
  const record = ({ provider, model, usage, at = now() } = {}) => {
    const missing = !usage || (!(Number(usage.inputTokens) > 0) && !(Number(usage.outputTokens) > 0));
    if (missing) return { usd: 0, stop: stop(STOP_REASONS.usage) };
    const price = priceOf({ provider, model, at });
    if (!price) return { usd: 0, stop: stop(STOP_REASONS.unpriced) };
    const tokens = tokensFromUsage(usage);
    const { usd, peak } = costOfTokens({ price, tokens });
    const alreadyStopped = Boolean(ledger.stop);
    ledger.total += usd;
    ledger.calls.push({
      at: at.toISOString(),
      provider,
      model,
      usd,
      peak,
      inputTokens: tokens.totalInput,
      outputTokens: tokens.totalOutput,
      cacheReadTokens: tokens.cacheRead,
    });
    persist();
    if (alreadyStopped) return { usd, stop: null };
    const overLimit = ledger.total >= limit ? stop(STOP_REASONS.limit) : null;
    return { usd, stop: overLimit };
  };

  return {
    begin,
    priceOf,
    record,
    stop,
    stopReason,
    blockingReason,
    get card() { return card; },
    get started() { return Boolean(ledger); },
    get limit() { return limit; },
    get total() { return ledger?.total ?? 0; },
    get calls() { return ledger?.calls ?? []; },
    get file() { return file; },
  };
}

// The model handed to a helper is read from the saved pick, so this reader runs at each call.
function idsOf(ids, model) {
  const saved = typeof ids === 'function' ? ids() : ids;
  if (saved && saved.model) return saved;
  return { provider: model?.provider ?? '', model: model?.modelId ?? '' };
}

// A stopped card starts no new helper. The hook runs before the helper does, and what it throws
// comes back to the Lead as a failed tool call, so the run ends at its next stage with the reason
// instead of paying for helpers it can no longer afford.
export function helperStartHook(spending) {
  return {
    beforeToolCall(call) {
      if (!call?.toolName?.startsWith('agent-')) return;
      const reason = spending.stopReason();
      if (reason) throw new Error(reason);
    },
  };
}

// A Mastra input/output processor. The input step remembers which model the call will use, and
// the output step adds the call's dollars to the ledger and stops the card when that call spent
// the last of its limit or came back without usage. The input step does not refuse the call: a
// refusal at that point leaves the agent as a TripWire, which fails the whole workflow with no
// stop report. A card that is already out of money is turned away by the stage before the agent.
// The Lead is the one exception. It runs its own loop, so the stage cannot turn away the next
// model call it makes after the card stopped, and that call would be paid for outside the limit.
// Its processor refuses that call, and the build step reads the stop as the end of the build.
export function spendingProcessor(spending, ids = null, { refuseAfterStop = false } = {}) {
  let called = null;
  return {
    id: 'card-spending',
    processInputStep: async ({ model, abort }) => {
      called = model ?? null;
      const reason = refuseAfterStop ? spending.stopReason() : null;
      if (reason) abort(reason, { metadata: { reason } });
    },
    processOutputStep: async ({ usage, abort }) => {
      if (!spending.started) return;
      const { provider, model } = idsOf(ids, called);
      const result = spending.record({ provider, model, usage });
      if (result.stop) abort(result.stop, { metadata: { reason: result.stop } });
    },
  };
}

// Memory note-takers call their own model outside the agent's processors, so that model is
// wrapped instead. The wrapper records each call's usage and leaves the answer untouched.
export function meteredModel(model, { spending, provider, model: name }) {
  const record = usage => {
    if (!spending.started) return;
    spending.record({ provider, model: name, usage });
  };
  const wrapStream = async (...args) => {
    const result = await model.doStream(...args);
    const [pass, tap] = result.stream.tee();
    const drain = async reader => {
      const { done, value } = await reader.read();
      if (done) return;
      if (value?.type === 'finish' || value?.type === 'finish-step') record(value.usage ?? value.totalUsage);
      await drain(reader);
    };
    drain(tap.getReader()).catch(() => {
      // A broken copy of the stream changes no answer, so it changes nothing here either.
    });
    return { ...result, stream: pass };
  };
  const wrapGenerate = async (...args) => {
    const result = await model.doGenerate(...args);
    record(result?.usage);
    return result;
  };
  return new Proxy(model, {
    get(target, key) {
      if (key === 'doStream') return wrapStream;
      if (key === 'doGenerate') return wrapGenerate;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
