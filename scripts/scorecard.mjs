#!/usr/bin/env node
// Scorecard for one Julia card, rebuilt from Mastra Code's own records.
// Design and sources: docs/adr/0024-run-scorecard-and-stop-ping.md.
//
//   node scripts/scorecard.mjs JUL-273            print the scorecard
//   node scripts/scorecard.mjs JUL-273 --write    write docs/scorecards/JUL-273.md
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KICKOFF = /\b(?:Card:|Start|Run)\s+(JUL-\d+)\b/;
const CACHE_WRITE_1H_FACTOR = 1.6; // Mastra prices 1-hour cache writes at 1.6x the 5-minute rate (2x vs 1.25x input).
const TOTAL_METRICS = ['mastra_model_total_input_tokens', 'mastra_model_total_output_tokens'];

export function appDataDir(env = process.env) {
  return env.MASTRA_APP_DATA_DIR || join(homedir(), '.local', 'share', 'mastracode');
}

export function stopsFile(env = process.env) {
  return join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'julia', 'stops.jsonl');
}

// ---- reading mastra.db -------------------------------------------------------

function textOf(parts) {
  return parts.filter(p => p.type === 'text').map(p => p.text).join('\n').trim();
}

// One thread's messages as plain events. `activity` holds every moment the agent
// did something; an ask_user answer time is excluded because that is Todd's moment.
export function threadEvents(rows) {
  const users = [];
  const activity = [];
  const texts = [];
  const asks = [];
  const steps = [];
  const subagents = [];
  let model;
  for (const row of rows) {
    const content = JSON.parse(row.content);
    const parts = content.parts ?? [];
    const at = Date.parse(row.createdAt);
    // A few sealed continuation messages carry no model; they continue the previous one.
    if (content.metadata?.modelId) model = `${content.metadata.provider}/${content.metadata.modelId}`;
    if (row.role === 'user' || (row.role === 'signal' && row.type === 'user')) {
      users.push({ at, text: textOf(parts) });
      continue;
    }
    if (row.role !== 'assistant') continue;
    activity.push(at);
    for (const part of parts) {
      const created = typeof part.createdAt === 'number' ? part.createdAt : undefined;
      if (created) activity.push(created);
      const tool = part.toolInvocation;
      if (tool?.toolName === 'ask_user') {
        asks.push({ answeredAt: part.updatedAt, question: tool.args?.question ?? '', answer: String(tool.result?.content ?? '').replace(/^User answered: /, '') });
      } else if (part.updatedAt) {
        activity.push(part.updatedAt);
      }
      if (part.type === 'text' && part.text?.trim()) texts.push({ at: created ?? at, text: part.text.trim() });
      if (part.type === 'step-start') steps.push({ at: created ?? at, model });
      if (tool?.toolName === 'subagent') {
        subagents.push({ at: created ?? at, agentType: tool.args?.agentType, modelId: tool.args?.modelId ?? 'parent model', ms: part.updatedAt && created ? part.updatedAt - created : undefined });
      }
    }
  }
  activity.sort((a, b) => a - b);
  return { users, activity, texts, asks, steps, subagents };
}

// A card window runs from its kickoff message to the next kickoff in the thread.
export function cardWindows(thread, events) {
  const windows = [];
  for (const user of events.users) {
    const card = user.text.match(KICKOFF)?.[1];
    if (!card) continue;
    if (windows.length) windows.at(-1).end = user.at;
    windows.push({ thread, card, start: user.at, end: Infinity });
  }
  if (!windows.length) {
    const card = (thread.title ?? '').match(/\bJUL-\d+\b/)?.[0];
    if (card && events.users.length) windows.push({ thread, card, start: events.users[0].at, end: Infinity });
  }
  return windows;
}

// Every user message that follows agent activity ends a wait on Todd.
export function findStops(events) {
  const stops = [];
  let previousUser = -Infinity;
  for (const user of events.users) {
    const after = previousUser;
    previousUser = user.at;
    // An ask_user answer resumes the agent before its user row is written, so the wait ends at the answer.
    const ask = events.asks.find(a => a.answeredAt && a.answeredAt <= user.at && a.answeredAt > after);
    const resumed = ask ? ask.answeredAt : user.at;
    const since = events.activity.filter(t => t < resumed).at(-1);
    if (since === undefined || since < after) continue;
    const lastText = events.texts.filter(t => t.at <= since + 1000).at(-1)?.text ?? '';
    stops.push({ since, resumed, kind: ask ? 'question' : 'turn ended', question: ask ? ask.question : lastText, reply: ask ? ask.answer : user.text });
  }
  return stops;
}

export function readThreads(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare('select id, title, json(metadata) as metadata from mastra_threads').all().map(thread => {
      const rows = db.prepare('select role, type, createdAt, content from mastra_messages where thread_id = ? order by createdAt').all(thread.id);
      return { id: thread.id, title: thread.title, usage: JSON.parse(thread.metadata ?? '{}').tokenUsage, events: threadEvents(rows) };
    });
  } finally {
    db.close();
  }
}

export function cardForThread(dbPath, threadId) {
  const thread = readThreads(dbPath).find(t => t.id === threadId);
  return thread ? cardWindows(thread, thread.events).at(-1)?.card : undefined;
}

// ---- prices ------------------------------------------------------------------

export function loadPrices(mastracodeDir) {
  const file = createRequire(join(mastracodeDir, 'package.json')).resolve('@mastra/observability/package.json');
  return JSON.parse(readFileSync(join(dirname(file), 'dist', 'metrics', 'pricing-data.json'), 'utf8'));
}

export function ratesFor(prices, model) {
  const [provider, ...rest] = model.split('/');
  return prices[provider.split('.')[0]]?.models?.[rest.join('/')]?.cost;
}

// Prices a Mastra Code thread `tokenUsage` (AI SDK totals: promptTokens includes cache reads and writes).
// Without rates it still splits the tokens, so unpriced usage is reported in tokens.
export function priceThreadUsage(usage, rates) {
  const cacheRead = usage.cachedInputTokens ?? 0;
  const write1h = usage.cacheCreationInputTokens1h ?? 0;
  const write5m = (usage.cacheCreationInputTokens ?? 0) - write1h;
  const fresh = usage.promptTokens - cacheRead - write1h - write5m;
  const tokens = { input: fresh, cacheRead, cacheWrite: write5m + write1h, output: usage.completionTokens };
  if (!rates) return { tokens };
  const parts = {
    input: fresh * rates.input,
    cacheRead: cacheRead * (rates.cache_read ?? rates.input),
    cacheWrite: write5m * (rates.cache_write ?? rates.input) + write1h * (rates.cache_write ?? rates.input) * CACHE_WRITE_1H_FACTOR,
    output: usage.completionTokens * rates.output,
  };
  for (const key of Object.keys(parts)) parts[key] /= 1e6;
  return { tokens, parts, usd: Object.values(parts).reduce((a, b) => a + b, 0) };
}

// ---- tracing (observability.duckdb) ------------------------------------------

export function mastracodeDir() {
  const bin = execFileSync('sh', ['-c', 'command -v mastracode'], { encoding: 'utf8' }).trim();
  return resolve(dirname(realpathSync(bin)), '..');
}

async function readTracing(dir, file, threadIds) {
  if (!existsSync(file) || !threadIds.length) return { metrics: [], requested: [] };
  const { DuckDBInstance } = createRequire(join(dir, 'package.json'))('@duckdb/node-api');
  // A running Mastra Code holds the trace file's lock, so read a copy.
  const copy = mkdtempSync(join(tmpdir(), 'scorecard-'));
  copyFileSync(file, join(copy, 'o.duckdb'));
  if (existsSync(file + '.wal')) copyFileSync(file + '.wal', join(copy, 'o.duckdb.wal'));
  const instance = await DuckDBInstance.create(join(copy, 'o.duckdb'));
  try {
    const connection = await instance.connect();
    const ids = threadIds.map(id => `'${id.replace(/'/g, "''")}'`).join(',');
    const rows = async sql => (await connection.runAndReadAll(sql)).getRowObjectsJson();
    const metrics = await rows(`select threadId, epoch_ms(timestamp) as at, entityName, provider, model, name, value, estimatedCost
      from metric_events where threadId in (${ids}) and name like 'mastra_model_%tokens'`);
    const requested = await rows(`select threadId, epoch_ms(timestamp) as at, entityName, json_extract_string(attributes, '$.model') as model,
      json_extract_string(attributes, '$.provider') as provider from span_events where threadId in (${ids}) and spanType = 'model_generation' and endedAt is null`);
    return { metrics, requested };
  } finally {
    instance.closeSync?.();
    rmSync(copy, { recursive: true, force: true });
  }
}

// Sums Mastra's own cost estimate. Only the two total metrics carry the whole
// cost; the input/cache/output detail metrics repeat parts of it.
export function tracedCost(metrics) {
  const byAgent = new Map();
  for (const m of metrics) {
    const key = `${m.entityName}\u0000${m.provider}/${m.model}`;
    const row = byAgent.get(key) ?? { agent: m.entityName, answered: `${m.provider}/${m.model}`, tokens: {}, usd: 0, unpriced: false };
    const short = m.name.replace(/^mastra_model_/, '').replace(/_tokens$/, '');
    row.tokens[short] = (row.tokens[short] ?? 0) + Number(m.value);
    if (TOTAL_METRICS.includes(m.name)) {
      if (m.estimatedCost == null) row.unpriced = true;
      else row.usd += Number(m.estimatedCost);
    }
    byAgent.set(key, row);
  }
  return [...byAgent.values()];
}

// ---- scorecard ---------------------------------------------------------------

const inWindow = (w, at) => at >= w.start && at < w.end;

// A stop counts against success if it starts before Todd's UAT yes on the preview.
// The wait that ends in the yes is the UAT itself and does not count, unless that
// same question also asked Todd for something else (recorded as `alsoAsked`).
export function judgeStops(stops, uat) {
  return stops.map(stop => {
    if (!uat) return { ...stop, counts: true };
    const yes = Date.parse(uat.yesAt);
    const isUatWait = Math.abs(stop.resumed - yes) < 2000;
    return { ...stop, isUatWait, counts: stop.since < yes && (!isUatWait || Boolean(uat.alsoAsked)) };
  });
}

export function buildScorecard({ card, threads, prices, tracing, pulls, pings, uat }) {
  const windows = threads.flatMap(t => cardWindows(t, t.events)).filter(w => w.card === card);
  const pull = pulls.find(p => p.headRefName.toLowerCase().includes(card.toLowerCase()));
  const runs = [];
  let stops = [];
  const cost = [];
  for (const w of windows) {
    const { events, usage } = w.thread;
    const steps = events.steps.filter(s => inWindow(w, s.at));
    const subagents = events.subagents.filter(s => inWindow(w, s.at));
    runs.push({ thread: w.thread.id, title: w.thread.title, start: w.start, end: Math.min(w.end, events.activity.at(-1) ?? w.start), steps: steps.length, subagents });
    for (const stop of findStops(events).filter(s => inWindow(w, s.since))) {
      // The hook fires as the turn ends, so a stop's ping lands between its last activity (less a minute of slack) and the reply.
      const ping = pings.find(p => p.thread === w.thread.id && Date.parse(p.at) >= stop.since - 60_000 && Date.parse(p.at) <= stop.resumed);
      stops.push({ ...stop, ping });
    }
    const traced = tracing.metrics.filter(m => m.threadId === w.thread.id && inWindow(w, Number(m.at)));
    if (traced.some(m => m.entityName === 'Code Agent')) {
      for (const row of tracedCost(traced)) {
        const asked = tracing.requested.find(r => r.threadId === w.thread.id && r.entityName === row.agent && inWindow(w, Number(r.at)));
        cost.push({ ...row, requested: asked ? `${asked.provider}/${asked.model}` : 'not recorded', basis: row.unpriced ? 'traced; no published price' : 'traced, Mastra estimate' });
      }
      continue;
    }
    if (!steps.length && !subagents.length) continue;
    const models = [...new Set(events.steps.map(s => s.model))];
    const allSteps = events.steps.length;
    const share = steps.length / allSteps;
    const rates = models.length === 1 ? ratesFor(prices, models[0]) : undefined;
    const priced = usage ? priceThreadUsage(usage, rates) : undefined;
    const scale = n => Math.round(n * share);
    cost.push({
      agent: 'Code Agent (main chat)',
      requested: models.join(', ') || 'not recorded',
      answered: 'not recorded before tracing',
      tokens: priced ? Object.fromEntries(Object.entries(priced.tokens).map(([k, v]) => [k, scale(v)])) : {},
      usd: priced?.usd ? priced.usd * share : 0,
      parts: priced?.parts ? Object.fromEntries(Object.entries(priced.parts).map(([k, v]) => [k, v * share])) : undefined,
      unpriced: !priced?.parts,
      basis: `${share === 1 ? 'thread total' : `${(share * 100).toFixed(0)}% of thread total (${steps.length} of ${allSteps} model steps)`}${priced && !priced.parts ? '; no published price' : ''}`,
      averageContext: usage ? Math.round(usage.promptTokens / allSteps) : undefined,
      steps: steps.length,
    });
    for (const [modelId, calls] of Object.entries(Object.groupBy(subagents, s => `${s.agentType} on ${s.modelId}`))) {
      cost.push({ agent: `Subagent ${modelId.split(' on ')[0]} x${calls.length}`, requested: calls[0].modelId, answered: 'not recorded before tracing', tokens: {}, usd: 0, unpriced: true, basis: 'usage not recorded before tracing' });
    }
  }
  stops = judgeStops(stops.sort((a, b) => a.since - b.since), uat);
  const counted = stops.filter(s => s.counts);
  return {
    card, windows: windows.length, runs, stops, cost, pull, uat,
    usd: cost.reduce((a, c) => a + c.usd, 0),
    success: uat && windows.length ? counted.length === 0 : undefined,
    stopsBeforeUat: counted.length,
  };
}

const utc = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const usd = n => `$${n.toFixed(2)}`;
const minutes = ms => `${Math.round(ms / 60_000)} min`;
const tok = n => (n == null ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const cell = s => String(s).replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, 160);
const quote = s => String(s).trim().split('\n').map(l => `   > ${l}`.trimEnd());

// An unpriced row is unknown spend, never $0, so a total that leaves it out is a floor.
function costHeadline(cost, total) {
  const unpriced = cost.filter(c => c.unpriced).length;
  if (!cost.length) return '**unknown**. No usage records found for this card.';
  if (unpriced === cost.length) return '**unknown** at published API prices: no row has a price. Tokens are in the table below.';
  if (unpriced) return `**at least ${usd(total)}** at published API prices; ${unpriced} ${unpriced === 1 ? 'row' : 'rows'} below ${unpriced === 1 ? 'is' : 'are'} unpriced.`;
  return `**${usd(total)}** at published API prices, every row priced.`;
}

export function renderScorecard(s, generatedAt = new Date()) {
  const lines = [];
  lines.push(`# Scorecard: ${s.card}`, '');
  lines.push(`Generated ${utc(generatedAt.getTime())} UTC by \`node scripts/scorecard.mjs ${s.card} --write\` from Mastra Code's records (see docs/adr/0024-run-scorecard-and-stop-ping.md).`, '');
  lines.push('## Result', '');
  const pr = s.pull ? `PR #${s.pull.number}, opened ${utc(Date.parse(s.pull.createdAt))}` : 'no PR yet';
  const verdict = !s.windows ? 'not decided yet (no matching run records)' : s.success === undefined ? 'not decided yet (no UAT yes recorded)' : s.success ? 'yes' : 'no';
  const uat = s.uat ? `${utc(Date.parse(s.uat.yesAt))} ("${cell(s.uat.said)}")` : 'not recorded';
  lines.push(`- Success: **${verdict}**. Stops before Todd's UAT yes: ${s.stopsBeforeUat}. Todd's UAT yes: ${uat}.`);
  lines.push(`- Cost: ${costHeadline(s.cost, s.usd)}`);
  lines.push(`- Stops: ${s.stops.length}, waiting ${minutes(s.stops.reduce((a, x) => a + x.resumed - x.since, 0))} in total. ${pr}${s.pull?.mergedAt ? `, merged ${utc(Date.parse(s.pull.mergedAt))}` : ''}.`, '');
  lines.push('## Cost by agent and model', '');
  lines.push('| Agent | Model requested | Model answered | Fresh input | Cache read | Cache write | Output | Cost | Basis |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const c of s.cost) {
    const t = c.tokens;
    lines.push(`| ${cell(c.agent)} | ${cell(c.requested)} | ${cell(c.answered)} | ${tok(t.input ?? t.input_text)} | ${tok(t.cacheRead ?? t.input_cache_read)} | ${tok(t.cacheWrite ?? t.input_cache_write)} | ${tok(t.output ?? t.total_output)} | ${c.unpriced ? 'unpriced' : usd(c.usd)} | ${cell(c.basis)} |`);
  }
  lines.push('', '## Stops', '');
  if (!s.stops.length) lines.push('None.');
  else {
    const counts = x => (x.isUatWait ? (x.counts ? `yes: UAT wait that also asked ${s.uat.alsoAsked}` : 'no: the UAT wait itself') : x.counts ? 'yes' : 'no: after the UAT yes');
    const ping = x => (x.ping ? (x.ping.comment ? `[comment](${x.ping.comment})${x.ping.notified ? ' + reminder' : ', Todd not notified'}` : 'recorded, not posted') : 'none recorded');
    lines.push('| # | Waiting since (UTC) | Length | Kind | Counts against success | Ping |', '| --- | --- | --- | --- | --- | --- |');
    s.stops.forEach((x, i) => lines.push(`| ${i + 1} | ${utc(x.since)} | ${minutes(x.resumed - x.since)} | ${x.kind} | ${cell(counts(x))} | ${ping(x)} |`));
    lines.push('', '### What each stop asked', '');
    lines.push('For a question, the ask_user text. For a turn that ended, the run\'s last message. Then what came back.', '');
    s.stops.forEach((x, i) => {
      lines.push(`${i + 1}. ${x.kind === 'question' ? 'Asked' : 'Last said'} at ${utc(x.since)}:`, '');
      lines.push(...quote(x.question), '');
      lines.push(`   Reply at ${new Date(x.resumed).toISOString().slice(11, 19)} UTC:${x.reply?.trim() ? '' : ' (empty)'}`, '');
      if (x.reply?.trim()) lines.push(...quote(x.reply), '');
    });
  }
  lines.push('', '## Runs', '');
  for (const r of s.runs) {
    lines.push(`- Thread \`${r.thread.slice(0, 8)}\` "${r.title}": ${utc(r.start)} to ${utc(r.end)}, ${r.steps} main-chat model steps, ${r.subagents.length} subagent calls${r.subagents.length ? ` (${Object.entries(Object.groupBy(r.subagents, x => `${x.agentType} on ${x.modelId}`)).map(([k, v]) => `${v.length}x ${k}`).join(', ')})` : ''}.`);
  }
  const main = s.cost.find(c => c.parts);
  if (main) {
    const p = main.parts;
    lines.push('', '## Explain the number', '');
    lines.push(`The main chat cost ${usd(main.usd)}: cache reads ${usd(p.cacheRead)} (${tok(main.tokens.cacheRead)} tokens), cache writes ${usd(p.cacheWrite)} (${tok(main.tokens.cacheWrite)}), output ${usd(p.output)} (${tok(main.tokens.output)}), fresh input ${usd(p.input)} (${tok(main.tokens.input)}).`);
    lines.push(`It made ${main.steps} model steps and each step re-read about ${tok(main.averageContext)} tokens of context, so cost grows with steps times context size, not with the size of the change.`);
  }
  return lines.join('\n') + '\n';
}

// stops.jsonl holds a stop line, then a ping line with the same id once the comment posts.
export function readPings(file) {
  if (!existsSync(file)) return [];
  const byId = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const entry = JSON.parse(line);
    byId.set(entry.id, { ...byId.get(entry.id), ...entry });
  }
  return [...byId.values()].filter(p => p.thread);
}

function readPulls(card) {
  const out = execFileSync('gh', ['pr', 'list', '--state', 'all', '--search', card, '--json', 'number,createdAt,mergedAt,url,headRefName'], {
    encoding: 'utf8', env: { ...process.env, CLICOLOR_FORCE: '0', NO_COLOR: '1' },
  });
  return JSON.parse(out);
}

async function main() {
  const [card, flag] = process.argv.slice(2);
  if (!/^JUL-\d+$/.test(card ?? '')) {
    console.error('usage: node scripts/scorecard.mjs JUL-<n> [--write]');
    process.exitCode = 2;
    return;
  }
  const dir = mastracodeDir();
  const data = appDataDir();
  const threads = readThreads(join(data, 'mastra.db'));
  const ids = threads.filter(t => cardWindows(t, t.events).some(w => w.card === card)).map(t => t.id);
  const tracing = await readTracing(dir, process.env.MASTRA_OBSERVABILITY_DB_PATH || join(data, 'observability.duckdb'), ids);
  const uatFile = fileURLToPath(new URL('../docs/scorecards/uat.json', import.meta.url));
  const uat = existsSync(uatFile) ? JSON.parse(readFileSync(uatFile, 'utf8'))[card] : undefined;
  const scorecard = buildScorecard({ card, threads, prices: loadPrices(dir), tracing, pulls: readPulls(card), pings: readPings(stopsFile()), uat });
  const markdown = renderScorecard(scorecard);
  if (flag === '--write') {
    const out = fileURLToPath(new URL(`../docs/scorecards/${card}.md`, import.meta.url));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, markdown);
    console.log(out);
  } else {
    process.stdout.write(markdown);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
