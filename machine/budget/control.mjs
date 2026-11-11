import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mastraPrice } from './mastra-prices.mjs';

function loadDefaultPrices() {
  const local = new URL('./prices.json', import.meta.url);
  if (existsSync(local)) return JSON.parse(readFileSync(local, 'utf8'));
  const bundled = new URL('../../machine/budget/prices.json', import.meta.url);
  if (existsSync(bundled)) return JSON.parse(readFileSync(bundled, 'utf8'));
  return {};
}
const defaultPrices = loadDefaultPrices();
const validNumber = value => Number.isSafeInteger(value) && value >= 0;

export function priceUsage(usage, price) {
  const inputTokens = usage?.inputTokens;
  const outputTokens = usage?.outputTokens;
  const cachedInputTokens = usage?.inputDetails?.cacheRead === undefined ? 0 : usage.inputDetails.cacheRead;
  const cacheWriteTokens = usage?.inputDetails?.cacheWrite === undefined ? 0 : usage.inputDetails.cacheWrite;
  const reasoningTokens = usage?.outputDetails?.reasoning === undefined ? 0 : usage.outputDetails.reasoning;
  if (![inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens, reasoningTokens].every(validNumber)
      || cachedInputTokens + cacheWriteTokens > inputTokens || reasoningTokens > outputTokens
      || !Number.isSafeInteger(inputTokens + outputTokens)) throw new Error('invalid_trace_usage');
  for (const key of ['input', 'cachedInput', 'cacheWrite', 'output']) {
    if (!Number.isFinite(price?.[key]) || price[key] < 0) throw new Error('invalid_price_entry');
  }
  if (price.longInputThreshold !== undefined && (!validNumber(price.longInputThreshold)
      || ![price.longInputMultiplier, price.longOutputMultiplier].every(n => Number.isFinite(n) && n > 0))) throw new Error('invalid_price_entry');
  const longInput = price.longInputThreshold !== undefined && inputTokens > price.longInputThreshold;
  const inputMultiplier = longInput ? price.longInputMultiplier : 1;
  const outputMultiplier = longInput ? price.longOutputMultiplier : 1;
  if (![inputMultiplier, outputMultiplier].every(n => Number.isFinite(n) && n > 0)) throw new Error('invalid_price_entry');
  const dollars = (((inputTokens - cachedInputTokens - cacheWriteTokens) * price.input
    + cachedInputTokens * price.cachedInput + cacheWriteTokens * price.cacheWrite) * inputMultiplier
    + outputTokens * price.output * outputMultiplier) / 1e6;
  if (!Number.isFinite(dollars)) throw new Error('invalid_trace_cost');
  return { inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens, reasoningTokens,
    tokens: inputTokens + outputTokens, dollars, longInput };
}

export function createSliceControl({ directory, dollarCap, tokenCap, prices = defaultPrices, traceTimeoutMs = 5000 }) {
  if (!directory) throw new Error('A server-wide budget directory is required');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const recordPath = join(directory, 'record.json');
  const lockPath = join(directory, 'active.lock');
  const stopPath = join(directory, 'stop.lock');
  const clearPath = join(directory, 'clear.lock');
  const latchLockPath = join(directory, 'latch.lock');
  const owner = randomUUID();
  // Todd's dated entries in prices.json win. Any other model is priced from Mastra's built-in table. A model in neither is refused.
  const priceFor = model => (Object.hasOwn(prices, model ?? '') ? prices[model] : mastraPrice(model ?? ''));
  let abortController = new AbortController();
  let ownsLock = false;
  const timers = new Map();
  let record = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : {
    phase: 'idle', calls: [], totals: { dollars: 0, tokens: 0 }, events: [], slices: [],
  };
  function syncDirectory() {
    const fd = openSync(directory, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }
  function atomic(path, value) {
    const temporary = `${path}.${owner}.tmp`;
    const fd = openSync(temporary, 'w', 0o600);
    try { writeFileSync(fd, JSON.stringify(value, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path); syncDirectory();
  }
  function save() { atomic(recordPath, record); }
  function withLatchLock(fn) {
    const deadline = Date.now() + 5000;
    while (true) {
      try {
        const fd = openSync(latchLockPath, 'wx', 0o600);
        closeSync(fd);
        break;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        if (Date.now() > deadline) throw new Error('latch_lock_timeout');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
    }
    try {
      return fn();
    } finally {
      try { unlinkSync(latchLockPath); syncDirectory(); } catch {}
    }
  }
  function event(kind, detail = {}) { record.events.push({ kind, at: new Date().toISOString(), ...detail }); }
  function release() {
    if (ownsLock) { unlinkSync(lockPath); syncDirectory(); ownsLock = false; }
  }
  function wake() { for (const timer of timers.values()) clearTimeout(timer); timers.clear(); }
  function stop(reason, numbers = {}) {
    if (!ownsLock && existsSync(recordPath)) record = JSON.parse(readFileSync(recordPath, 'utf8'));
    if (existsSync(stopPath)) {
      record = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : record;
      record.phase = 'stopped'; record.stop = JSON.parse(readFileSync(stopPath, 'utf8')); save();
      wake();
      if (!abortController.signal.aborted) abortController.abort(new Error(record.stop?.reason ?? reason));
      return snapshot();
    }
    withLatchLock(() => {
      record.phase = 'stopped';
      record.stop = { reason, numbers, totals: { ...record.totals }, dollarCap: record.dollarCap ?? dollarCap,
        tokenCap: record.tokenCap ?? tokenCap, at: new Date().toISOString() };
      event('stop', record.stop);
      // The latch is written first. A crash before the detailed record still refuses admission.
      atomic(stopPath, record.stop);
      save();
    });
    wake();
    if (!abortController.signal.aborted) abortController.abort(new Error(reason));
    return snapshot();
  }
  function refuse(reason, numbers) { stop(reason, numbers); throw new Error(reason); }
  function atCap() {
    // A conservative roundoff allowance prevents an extra call at an exhausted dollar cap.
    const rounding = Number.EPSILON * Math.max(record.totals.dollars, dollarCap) * Math.max(1, record.calls.length);
    return dollarCap - record.totals.dollars <= rounding || record.totals.tokens >= tokenCap;
  }
  function assertStart() {
    if (existsSync(clearPath)) throw new Error('slice_clear_in_progress');
    if (existsSync(stopPath)) throw new Error(`slice_stopped: ${JSON.parse(readFileSync(stopPath, 'utf8')).reason}`);
    if (record.phase === 'stopped') throw new Error(`slice_stopped: ${record.stop?.reason}`);
    if (!ownsLock) {
      let fd;
      try { fd = openSync(lockPath, 'wx', 0o600); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
        try { process.kill(lock.pid, 0); }
        catch (failure) {
          if (failure.code === 'ESRCH') refuse('interrupted_slice', { previousOwner: lock.owner, previousPid: lock.pid });
          throw failure;
        }
        throw new Error('slice_locked: an active or interrupted slice must be explicitly cleared');
      }
      try { writeFileSync(fd, JSON.stringify({ owner, pid: process.pid, at: new Date().toISOString() })); fsyncSync(fd); }
      finally { closeSync(fd); }
      ownsLock = true; syncDirectory();
      // Recheck after acquiring: a competing reset or stop may have begun.
      if (existsSync(clearPath)) { release(); throw new Error('slice_clear_in_progress'); }
      if (existsSync(stopPath)) { release(); throw new Error('slice_stopped'); }
      record = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : record;
      if (record.phase === 'calling') refuse('unresolved_previous_call', { pending: record.reservations });
      if (record.phase === 'finished') {
        record.slices.push({ calls: record.calls, totals: record.totals, dollarCap: record.dollarCap, tokenCap: record.tokenCap });
        record.calls = []; record.totals = { dollars: 0, tokens: 0 };
      }
      withLatchLock(() => {
        if (existsSync(stopPath) || record.phase === 'stopped') { release(); throw new Error('slice_stopped'); }
        record.phase = 'idle'; record.dollarCap = dollarCap; record.tokenCap = tokenCap;
        event('slice_start', { owner, dollarCap, tokenCap }); save();
      });
    }
    if (!Number.isFinite(dollarCap) || dollarCap <= 0 || !Number.isSafeInteger(tokenCap) || tokenCap <= 0) {
      refuse('missing_or_invalid_caps', { dollarCap: dollarCap ?? null, tokenCap: tokenCap ?? null });
    }
    if (atCap()) refuse('cap_reached', { ...record.totals });
    return snapshot();
  }
  function reserved() {
    const list = record.reservations ?? [];
    return { tokens: list.reduce((n, r) => n + r.worstTokens, 0), dollars: list.reduce((n, r) => n + r.worstDollars, 0) };
  }
  function begin({ model, role, modelId = model, provider, inputTokens = 0, maxOutputTokens } = {}) {
    assertStart();
    const price = priceFor(model);
    if (!price) refuse('no_price', { model: model ?? null, role: role ?? null });
    try { priceUsage({ inputTokens: 0, outputTokens: 0 }, price); }
    catch (error) { refuse(error.message, { model, role }); }
    if (!role || !modelId) refuse('missing_call_identity', { model, role: role ?? null });
    if (!validNumber(inputTokens)) refuse('invalid_input_estimate', { model, role, inputTokens: inputTokens ?? null });

    // Todd, 9 Nov 2026: caps stay hard. Admit only if spent + already reserved + this call's worst case fits under both caps.
    // The limit sent to the provider is the largest output that fits (OpenAI max_completion_tokens bounds visible and reasoning tokens).
    const held = reserved();
    const longInput = price.longInputThreshold !== undefined && inputTokens > price.longInputThreshold;
    const inputMultiplier = longInput ? price.longInputMultiplier : 1;
    const outputMultiplier = longInput ? price.longOutputMultiplier : 1;
    const inputRate = Math.max(price.input, price.cachedInput, price.cacheWrite) * inputMultiplier;
    const inputDollars = inputTokens * inputRate / 1e6;
    const roomTokens = tokenCap - record.totals.tokens - held.tokens - inputTokens;
    const roomDollars = dollarCap - record.totals.dollars - held.dollars - inputDollars;
    const outputRate = price.output * outputMultiplier;
    const byDollars = outputRate > 0 ? Math.floor(roomDollars * 1e6 / outputRate + 1e-6) : Infinity;
    const limits = [roomTokens, byDollars];
    if (price.maxOutputTokens !== undefined) limits.push(price.maxOutputTokens);
    if (maxOutputTokens !== undefined) limits.push(maxOutputTokens);
    const limit = Math.min(...limits);
    if (!Number.isSafeInteger(limit) || limit < 1) {
      refuse('no_room_under_caps', { ...record.totals, reserved: held, inputTokens, roomTokens, roomDollars });
    }
    const worstTokens = inputTokens + limit;
    const worstDollars = inputDollars + limit * outputRate / 1e6;

    const reservation = { id: randomUUID(), model, role, modelId, provider, startedAt: new Date().toISOString(),
      inputTokens, maxOutputTokens: limit, worstTokens, worstDollars };
    (record.reservations ??= []).push(reservation);
    record.phase = 'calling';
    save();
    return { ...reservation };
  }
  function recordSpan(span) {
    if ((span?.type ?? span?.spanType) !== 'model_inference' || !span.endTime) return;
    const spanId = span.id ?? span.spanId;
    if (existsSync(stopPath) && record.phase !== 'stopped') {
      record = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : record;
      record.phase = 'stopped'; record.stop = JSON.parse(readFileSync(stopPath, 'utf8'));
    }
    if (spanId && record.calls.some(call => call.spanId === spanId)) return;
    const waiting = record.reservations ?? [];
    if (record.phase === 'stopped' && waiting.length === 0) return;
    const alreadyStopped = record.phase === 'stopped';
    if (waiting.length === 0 || (!alreadyStopped && record.phase !== 'calling')) return stop('unexpected_model_call', { spanId: spanId ?? null });
    const attributes = span.attributes;
    const candidates = waiting.filter(r => attributes && spanId && attributes.model === r.modelId
      && (!r.provider || attributes.provider === r.provider));
    if (candidates.length === 0) {
      return stop('trace_model_mismatch', { expected: waiting[0], spanId: spanId ?? null, model: attributes?.model ?? null, provider: attributes?.provider ?? null });
    }
    // A span only exists once its call returned, so prefer finished calls, then the smallest reservation that covers the usage.
    let pending;
    let cost;
    try { cost = priceUsage(attributes.usage, priceFor(candidates[0].model)); }
    catch (error) { return stop(error.message, { model: candidates[0].model, spanId, usage: attributes.usage ?? null }); }
    const covers = r => cost.tokens <= r.worstTokens && cost.dollars <= r.worstDollars * (1 + 1e-9);
    const order = [...candidates].sort((x, y) => (Boolean(y.finished) - Boolean(x.finished)) || (x.worstTokens - y.worstTokens));
    pending = order.find(covers) ?? order[0];
    if (!priceFor(pending.model)) return stop('no_price', { model: pending.model, spanId });
    const call = { ...pending, spanId, traceId: span.traceId, completedAt: new Date().toISOString(), ...cost };
    delete call.finished;
    record.calls.push(call);
    record.totals.tokens += cost.tokens; record.totals.dollars += cost.dollars;
    record.reservations = waiting.filter(r => r.id !== pending.id);
    clearTimeout(timers.get(pending.id)); timers.delete(pending.id);
    record.phase = record.reservations.length > 0 ? 'calling' : (alreadyStopped ? 'stopped' : 'idle');
    save();
    if (!covers(pending)) return stop('usage_exceeded_reservation', { reservation: pending, usage: cost });
    if (atCap()) return stop('cap_reached', { ...record.totals });
    return call;
  }
  function finish() {
    assertStart();
    if ((record.reservations ?? []).length > 0) refuse('unrecorded_call_cost', { pending: record.reservations });
    record.phase = 'finished'; event('slice_finish', { totals: { ...record.totals } }); save(); release();
    return snapshot();
  }
  function clear({ reason, actor } = {}) {
    if (!reason?.trim() || !actor?.trim()) throw new Error('Clearing requires a reason and actor');
    const fd = openSync(clearPath, 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify({ owner, pid: process.pid })); fsyncSync(fd); syncDirectory();
      record = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : record;
      // Two clears must not race to delete a newly admitted process's lock.
      if (existsSync(lockPath)) {
        const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
        let live = true;
        try { process.kill(lock.pid, 0); } catch (error) { if (error.code === 'ESRCH') live = false; else throw error; }
        if (live && lock.owner !== owner && !(record.phase === 'stopped' && !(record.reservations ?? []).length)) throw new Error('Cannot clear a slice owned by a live process');
        if (live && record.phase === 'calling') throw new Error('Stop the active call before clearing');
      }
      event('clear', { reason, actor, previousStop: record.stop ?? null, previousPending: record.reservations ?? null });
      record.slices.push({ calls: record.calls, totals: record.totals, stop: record.stop, pending: record.reservations });
      record.calls = []; record.totals = { dollars: 0, tokens: 0 }; record.phase = 'idle';
      delete record.stop; delete record.reservations; save();
      if (existsSync(lockPath)) unlinkSync(lockPath);
      ownsLock = false;
      if (existsSync(stopPath)) unlinkSync(stopPath);
      syncDirectory(); wake();
      abortController = new AbortController();
      return snapshot();
    } finally { closeSync(fd); unlinkSync(clearPath); syncDirectory(); }
  }
  function snapshot() { return structuredClone({ ...record, exitCode: record.phase === 'stopped' || existsSync(stopPath) ? 1 : 0 }); }
  function armTraceDeadline(id) {
    const reservation = (record.reservations ?? []).find(r => r.id === id);
    if (!reservation) return;
    reservation.finished = true;
    const timer = setTimeout(() => {
      const open = (record.reservations ?? []).find(r => r.id === id);
      if (open) stop('unrecorded_call_cost', { pending: open, traceTimeoutMs });
    }, traceTimeoutMs);
    timer.unref();
    timers.set(id, timer);
  }
  // UTF-8 bytes bound the token count of any byte-level tokenizer, so this never underestimates the prompt.
  function estimateInputTokens(options) {
    const { abortSignal, ...request } = options ?? {};
    const text = JSON.stringify(request, (key, value) => (value instanceof Uint8Array ? Buffer.from(value).toString('base64') : value));
    const messages = Array.isArray(options?.prompt) ? options.prompt.length : 0;
    return Buffer.byteLength(text ?? '', 'utf8') + 16 * messages + 64;
  }
  function wrapModel(model, { id, role }) {
    return new Proxy(model, { get(target, property) {
      if (property !== 'doGenerate' && property !== 'doStream') {
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async options => {
        const requested = options?.maxOutputTokens;
        const reservation = begin({
          model: id,
          role,
          modelId: target.modelId,
          provider: target.provider,
          inputTokens: estimateInputTokens(options),
          maxOutputTokens: Number.isSafeInteger(requested) && requested >= 0 ? requested : undefined,
        });
        const signal = options?.abortSignal
          ? AbortSignal.any([options.abortSignal, abortController.signal]) : abortController.signal;
        const onAbort = () => stop('model_call_aborted', { model: id, role });
        signal.addEventListener('abort', onAbort, { once: true });
        try {
          signal.throwIfAborted();
          const result = await target[property]({ ...options, abortSignal: signal, maxRetries: 0, maxOutputTokens: reservation.maxOutputTokens });
          if (property === 'doGenerate') {
            signal.removeEventListener('abort', onAbort); armTraceDeadline(reservation.id); return result;
          }
          const reader = result.stream.getReader();
          return { ...result, stream: new ReadableStream({
            async pull(controller) {
              try {
                const chunk = await reader.read();
                if (chunk.done) { signal.removeEventListener('abort', onAbort); armTraceDeadline(reservation.id); controller.close(); }
                else controller.enqueue(chunk.value);
              } catch (error) { stop('model_stream_failed', { model: id, role, error: error.name }); controller.error(error); }
            },
            async cancel(reason) {
              signal.removeEventListener('abort', onAbort);
              stop('model_stream_cancelled', { model: id, role });
              await reader.cancel(reason);
            },
          }) };
        } catch (error) {
          signal.removeEventListener('abort', onAbort);
          stop('model_call_failed', { model: id, role, error: error.name });
          throw error;
        }
      };
    } });
  }
  return { begin, recordSpan, stop, clear, assertStart, finish, wrapModel, snapshot,
    get signal() { return abortController.signal; }, recordPath, lockPath, stopPath };
}
