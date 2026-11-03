// The runs page, fetched over HTTP from a real Next server, with a run the real
// entry point wrote into a real store (JUL-330, done-means 1 to 3).
//
// The other tests read the store and the pages' code. This one answers the
// question those cannot: when a run is written, does the page a person opens
// show it, with its stages and their times, and does a run written afterwards
// show up on the next load. The stages are stand-ins, so no build, review or
// merge runs; everything between the stage exit code and the rendered page is
// the real thing.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { missingProgram } from '../shipping/harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidence = path.join(root, '.artifacts', 'machine');
const dashboard = path.join(root, 'dashboard');
const nextBin = path.join(dashboard, 'node_modules', 'next', 'dist', 'bin', 'next');
const RUNS_APPEAR_WITHIN_MS = 60_000;

const missing = missingProgram();
const skip = missing
  ? `the installed Mastra Code program is incomplete: ${missing}`
  : existsSync(nextBin)
    ? false
    : `the dashboard's Next program is not installed at ${nextBin}`;

// A run keeps evidence under .artifacts/machine/<run id>. Test files in this
// suite start runs of their own at the same time, so this test removes the runs
// for its own cards and leaves every other card's evidence alone.
function removeRunsFor(cards) {
  const endings = cards.map(card => `-${card}`);
  let names;
  try {
    names = readdirSync(evidence);
  } catch {
    return;
  }
  for (const name of names) {
    if (endings.some(ending => name.endsWith(ending))) rmSync(path.join(evidence, name), { recursive: true, force: true });
  }
}

// Each stage is a program on disk that exits with a code, the same way the
// store and entry point tests stand in for the stages.
function workspace() {
  const dir = mkdtempSync(path.join(tmpdir(), 'machine-runs-page-'));
  const program = (name, body) => {
    const file = path.join(dir, name);
    writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return file;
  };
  const runs = path.join(dir, 'runs');
  const env = {
    ...process.env,
    MACHINE_RUNS_DIR: runs,
    JULIA_TRACES_DIR: path.join(dir, 'traces'),
    MACHINE_BUILD: program('build', 'exit 0'),
    MACHINE_FIND_PR: program('find-pr', 'echo 431'),
    MACHINE_REMEDIATION: program('remediation', 'exit 0'),
    MACHINE_LANDING: program('landing', 'exit 0'),
  };
  delete env.MASTRA_OBSERVABILITY_DB_PATH;
  return { dir, runs, env };
}

function runMachine(card, env) {
  return execFileSync(process.execPath, ['machine/run.mjs', card], { cwd: root, env, encoding: 'utf8', timeout: 120_000 });
}

function recordNames(runs) {
  return readdirSync(runs).filter(name => name.endsWith('.json'));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startDashboard(env) {
  const port = await freePort();
  const output = [];
  const child = spawn(process.execPath, [nextBin, 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: dashboard,
    env: { ...env, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout.on('data', chunk => output.push(String(chunk)));
  child.stderr.on('data', chunk => output.push(String(chunk)));
  return {
    url: `http://127.0.0.1:${port}`,
    output,
    stop: () => new Promise(resolve => {
      child.once('exit', resolve);
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }),
  };
}

// The first request to a page compiles it, so a miss is expected early and says
// nothing about the run.
async function page(url, wanted, { output = [], timeout = 180_000 } = {}) {
  const deadline = Date.now() + timeout;
  let last = 'no request answered yet';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      const text = await response.text();
      if (response.ok && wanted(text)) return text;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.fail(`${url} never showed what the test waits for (${last})\n${output.join('').slice(-4000)}`);
}

test('a run written by the entry point is on the page, and the next run shows within a minute', { skip }, async () => {
  const w = workspace();
  let dashboardServer;
  try {
    runMachine('JUL-640', w.env);
    const [first] = recordNames(w.runs);
    const firstRecord = JSON.parse(readFileSync(path.join(w.runs, first), 'utf8'));
    assert.equal(firstRecord.card, 'JUL-640');
    assert.equal(firstRecord.steps.length, 3);

    dashboardServer = await startDashboard(w.env);
    const listUrl = `${dashboardServer.url}/runs`;
    const list = await page(listUrl, text => text.includes('JUL-640'), { output: dashboardServer.output });

    assert.ok(list.includes(firstRecord.id), 'the page names the run');
    assert.match(list, /succeeded/, 'the page says how the run ended');

    const detail = await page(`${dashboardServer.url}/runs/${firstRecord.id}`,
      text => text.includes('JUL-640') && text.includes('landing'),
      { output: dashboardServer.output });
    for (const stage of ['build', 'remediation', 'landing']) {
      assert.ok(detail.includes(`>${stage}<`), `the detail page shows the ${stage} stage`);
    }
    assert.match(detail, /Started/);
    assert.match(detail, /Ended/);
    assert.match(detail, /UTC/, 'the page shows when a stage started and ended');
    assert.match(detail, /succeeded/);

    // The second run is written while the dashboard is up, so the measurement
    // is the one a person would make: how long until the page they reload
    // shows the run that just started.
    const secondStart = Date.now();
    runMachine('JUL-641', w.env);
    const second = JSON.parse(readFileSync(path.join(w.runs, recordNames(w.runs).filter(name => name !== first)[0]), 'utf8'));

    const refreshed = await page(listUrl, text => text.includes(second.id), { output: dashboardServer.output, timeout: RUNS_APPEAR_WITHIN_MS });
    const elapsed = Date.now() - secondStart;
    assert.ok(elapsed < RUNS_APPEAR_WITHIN_MS, `the second run took ${elapsed}ms to show, over the minute`);
    assert.ok(refreshed.includes('JUL-640'), 'the first run is still listed');
    assert.ok(refreshed.includes('JUL-641'), 'the second run is listed');
  } finally {
    await dashboardServer?.stop();
    removeRunsFor(['JUL-640', 'JUL-641']);
    rmSync(w.dir, { recursive: true, force: true });
  }
});
