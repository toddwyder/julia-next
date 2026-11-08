#!/usr/bin/env node
// The shared lane runner for JUL-342. One command starts a candidate Studio
// under its memory cap, runs a named scenario from the registry below against
// that Studio, and writes the scenario's screenshot and result JSON into the
// lane folder.
//
//   node scripts/run-lane.mjs --work JUL-342 --lane ~/.local/state/julia-scratch/lane-a --scenario noop
//   node scripts/run-lane.mjs --list
//
// The live lock is taken with flock and held until the Studio stops, so a second
// copy exits with a refusal instead of waiting or starting a second Studio. One
// practice run per --work feeds every scenario that reads it: the run directory
// is reused, so asking for three scenarios does not start three practice builds.

import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runForm } from './check-studio-start.mjs';
import { scratchDir } from './scratch-dir.mjs';

export const LOCK_PATH = join(scratchDir, 'jul-342-live.lock');
export const MEMORY_MAX = '2200M';
export const MEMORY_SWAP_MAX = '0';
export const LEAD_MODEL = 'commandcode/deepseek/deepseek-v4.1-flash';
const CAP_BYTES = 2200 * 1024 * 1024;
const LOCK_HELD_ENV = 'JUL342_LANE_LOCK_HELD';
const LOCK_BUSY = 75;
const SELF = fileURLToPath(import.meta.url);
const TERMINAL = new Set(['success', 'failed', 'canceled', 'completed']);
const CREDENTIALS = ['CMD_API_KEY', 'COMMANDCODE_API_KEY', 'LINEAR_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];

// Every role starts on the free model. A saved file overrides this; so does
// --role-models, which copies a file the lane already trusts.
const ROLE_MODELS = [
  '# budget: medium (high)',
  'feature, refactoring: commandcode/deepseek/deepseek-v4.1-flash',
  'bug-fix: commandcode/deepseek/deepseek-v4.1-flash',
  'perf-issue: commandcode/deepseek/deepseek-v4.1-flash',
  'hillclimb: commandcode/deepseek/deepseek-v4.1-flash',
  'judgment and prose: commandcode/deepseek/deepseek-v4.1-flash',
  'hardest tasks: commandcode/deepseek/deepseek-v4.1-flash',
  'how explorer: commandcode/deepseek/deepseek-v4.1-flash',
  'how explainer: commandcode/deepseek/deepseek-v4.1-flash',
  'why investigators: commandcode/deepseek/deepseek-v4.1-flash',
  'why synthesizer: commandcode/deepseek/deepseek-v4.1-flash',
  'reflect tooling: commandcode/deepseek/deepseek-v4.1-flash',
  'reflect judgment, divergent, synthesizer: commandcode/deepseek/deepseek-v4.1-flash',
  'arena runners: commandcode/deepseek/deepseek-v4.1-flash',
  'arena cross-judge pool: commandcode/deepseek/deepseek-v4.1-flash',
  'architect runners: commandcode/deepseek/deepseek-v4.1-flash',
  'interrogate reviewers: commandcode/deepseek/deepseek-v4.1-flash',
  'swarm workers: commandcode/deepseek/deepseek-v4.1-flash',
  '',
].join('\n');

const delay = ms => new Promise(done => setTimeout(done, ms));
const expandHome = value => value.replace(/^~(?=$|[\\/])/, homedir());
const now = () => new Date().toISOString();

function usage() {
  return [
    'Usage: node scripts/run-lane.mjs --scenario <name> [options]',
    '',
    '  --scenario <name>   scenario from the registry; repeat for several in one Studio',
    '  --work <id>         the piece of work whose single practice run is shared (default: work)',
    '  --lane <dir>        lane folder (default: ~/.local/state/julia-scratch/lane-<work>)',
    '  --repo <dir>        Studio checkout (default: this runner\'s repository)',
    '  --card <id>         practice card; required by scenarios that start one',
    '  --seconds <n>       run timeout for a practice run (default: 1500)',
    '  --hold-ms <n>       keep the lock this long before the scenarios (default: 0)',
    '  --lead-model <id>   Lead model written to <lane>/lead-model',
    '  --role-models <f>   copy this role table to <lane>/lead-role-models.md',
    '  --lock <path>       lock file (default: the live lock; tests use their own)',
    '  --no-screenshot     skip the evidence PNG',
    '  --check-cap         start no Studio; prove the 2200M / 0 swap cap on a sleep scope',
    '  --list              print the scenario registry as JSON',
    '  --help',
  ].join('\n');
}

export function parseArgs(argv) {
  const options = {
    scenario: [], work: 'work', lane: null, repo: resolve(dirname(SELF), '..'),
    card: null, seconds: 1500, holdMs: 0, leadModel: LEAD_MODEL, roleModels: null,
    lock: LOCK_PATH, screenshot: true, checkCap: false, list: false, help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`);
      index += 1;
      return next;
    };
    switch (arg) {
      case '--scenario': options.scenario.push(value()); break;
      case '--work': options.work = value(); break;
      case '--lane': options.lane = expandHome(value()); break;
      case '--repo': options.repo = resolve(expandHome(value())); break;
      case '--card': options.card = value(); break;
      case '--seconds': options.seconds = Number(value()); break;
      case '--hold-ms': options.holdMs = Number(value()); break;
      case '--lead-model': options.leadModel = value(); break;
      case '--role-models': options.roleModels = value(); break;
      case '--lock': options.lock = resolve(expandHome(value())); break;
      case '--no-screenshot': options.screenshot = false; break;
      case '--check-cap': options.checkCap = true; break;
      case '--list': options.list = true; break;
      case '--help': case '-h': options.help = true; break;
      default: throw new Error(`unknown option ${arg}`);
    }
  }
  options.lane = resolve(options.lane ?? join(scratchDir, `lane-${options.work}`));
  return options;
}

function freePort() {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

function systemd(args) {
  return execFileSync('systemctl', ['--user', ...args], { encoding: 'utf8' }).trim();
}

function readScope(unit) {
  const text = systemd(['show', `${unit}.scope`, '-p', 'MemoryMax', '-p', 'MemorySwapMax', '-p', 'MemoryPeak', '--no-pager']);
  const values = Object.fromEntries(text.split('\n').filter(Boolean).map(line => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  }));
  const bytes = Number(values.MemoryPeak);
  return {
    memoryMax: values.MemoryMax ?? null,
    memorySwapMax: values.MemorySwapMax ?? null,
    memoryPeakMb: Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes / 1048576) : null,
  };
}

function capHolds(scope) {
  return Number(scope.memoryMax) === CAP_BYTES && String(scope.memorySwapMax) === MEMORY_SWAP_MAX;
}

function stopScope(unit) {
  try { systemd(['stop', `${unit}.scope`]); } catch {}
}

function ensureLaneFiles(options) {
  mkdirSync(options.lane, { recursive: true });
  mkdirSync(join(options.lane, 'flow'), { recursive: true });
  mkdirSync(join(options.lane, 'gh-none'), { recursive: true });
  const leadFile = join(options.lane, 'lead-model');
  if (!existsSync(leadFile)) writeFileSync(leadFile, `${options.leadModel}\n`, { mode: 0o600 });
  const roleFile = join(options.lane, 'lead-role-models.md');
  if (options.roleModels) copyFileSync(options.roleModels, roleFile);
  else if (!existsSync(roleFile)) writeFileSync(roleFile, ROLE_MODELS);
  return { flow: join(options.lane, 'flow'), leadFile, roleFile };
}

function credentials(env = process.env) {
  return CREDENTIALS.filter(name => typeof env[name] === 'string' && env[name] !== '');
}

async function bootStudio(options, files) {
  const unit = `jul342-lane-${process.pid}`;
  const port = await freePort();
  const log = join(options.lane, 'studio.log');
  writeFileSync(log, '');
  stopScope(unit);
  const args = [
    '--user', '--scope', '-q',
    '-p', `MemoryMax=${MEMORY_MAX}`, '-p', `MemorySwapMax=${MEMORY_SWAP_MAX}`,
    `--unit=${unit}`, '--setenv=HOME=' + homedir(), '--setenv=HOST=127.0.0.1',
    `--setenv=PORT=${port}`, '--setenv=NODE_OPTIONS=--max-old-space-size=1500',
    '--setenv=MASTRA_TELEMETRY_DISABLED=1',
    `--setenv=FLOW_DIR=${files.flow}`, `--setenv=FLOW_REPO=${resolve(options.repo)}`,
    `--setenv=JULIA_LEAD_MODEL_FILE=${files.leadFile}`,
    `--setenv=JULIA_LEAD_ROLE_MODELS_FILE=${files.roleFile}`,
    `--setenv=GH_CONFIG_DIR=${join(options.lane, 'gh-none')}`,
    ...credentials().map(name => `--setenv=${name}`),
    '--', 'npx', '--yes', 'mastra@1.38.0', 'dev',
  ];
  const child = spawn('systemd-run', args, {
    cwd: options.repo, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SENTRY_DSN: '' },
  });
  let tail = '';
  let spawnError = null;
  child.on('error', error => { spawnError = error; });
  const keep = chunk => {
    tail = (tail + chunk).slice(-8000);
    writeFileSync(log, tail);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  const deadline = Date.now() + 360000;
  while (Date.now() < deadline) {
    if (spawnError) throw new Error(`cannot start Studio: ${spawnError.message}`);
    if (child.exitCode !== null) throw new Error(`Studio exited with code ${child.exitCode}\n${tail.slice(-2000)}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/workflows`, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const form = runForm(await response.json());
        if (form.failures.length) throw new Error(`the run form is not ready: ${form.failures.join(' ')}`);
        const scope = readScope(unit);
        if (!capHolds(scope)) {
          throw new Error(`Studio started without its cap: MemoryMax=${scope.memoryMax}, MemorySwapMax=${scope.memorySwapMax}`);
        }
        return { child, port, unit, scope, form, log };
      }
    } catch (error) {
      if (/the run form is not ready|without its cap/.test(error.message)) throw error;
    }
    await delay(1500);
  }
  throw new Error(`Studio never answered on port ${port}\n${tail.slice(-2000)}`);
}

function stopStudio(studio) {
  if (!studio) return;
  try { process.kill(-studio.child.pid, 'SIGKILL'); } catch {}
  stopScope(studio.unit);
}

async function requestJson(port, path, init = {}, timeoutMs = 60000) {
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { status: response.status, ok: response.ok, body, text };
}

// One practice run per piece of work. A completed run is read back from the
// work's own directory, so a later invocation with another scenario reads the
// same run instead of starting a second one.
async function ensurePracticeRun(options, studio, practiceDir) {
  const file = join(practiceDir, 'practice.json');
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    const finishedWell = saved.status === 'success' || saved.status === 'completed';
    if (saved.card === options.card && finishedWell) {
      return { ...saved, reused: true };
    }
  }
  if (!options.card) throw new Error('this scenario reads a practice run and needs --card <id>');
  if (!studio) throw new Error(`no completed practice run in ${practiceDir}; start Studio by running a scenario that needs it first`);
  mkdirSync(practiceDir, { recursive: true });
  const startedAt = now();
  const response = await requestJson(studio.port, '/workflows/card-path/start-async', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inputData: { card: options.card, kind: 'machine' } }),
  });
  let runId = response.body?.runId ?? response.body?.result?.runId ?? null;
  let status = response.ok ? 'running' : `http-${response.status}`;
  const deadline = Date.now() + options.seconds * 1000;
  while (runId && !TERMINAL.has(status) && Date.now() < deadline) {
    await delay(5000);
    const poll = await requestJson(studio.port, `/workflows/card-path/runs/${encodeURIComponent(runId)}`, {}, 15000).catch(() => null);
    if (poll?.body?.status) status = poll.body.status;
  }
  if (runId && !TERMINAL.has(status) && Date.now() >= deadline) status = 'timeout';
  if (!runId) status = 'unstarted';
  const trace = join(studio.flow, 'trace.duckdb');
  if (existsSync(trace)) {
    try { copyFileSync(trace, join(practiceDir, 'trace.duckdb')); } catch {}
  }
  const record = {
    work: options.work, card: options.card, runId, status,
    startedAt, finishedAt: now(), seconds: options.seconds,
    studio: { port: studio.port, unit: studio.unit },
    startHttpStatus: response.status,
    startBody: response.body ?? response.text.slice(0, 500),
    trace: existsSync(join(practiceDir, 'trace.duckdb')) ? join(practiceDir, 'trace.duckdb') : null,
    reused: false,
  };
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

const scenarios = new Map();

function defineScenario(definition) {
  scenarios.set(definition.name, { needsStudio: false, readsPractice: false, ...definition });
}

defineScenario({
  name: 'noop',
  title: 'Runner no-op: lock, lane folder and evidence path',
  run: async ({ options, laneFiles }) => ({
    facts: {
      'Lane folder': options.lane,
      'Lock file': options.lock,
      'Lead model file': laneFiles.leadFile,
      'Role models file': laneFiles.roleFile,
      'Studio started': 'no — the no-op starts no Studio and no card',
    },
  }),
});

defineScenario({
  name: 'studio-smoke',
  title: 'Studio smoke: the card-path run form is served under the cap',
  needsStudio: true,
  run: async ({ studio }) => {
    const agents = await requestJson(studio.port, '/agents', {}, 15000).catch(() => null);
    const names = agents?.body ? Object.values(agents.body).map(agent => agent?.name).filter(Boolean) : [];
    return {
      facts: {
        'Studio port': String(studio.port),
        'Studio unit': studio.unit,
        'MemoryMax': studio.scope.memoryMax,
        'MemorySwapMax': studio.scope.memorySwapMax,
        'Run form fields': studio.form.fields.join(', '),
        'Agents served': names.join(', ') || 'none read',
      },
    };
  },
});

defineScenario({
  name: 'practice-run',
  title: 'Practice run: one card-path run, reusable by later scenarios',
  needsStudio: true,
  readsPractice: true,
  run: async ({ options, practice }) => ({
    facts: {
      'Practice card': practice.card,
      'Run id': practice.runId ?? 'none',
      'Run status': practice.status,
      'Run directory': join(options.lane, 'runs', options.work),
      'Practice run reused': practice.reused ? 'yes' : 'no — this scenario started it',
      'Trace copy': practice.trace ?? 'none',
    },
  }),
});

export function scenarioNames() {
  return [...scenarios.keys()];
}

async function renderSheet({ out, title, subtitle, rows, log }) {
  const { chromium } = await import('@playwright/test');
  const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = [
    '<!doctype html><meta charset="utf-8">',
    '<style>',
    'body{font:14px/1.55 ui-sans-serif,system-ui,sans-serif;padding:26px;color:#111;max-width:1180px}',
    'h1{font-size:20px;margin:0 0 2px}.meta{color:#555;font-size:12.5px;margin:0 0 16px}',
    'table{border-collapse:collapse;width:100%}td,th{border:1px solid #c9c9c9;padding:6px 9px;text-align:left;vertical-align:top}',
    'th{background:#f2f2f2;width:250px;font-weight:600}',
    '.ok{color:#0a7a2f;font-weight:700}.bad{color:#a81717;font-weight:700}',
    'pre{white-space:pre-wrap;word-break:break-word;background:#f7f7f7;border:1px solid #ddd;padding:9px;font:12px/1.45 ui-monospace,monospace;margin:0;max-height:420px;overflow:auto}',
    '</style>',
    `<h1>${esc(title)}</h1>`,
    `<p class="meta">${esc(subtitle)}</p>`,
    '<table>',
    ...rows.map(([key, value]) => `<tr><th>${esc(key)}</th><td>${value}</td></tr>`),
    '</table>',
    log ? `<h1 style="font-size:16px;margin:18px 0 6px">${esc(log.title)}</h1><pre>${esc(log.text)}</pre>` : '',
  ].join('\n');
  const file = out.replace(/\.png$/, '.html');
  writeFileSync(file, html);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(`file://${file}`, { waitUntil: 'domcontentloaded' });
    await page.screenshot({ path: out, fullPage: true });
  } finally {
    await browser.close();
  }
  return out;
}

async function checkCap(options) {
  const unit = `jul342-lane-cap-${process.pid}`;
  const child = spawn('systemd-run', [
    '--user', '--scope', '-q',
    '-p', `MemoryMax=${MEMORY_MAX}`, '-p', `MemorySwapMax=${MEMORY_SWAP_MAX}`,
    `--unit=${unit}`, '--', 'sleep', '5',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let spawnError = null;
  child.on('error', error => { spawnError = error; });
  let scope = null;
  for (let attempt = 0; attempt < 20 && !scope && !spawnError; attempt += 1) {
    await delay(250);
    try { scope = readScope(unit); } catch {}
  }
  stopScope(unit);
  const passed = Boolean(scope) && !spawnError && capHolds(scope);
  const record = {
    scenario: 'check-cap', work: options.work, lane: options.lane,
    startedAt: now(), finishedAt: now(), status: passed ? 'passed' : 'failed',
    facts: {
      'Cap under test': `MemoryMax=${MEMORY_MAX}, MemorySwapMax=${MEMORY_SWAP_MAX}`,
      'MemoryMax read back': scope?.memoryMax ?? 'not read',
      'MemorySwapMax read back': scope?.memorySwapMax ?? 'not read',
      'Expected MemoryMax bytes': String(CAP_BYTES),
      'Scope start': spawnError ? `error: ${spawnError.message}` : 'ok',
    },
    screenshot: null,
  };
  if (options.screenshot) {
    record.screenshot = await renderSheet({
      out: join(options.lane, 'check-cap.png'),
      title: 'Lane runner: the 2200M / no-swap cap on a sleep scope',
      subtitle: `${now()} | ${process.platform} | no Studio and no card started`,
      rows: Object.entries(record.facts).map(([key, value]) => [key, `<code>${String(value)}</code>`]),
    }).catch(error => { record.screenshotError = error.message; return null; });
  }
  writeFileSync(join(options.lane, 'check-cap.json'), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

async function runScenarios(options, laneFiles) {
  const names = options.scenario;
  const unknown = names.filter(name => !scenarios.has(name));
  if (unknown.length) throw new Error(`unknown scenario ${unknown.join(', ')}; known: ${scenarioNames().join(', ')}`);
  const chosen = names.map(name => scenarios.get(name));
  const practiceDir = join(options.lane, 'runs', options.work);
  let studio = null;
  let practice = null;
  const results = [];
  try {
    if (chosen.some(scenario => scenario.needsStudio)) studio = await bootStudio(options, laneFiles);
    for (const scenario of chosen) {
      const startedAt = now();
      if (scenario.readsPractice && !practice) practice = await ensurePracticeRun(options, studio, practiceDir);
      let outcome;
      try {
        outcome = await scenario.run({ options, laneFiles, studio, practice });
      } catch (error) {
        outcome = { error: error.message };
      }
      const snapshot = studio ? { ...readScope(studio.unit) } : null;
      const record = {
        scenario: scenario.name, title: scenario.title, work: options.work,
        lane: options.lane, startedAt, finishedAt: now(),
        status: outcome.error ? 'failed' : 'passed',
        facts: {
          ...outcome.facts,
          ...(snapshot ? { 'Peak RSS (MB)': String(snapshot.memoryPeakMb ?? 'not read') } : {}),
        },
        error: outcome.error ?? null,
        practice: scenario.readsPractice ? practice : null,
        studio: studio ? { port: studio.port, unit: studio.unit, cap: snapshot } : null,
        screenshot: null,
      };
      if (options.screenshot) {
        record.screenshot = await renderSheet({
          out: join(options.lane, `${scenario.name}.png`),
          title: scenario.title,
          subtitle: `${now()} | work ${options.work} | ${outcome.error ? 'FAILED' : 'PASSED'}`,
          rows: Object.entries(record.facts).map(([key, value]) => [key, `<code>${String(value)}</code>`]),
          log: outcome.error ? { title: 'Error', text: outcome.error } : null,
        }).catch(error => { record.screenshotError = error.message; return null; });
      }
      writeFileSync(join(options.lane, `${scenario.name}.json`), `${JSON.stringify(record, null, 2)}\n`);
      results.push(record);
      console.log(JSON.stringify({ event: 'scenario', scenario: scenario.name, status: record.status, result: join(options.lane, `${scenario.name}.json`) }));
    }
  } finally {
    stopStudio(studio);
  }
  return results;
}

function withLock(options) {
  mkdirSync(dirname(options.lock), { recursive: true });
  return new Promise(resolvePromise => {
    const child = spawn('flock', [
      '-n', '-E', String(LOCK_BUSY), options.lock,
      process.execPath, SELF, ...process.argv.slice(2),
    ], { stdio: 'inherit', env: { ...process.env, [LOCK_HELD_ENV]: '1' } });
    child.on('error', error => {
      console.error(`run-lane: cannot hold the live lock with flock: ${error.message}`);
      resolvePromise(1);
    });
    child.on('exit', code => {
      if (code === LOCK_BUSY) {
        console.error(`run-lane: refused — another lane runner holds ${options.lock}. One Studio copy at a time.`);
        resolvePromise(2);
        return;
      }
      resolvePromise(code ?? 1);
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(usage()); return 0; }
  if (options.list) {
    console.log(JSON.stringify([...scenarios.values()].map(({ name, title, needsStudio, readsPractice }) => ({ name, title, needsStudio, readsPractice })), null, 2));
    return 0;
  }
  if (!options.checkCap && options.scenario.length === 0) {
    throw new Error('name a scenario with --scenario, or use --list');
  }
  if (process.env[LOCK_HELD_ENV] !== '1') return withLock(options);

  const laneFiles = ensureLaneFiles(options);
  console.log(JSON.stringify({ event: 'locked', lock: options.lock, pid: process.pid, lane: options.lane }));
  if (options.holdMs > 0) await delay(options.holdMs);

  if (options.checkCap) {
    const record = await checkCap(options);
    console.log(JSON.stringify({ event: 'check-cap', status: record.status, result: join(options.lane, 'check-cap.json') }));
    return record.status === 'passed' ? 0 : 1;
  }

  const results = await runScenarios(options, laneFiles);
  const failed = results.filter(result => result.status !== 'passed');
  console.log(JSON.stringify({ event: 'done', scenarios: results.map(result => ({ scenario: result.scenario, status: result.status })), failed: failed.length }));
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  main()
    .then(code => { process.exitCode = code; })
    .catch(error => {
      console.error(`run-lane: ${error.message}`);
      process.exitCode = 1;
    });
}
