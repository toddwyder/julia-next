import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const defaultPrices = JSON.parse(readFileSync(new URL('./prices.json', import.meta.url), 'utf8'));
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
  let abortController = new AbortController();
  let ownsLock = false;
  let timer;
  let settle;
  let accounting = Promise.resolve();
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
  function wake() { clearTimeout(timer); settle?.(); settle = undefined; }
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
      if (record.phase === 'calling') refuse('unresolved_previous_call', { pending: record.pending });
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
  function begin({ model, role, modelId = model, provider } = {}) {
    assertStart();
    if (record.phase === 'calling') refuse('unrecorded_call_cost', { pending: record.pending });
    if (!Object.hasOwn(prices, model ?? '')) refuse('no_price', { model: model ?? null, role: role ?? null });
    try { priceUsage({ inputTokens: 0, outputTokens: 0 }, prices[model]); }
    catch (error) { refuse(error.message, { model, role }); }
    if (!role || !modelId) refuse('missing_call_identity', { model, role: role ?? null });
    record.phase = 'calling';
    record.pending = { id: randomUUID(), model, role, modelId, provider, startedAt: new Date().toISOString() };
    accounting = new Promise(resolve => { settle = resolve; });
    save();
    return { ...record.pending };
  }
  function recordSpan(span) {
    if ((span?.type ?? span?.spanType) !== 'model_inference' || !span.endTime) return;
    const spanId = span.id ?? span.spanId;
    if (existsSync(stopPath) && record.phase !== 'stopped') {
      record = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : record;
      record.phase = 'stopped'; record.stop = JSON.parse(readFileSync(stopPath, 'utf8'));
    }
    if (spanId && record.calls.some(call => call.spanId === spanId)) return;
    if (record.phase === 'stopped' && !record.pending) return;
    const alreadyStopped = record.phase === 'stopped';
    if (!record.pending || (!alreadyStopped && record.phase !== 'calling')) return stop('unexpected_model_call', { spanId: spanId ?? null });
    const pending = record.pending;
    const attributes = span.attributes;
    if (!spanId || !attributes || attributes.model !== pending.modelId
        || (pending.provider && attributes.provider !== pending.provider)) {
      return stop('trace_model_mismatch', { expected: pending, spanId: spanId ?? null, model: attributes?.model ?? null, provider: attributes?.provider ?? null });
    }
    if (!Object.hasOwn(prices, pending.model)) return stop('no_price', { model: pending.model, spanId });
    let cost;
    try { cost = priceUsage(attributes.usage, prices[pending.model]); }
    catch (error) { return stop(error.message, { model: pending.model, spanId, usage: attributes.usage ?? null }); }
    const call = { ...pending, spanId, traceId: span.traceId, completedAt: new Date().toISOString(), ...cost };
    record.calls.push(call);
    record.totals.tokens += cost.tokens; record.totals.dollars += cost.dollars;
    delete record.pending; record.phase = alreadyStopped ? 'stopped' : 'idle'; save(); wake();
    if (atCap()) return stop('cap_reached', { ...record.totals });
    return call;
  }
  function finish() {
    assertStart();
    if (record.pending) refuse('unrecorded_call_cost', { pending: record.pending });
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
        if (live && lock.owner !== owner && !(record.phase === 'stopped' && !record.pending)) throw new Error('Cannot clear a slice owned by a live process');
        if (live && record.phase === 'calling') throw new Error('Stop the active call before clearing');
      }
      event('clear', { reason, actor, previousStop: record.stop ?? null, previousPending: record.pending ?? null });
      record.slices.push({ calls: record.calls, totals: record.totals, stop: record.stop, pending: record.pending });
      record.calls = []; record.totals = { dollars: 0, tokens: 0 }; record.phase = 'idle';
      delete record.stop; delete record.pending; save();
      if (existsSync(lockPath)) unlinkSync(lockPath);
      ownsLock = false;
      if (existsSync(stopPath)) unlinkSync(stopPath);
      syncDirectory(); wake();
      abortController = new AbortController();
      return snapshot();
    } finally { closeSync(fd); unlinkSync(clearPath); syncDirectory(); }
  }
  function snapshot() { return structuredClone({ ...record, exitCode: record.phase === 'stopped' || existsSync(stopPath) ? 1 : 0 }); }
  function armTraceDeadline() {
    if (record.phase !== 'calling') return;
    clearTimeout(timer);
    timer = setTimeout(() => stop('unrecorded_call_cost', { pending: record.pending, traceTimeoutMs }), traceTimeoutMs);

  }
  function wrapModel(model, { id, role }) {
    return new Proxy(model, { get(target, property) {
      if (property !== 'doGenerate' && property !== 'doStream') {
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async options => {
        while (record.phase === 'calling') await accounting;
        begin({ model: id, role, modelId: target.modelId, provider: target.provider });
        const signal = options?.abortSignal
          ? AbortSignal.any([options.abortSignal, abortController.signal]) : abortController.signal;
        const onAbort = () => stop('model_call_aborted', { model: id, role });
        signal.addEventListener('abort', onAbort, { once: true });
        try {
          signal.throwIfAborted();
          const result = await target[property]({ ...options, abortSignal: signal, maxRetries: 0 });
          if (property === 'doGenerate') {
            signal.removeEventListener('abort', onAbort); armTraceDeadline(); return result;
          }
          const reader = result.stream.getReader();
          return { ...result, stream: new ReadableStream({
            async pull(controller) {
              try {
                const chunk = await reader.read();
                if (chunk.done) { signal.removeEventListener('abort', onAbort); armTraceDeadline(); controller.close(); }
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
