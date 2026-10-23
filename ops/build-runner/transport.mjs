const protocols = new Set(['chat', 'responses', 'messages']);
const categories = ['input', 'output', 'cacheRead', 'cacheWrite'];
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

function totalCharge(usage, price) {
  const parts = categories.map(key => charge(usage[key], price[key], true));
  const scale = Math.max(0, ...parts.map(part => part.scale));
  const numerator = parts.reduce((sum, part) => sum + part.numerator * 10n ** BigInt(scale - part.scale), 0n);
  const denominator = 10n ** BigInt(scale);
  return Number((numerator + denominator - 1n) / denominator);
}

function configuration(settings, trial) {
  if (!object(settings?.models)) throw fail('Invalid model configuration');
  const routes = new Map();
  for (const [model, spec] of Object.entries(settings.models)) {
    if (object(spec) && typeof spec.unavailable === 'string' && spec.unavailable.trim()) continue;
    if (!object(spec) || !protocols.has(spec.protocol) || typeof spec.wireModel !== 'string' || !spec.wireModel || typeof spec.endpoint !== 'string') throw fail('Invalid model configuration');
    const url = new URL(spec.endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw fail('Invalid model endpoint');
    if (!object(spec.price) || categories.some(key => !Number.isFinite(spec.price[key]) || spec.price[key] < 0)) throw fail('Missing model price');
    if (!count(spec.maxInputTokens) || spec.maxInputTokens === 0 || !count(spec.maxOutputTokens) || spec.maxOutputTokens === 0) throw fail('Missing model bounds');
    const paid = categories.some(key => spec.price[key] > 0);
    const maximumNano = charge(spec.maxInputTokens, Math.max(spec.price.input, spec.price.cacheRead, spec.price.cacheWrite)) + charge(spec.maxOutputTokens, spec.price.output);
    if (!Number.isSafeInteger(maximumNano)) throw fail('Invalid model bound');
    const key = JSON.stringify([spec.endpoint, spec.wireModel]);
    if (routes.has(key)) throw fail('Ambiguous model route');
    routes.set(key, { ...spec, model, paid, maximumNano, trial });
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
  if (!object(value)) return false;
  for (const [key, item] of Object.entries(value)) {
    if (['cost', 'cost_usd', 'total_cost', 'total_cost_usd', 'costUsd'].includes(key) && Number(item) > 0) return true;
    if (object(item) && reportedCost(item)) return true;
  }
  return false;
}

function unsupportedPaidContent(value) {
  if (Array.isArray(value)) return value.some(unsupportedPaidContent);
  if (!object(value)) return false;
  if (typeof value.type === 'string' && /image|audio|video|file/.test(value.type)) return true;
  return Object.values(value).some(unsupportedPaidContent);
}

function parseResponse(text, contentType, spec) {
  const values = [];
  if (contentType.includes('text/event-stream')) {
    for (const event of text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split(/\n\s*\n/)) {
      const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
      if (!data || data.trim() === '[DONE]') continue;
      const value = JSON.parse(data);
      if (reportedCost(value)) throw fail('STOP WORK: provider reported nonzero cost');
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
    if (reportedCost(value)) throw fail('STOP WORK: provider reported nonzero cost');
    if (spec.protocol === 'messages') {
      if (value.type === 'message_start' && object(value.message?.usage)) raw = { ...raw, ...value.message.usage };
      else if (value.type === 'message_delta' && object(value.usage)) raw = { ...raw, ...value.usage };
      else if (object(value.usage)) raw = value.usage;
    } else if (spec.protocol === 'responses') {
      if (value.type === 'response.completed') raw = value.response?.usage;
      else if (object(value.usage)) raw = value.usage;
    } else if (object(value.usage)) raw = value.usage;
  }
  return normalizeUsage(raw, spec.protocol, spec.price);
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

export function createTransport({ ledger, settings, role, fetch: upstream = globalThis.fetch, trial = true }) {
  const routes = configuration(settings, trial);
  const allowed = new Set(settings.networkAllow ?? []);
  const maximum = settings.maxResponseBytes ?? 16 * 1024 * 1024;
  if (!count(maximum) || !maximum) throw fail('Invalid response limit');
  async function ledgerCall(method, ...args) {
    try { return await ledger[method](...args); } catch { throw fail('Request ledger refused operation'); }
  }
  return async function guardedFetch(input, init) {
    if ((await ledgerCall('snapshot')).stopped) throw fail('STOP WORK: card stopped after nonzero cost');
    let request;
    try { request = new Request(input, init); } catch { throw fail('Invalid HTTP request'); }
    const endpoint = request.url;
    if (request.method === 'GET' && allowed.has(endpoint)) return upstream(new Request(request, { redirect: 'error' }));
    if (request.method !== 'POST') throw fail('HTTP route is not configured');
    let body;
    try {
      if (allowed.has(endpoint) && request.headers.get('content-type')?.includes('application/x-www-form-urlencoded')) body = Object.fromEntries(new URLSearchParams(await request.clone().text()));
      else body = await request.clone().json();
    } catch { throw fail('Request must contain a JSON object'); }
    if (!object(body)) throw fail('Request must contain a JSON object');
    const unavailable = Object.entries(settings.models).find(([id, model]) => model.unavailable && (body.model === id || body.model === model.wireModel));
    if (unavailable) throw fail(`provider unavailable: ${unavailable[1].unavailable}`);
    const spec = routes.get(JSON.stringify([endpoint, body.model]));
    if (!spec) {
      if (allowed.has(endpoint) && !['model', 'messages', 'input'].some(key => key in body)) return upstream(new Request(request, { redirect: 'error' }));
      throw fail('Model route is not configured');
    }
    if (trial && spec.paid) throw fail('Trial forbids nonzero model prices');
    const bounded = { ...body };
    if (spec.protocol === 'responses') {
      if ('max_tokens' in body || 'max_completion_tokens' in body) throw fail('Conflicting output limits');
      bounded.max_output_tokens = spec.maxOutputTokens;
    } else {
      if ('max_output_tokens' in body || 'max_completion_tokens' in body) throw fail('Conflicting output limits');
      bounded.max_tokens = spec.maxOutputTokens;
      if (spec.protocol === 'chat' && bounded.stream) bounded.stream_options = { ...bounded.stream_options, include_usage: true };
    }
    if (spec.paid && (['audio', 'modalities'].some(key => key in body) || unsupportedPaidContent(body))) throw fail('Unsupported paid request shape');
    const reservation = await ledgerCall('reserve', { model: spec.model, role, maximumNano: spec.maximumNano, price: spec.price, bounds: { maxInputTokens: spec.maxInputTokens, maxOutputTokens: spec.maxOutputTokens } });
    const id = reservation?.id ?? reservation;
    let response;
    let settled = false;
    try {
      response = await upstream(new Request(request, { body: JSON.stringify(bounded), redirect: 'error' }));
      if (response.status >= 300 && response.status < 400) throw fail('Redirect refused');
      const text = await responseText(response.clone(), maximum);
      let usage;
      try { usage = parseResponse(text, response.headers.get('content-type') ?? '', spec); }
      catch (error) {
        if (error.message.startsWith('STOP WORK')) throw error;
        if (spec.paid) throw fail('Paid request usage is unavailable');
      }
      const costNano = usage ? totalCharge(usage, spec.price) : 0;
      if (!Number.isSafeInteger(costNano)) throw fail('Invalid request cost');
      await ledgerCall('settle', id, { usage: usage ?? null, costNano });
      settled = true;
      if (costNano > spec.maximumNano) throw fail('Request usage exceeds reserved bound');
      return response;
    } catch (error) {
      if (response?.body) void response.body.cancel().catch(() => {});
      if (error.message?.startsWith('STOP WORK')) await ledgerCall('stop', 'Provider reported nonzero cost');
      if (!settled) await ledgerCall('unknown', id, error.message?.startsWith('STOP WORK') ? 'Provider reported nonzero cost' : 'Request outcome unavailable');
      if (error.message?.startsWith('STOP WORK')) throw error;
      throw fail('Request outcome unavailable');
    }
  };
}
