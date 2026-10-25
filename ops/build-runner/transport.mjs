const protocols = new Set(['chat', 'responses', 'messages']);
const categories = ['input', 'output', 'cacheRead', 'cacheWrite'];
const zeroPrice = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const fail = message => new Error(message);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
function charge(tokens, rate, exact = false) {
  const [coefficient, exponent = '0'] = String(rate).split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  const scale = fraction.length - Number(exponent);
  const numerator = BigInt(tokens) * BigInt(whole + fraction) * 1000n;
  if (exact) return { numerator, scale };
  if (scale <= 0) return Number(numerator * 10n ** BigInt(-scale));
  const denominator = 10n ** BigInt(scale);
  return Number((numerator + denominator - 1n) / denominator);
}

function normalPrice(price) {
  if (!object(price)) return zeroPrice;
  return Object.fromEntries(categories.map(key => [key, Number.isFinite(price[key]) && price[key] >= 0 ? price[key] : 0]));
}

function totalCharge(usage, price) {
  const parts = categories.map(key => charge(usage[key], price[key], true));
  const scale = Math.max(0, ...parts.map(part => part.scale));
  const numerator = parts.reduce((sum, part) => sum + part.numerator * 10n ** BigInt(scale - part.scale), 0n);
  const denominator = 10n ** BigInt(scale);
  return Number((numerator + denominator - 1n) / denominator);
}

function configuration(settings) {
  if (!object(settings?.models)) throw fail('Invalid model configuration');
  const routes = new Map();
  for (const [model, spec] of Object.entries(settings.models)) {
    if (!object(spec) || !protocols.has(spec.protocol) || typeof spec.wireModel !== 'string' || !spec.wireModel || typeof spec.endpoint !== 'string') throw fail('Invalid model configuration');
    const url = new URL(spec.endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw fail('Invalid model endpoint');
    const tiers = spec.priceTiers ?? [];
    if (!Array.isArray(tiers) || tiers.some((tier, index) => !count(tier.aboveInputTokens) || (index && tier.aboveInputTokens <= tiers[index - 1].aboveInputTokens))) throw fail('Invalid price tiers');
    if (!count(spec.maxInputTokens) || spec.maxInputTokens === 0 || !count(spec.maxOutputTokens) || spec.maxOutputTokens === 0) throw fail('Missing model bounds');
    const price = normalPrice(spec.price);
    const maximumPrice = Object.fromEntries(categories.map(key => [key, Math.max(price[key], ...tiers.map(tier => normalPrice(tier.price)[key]))]));
    const maximumNano = charge(spec.maxInputTokens, Math.max(maximumPrice.input, maximumPrice.cacheRead, maximumPrice.cacheWrite)) + charge(spec.maxOutputTokens, maximumPrice.output);
    if (!Number.isSafeInteger(maximumNano)) throw fail('Invalid model bound');
    const key = JSON.stringify([spec.endpoint, spec.wireModel]);
    if (routes.has(key)) throw fail('Ambiguous model route');
    const paid = price.input > 0 || price.output > 0 || price.cacheRead > 0 || price.cacheWrite > 0;
    routes.set(key, { ...spec, model, paid, price, maximumPrice, maximumNano });
  }
  return routes;
}

function normalizeUsage(raw, protocol, price) {
  if (!object(raw)) throw fail('Missing request usage');
  let usage;
  if (protocol === 'chat') {
    const cached = raw.prompt_tokens_details?.cached_tokens ?? 0;
    usage = { input: raw.prompt_tokens - cached, output: raw.completion_tokens, cacheRead: cached, cacheWrite: raw.prompt_tokens_details?.cache_write_tokens ?? 0 };
    if (usage.cacheWrite !== 0) usage.input -= usage.cacheWrite;
  } else if (protocol === 'responses') {
    const cached = raw.input_tokens_details?.cached_tokens ?? 0;
    usage = { input: raw.input_tokens - cached, output: raw.output_tokens, cacheRead: cached, cacheWrite: raw.input_tokens_details?.cache_write_tokens ?? 0 };
    if (usage.cacheWrite !== 0) usage.input -= usage.cacheWrite;
  } else {
    usage = { input: raw.input_tokens, output: raw.output_tokens, cacheRead: raw.cache_read_input_tokens ?? 0, cacheWrite: raw.cache_creation_input_tokens ?? 0 };
  }
  if (categories.some(key => !count(usage[key]))) throw fail('Invalid request usage');
  if (price.cacheRead > 0 && protocol !== 'messages' && (protocol === 'chat' ? raw.prompt_tokens_details?.cached_tokens : raw.input_tokens_details?.cached_tokens) === undefined) throw fail('Missing cache usage');
  if (price.cacheWrite > 0 && (protocol === 'messages' ? raw.cache_creation_input_tokens : protocol === 'chat' ? raw.prompt_tokens_details?.cache_write_tokens : raw.input_tokens_details?.cache_write_tokens) === undefined) throw fail('Missing cache usage');
  if (protocol === 'messages' && price.cacheRead > 0 && raw.cache_read_input_tokens === undefined) throw fail('Missing cache usage');
  return usage;
}

function reportedCost(value) {
  if (!object(value)) return 0;
  let maximum = 0;
  for (const [key, item] of Object.entries(value)) {
    if (['cost', 'cost_usd', 'total_cost', 'total_cost_usd', 'costUsd'].includes(key) && Number(item) > 0) {
      const nano = Math.ceil(Number(item) * 1e9);
      if (!Number.isSafeInteger(nano)) throw fail('Invalid provider cost');
      maximum = Math.max(maximum, nano);
    }
    if (object(item)) maximum = Math.max(maximum, reportedCost(item));
  }
  return maximum;
}

function parseResponse(text, contentType, spec) {
  const values = [];
  if (contentType.includes('text/event-stream')) {
    for (const event of text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split(/\n\s*\n/)) {
      const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
      if (!data || data.trim() === '[DONE]') continue;
      const value = JSON.parse(data);
      values.push(value);
    }
  } else values.push(JSON.parse(text));
  if (spec.paid && contentType.includes('text/event-stream')) {
    const completed = spec.protocol === 'chat' ? /(?:^|\n)data: ?\[DONE\](?:\n|$)/.test(text.replace(/\r/g, ''))
      : spec.protocol === 'responses' ? values.some(value => value.type === 'response.completed')
        : values.some(value => value.type === 'message_stop');
    if (!completed) throw fail('Incomplete request stream');
  }
  let raw;
  for (const value of values) {
    if (spec.protocol === 'messages') {
      if (value.type === 'message_start' && object(value.message?.usage)) raw = { ...raw, ...value.message.usage };
      else if (value.type === 'message_delta' && object(value.usage)) raw = { ...raw, ...value.usage };
      else if (object(value.usage)) raw = value.usage;
    } else if (spec.protocol === 'responses') {
      if (value.type === 'response.completed') raw = value.response?.usage;
      else if (object(value.usage)) raw = value.usage;
    } else if (object(value.usage)) raw = value.usage;
  }
  const costNano = Math.max(0, ...values.map(reportedCost));
  let usage = null;
  try { usage = normalizeUsage(raw, spec.protocol, spec.maximumPrice); }
  catch (error) { if (spec.paid) throw error; }
  return { usage, reportedNano: costNano };
}

function providerFailure(response, text) {
  if (response.ok) return null;
  let detail = '';
  try {
    const parsed = JSON.parse(text);
    const message = parsed?.error?.message;
    if (typeof message === 'string' && message.trim()) detail = `: ${message.trim().replace(/[\r\n\t]+/g, ' ').slice(0, 500)}`;
  } catch {}
  return `Provider request failed (HTTP ${response.status})${detail}`;
}

async function responseText(response, maximum) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) throw fail('Response exceeds configured limit');
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(combined);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createTransport({ ledger, settings, role, fetch: upstream = globalThis.fetch }) {
  const routes = configuration(settings);
  const maximum = settings.maxResponseBytes ?? 16 * 1024 * 1024;
  if (!count(maximum) || !maximum) throw fail('Invalid response limit');
  const attempts = count(settings.providerRetry?.attempts) && settings.providerRetry.attempts > 0 ? settings.providerRetry.attempts : 3;
  const pauseMs = count(settings.providerRetry?.pauseMs) ? settings.providerRetry.pauseMs : 5000;
  async function ledgerCall(method, ...args) {
    try { return await ledger[method](...args); } catch { throw fail('Request ledger refused operation'); }
  }
  return async function guardedFetch(input, init) {
    let request;
    try { request = new Request(input, init); } catch { throw fail('Invalid HTTP request'); }
    const endpoint = request.url;
    if (request.method !== 'POST') return upstream(new Request(request, { redirect: 'error' }));
    let body;
    try { body = await request.clone().json(); }
    catch {
      if (request.headers.get('content-type')?.includes('application/x-www-form-urlencoded')) {
        const form = Object.fromEntries(new URLSearchParams(await request.clone().text()));
        if (['model', 'messages', 'input'].some(key => key in form)) throw fail('Request must contain a JSON object');
        return upstream(new Request(request, { redirect: 'error' }));
      }
      throw fail('Request must contain a JSON object');
    }
    if (!object(body)) throw fail('Request must contain a JSON object');
    const spec = routes.get(JSON.stringify([endpoint, body.model]));
    if (!spec) {
      if (!['model', 'messages', 'input'].some(key => key in body)) return upstream(new Request(request, { redirect: 'error' }));
      throw fail('Model route is not configured');
    }
    const bounded = { ...body };
    if (spec.protocol === 'responses') {
      if ('max_tokens' in body || 'max_completion_tokens' in body) throw fail('Conflicting output limits');
      bounded.max_output_tokens = spec.maxOutputTokens;
    } else {
      if ('max_output_tokens' in body || 'max_completion_tokens' in body) throw fail('Conflicting output limits');
      bounded.max_tokens = spec.maxOutputTokens;
      if (spec.protocol === 'chat' && bounded.stream) bounded.stream_options = { ...bounded.stream_options, include_usage: true };
    }
    if (spec.paid && body.tools?.some(tool => tool.type && tool.type !== 'function')) throw fail('Unpriced hosted tool');
    const reachablePrices = [spec.price, ...(spec.priceTiers ?? []).filter(tier => spec.maxInputTokens > tier.aboveInputTokens).map(tier => normalPrice(tier.price))];
    const reservationPrice = Object.fromEntries(categories.map(key => [key, Math.max(...reachablePrices.map(price => price[key]))]));
    const maximumNano = charge(spec.maxInputTokens, Math.max(reservationPrice.input, reservationPrice.cacheRead, reservationPrice.cacheWrite)) + charge(spec.maxOutputTokens, reservationPrice.output);
    let lastFailure = 'Provider request failed';
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const reservation = await ledgerCall('reserve', { model: spec.model, role, maximumNano, price: spec.price, bounds: { maxInputTokens: spec.maxInputTokens, maxOutputTokens: spec.maxOutputTokens } });
      const id = reservation?.id ?? reservation;
      let response;
      let settled = false;
      try {
        response = await upstream(new Request(request, { body: JSON.stringify(bounded), redirect: 'error' }));
        if (response.status >= 300 && response.status < 400) throw fail('Redirect refused');
        const text = await responseText(response.clone(), maximum);
        if (spec.paid && [401, 403].includes(response.status)) {
          const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
          await ledgerCall('settle', id, { usage, costNano: 0 });
          settled = true;
          return response;
        }
        const providerError = providerFailure(response, text);
        if (spec.paid && providerError) {
          await ledgerCall('settle', id, { usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costNano: 0 });
          settled = true;
          lastFailure = providerError;
          if (attempt < attempts) { await sleep(pauseMs); continue; }
          throw fail(`provider down: ${providerError}`);
        }
        let usage;
        let reportedNano = 0;
        try { ({ usage, reportedNano } = parseResponse(text, response.headers.get('content-type') ?? (bounded.stream ? 'text/event-stream' : ''), spec)); }
        catch (error) {
          if (spec.paid) throw fail('Paid request usage is unavailable');
        }
        const inputTokens = usage ? usage.input + usage.cacheRead + usage.cacheWrite : 0;
        const price = (spec.priceTiers ?? []).reduce((selected, tier) => inputTokens > tier.aboveInputTokens ? normalPrice(tier.price) : selected, spec.price);
        const costNano = Math.max(usage ? totalCharge(usage, price) : 0, reportedNano);
        if (!Number.isSafeInteger(costNano)) throw fail('Invalid request cost');
        await ledgerCall('settle', id, { usage: usage ?? null, costNano });
        settled = true;
        return response;
      } catch (error) {
        if (response?.body) void response.body.cancel().catch(() => {});
        if (error.message?.startsWith('provider down:')) throw error;
        const reason = error instanceof Error && error.message.startsWith('Provider request failed')
          ? `Request outcome unavailable: ${error.message}`
          : 'Request outcome unavailable';
        if (!settled) await ledgerCall('unknown', id, reason);
        lastFailure = error?.message ?? lastFailure;
        if (attempt < attempts && !/Response exceeds|Conflicting output|Unpriced hosted/.test(lastFailure)) {
          await sleep(pauseMs);
          continue;
        }
        throw fail(lastFailure.startsWith('provider down:') ? lastFailure : `provider down: ${lastFailure}`);
      }
    }
    throw fail(`provider down: ${lastFailure}`);
  };
}
