#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const artifacts = join(root, '.artifacts/verify-julia');
const runFile = join(artifacts, 'run.json');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const playwright = join(root, 'node_modules/playwright/cli.js');

function candidate() {
  const status = git('status', '--porcelain', '--untracked-files=all');
  const diff = execFileSync('git', ['diff', 'HEAD', '--binary'], { cwd: root });
  return {
    branch: git('rev-parse', '--abbrev-ref', 'HEAD').trim(),
    commit: git('rev-parse', 'HEAD').trim(),
    dirty: status.length > 0,
    worktreeSha256: createHash('sha256').update(status).update(diff).digest('hex'),
  };
}

function freePort() {
  return new Promise((done, fail) => {
    const server = createServer().once('error', fail).listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const processGroup = pid => Number(readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[2]);

function listeners(port) {
  const output = execFileSync('ss', ['-ltnpH', `sport = :${port}`], { encoding: 'utf8' });
  return [...new Set([...output.matchAll(/pid=(\d+)/g)].map(([, pid]) => Number(pid)))];
}

async function probe(url) {
  const health = await fetch(new URL('/api/health', url), { signal: AbortSignal.timeout(30_000) });
  const body = health.ok ? await health.json() : null;
  const home = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const html = await home.text();
  return { health: { status: health.status, body }, home: { status: home.status, hasMain: html.includes('<main>') } };
}

const usable = result => result.health.body?.status === 'ok' && result.home.status === 200 && result.home.hasMain;

function loadRun() {
  if (!existsSync(runFile)) throw new Error(`No active run: ${runFile} is missing. Run launch first.`);
  return JSON.parse(readFileSync(runFile, 'utf8'));
}

async function launch(args) {
  if (existsSync(runFile)) throw new Error(`A run is already active (${runFile}). Run cleanup before launching another.`);
  const urlFlag = args.indexOf('--url');
  const remoteUrl = urlFlag >= 0 ? args[urlFlag + 1] : null;
  if (urlFlag >= 0 && !remoteUrl) throw new Error('--url needs an address, for example --url https://julia-abc.vercel.app');
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
  const evidenceDir = join(artifacts, runId);
  mkdirSync(evidenceDir, { recursive: true });
  const run = { runId, session: `verify-julia-${runId}`, evidenceDir, candidate: candidate(), versions: { node: process.version, next: JSON.parse(readFileSync(join(root, 'node_modules/next/package.json'), 'utf8')).version, playwright: JSON.parse(readFileSync(join(root, 'node_modules/playwright/package.json'), 'utf8')).version } };

  if (remoteUrl) {
    Object.assign(run, { mode: 'remote', url: new URL(remoteUrl).href });
  } else {
    const port = await freePort();
    const distDir = join('.next', 'verify-julia', runId);
    const log = openSync(join(evidenceDir, 'server.log'), 'a');
    const command = [join(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)];
    const child = spawn(process.execPath, command, {
      cwd: root, detached: true, stdio: ['ignore', log, log],
      env: { ...process.env, JULIA_VERIFY_DIST_DIR: distDir, NEXT_TELEMETRY_DISABLED: '1' },
    });
    child.unref();
    Object.assign(run, { mode: 'local', url: `http://127.0.0.1:${port}/`, port, pid: child.pid, distDir, command: [process.execPath, ...command] });
  }
  writeFileSync(runFile, JSON.stringify(run, null, 2));

  const deadline = Date.now() + 120_000;
  let last = null;
  while (Date.now() < deadline) {
    if (run.mode === 'local' && !alive(run.pid)) break;
    try { last = await probe(run.url); if (usable(last)) break; } catch (error) { last = { error: error.message }; }
    await new Promise(r => setTimeout(r, 1000));
  }
  run.readiness = last;
  writeFileSync(runFile, JSON.stringify(run, null, 2));
  writeFileSync(join(evidenceDir, 'launch.json'), JSON.stringify(run, null, 2));
  console.log(JSON.stringify(run, null, 2));
  if (!last || !usable(last)) throw new Error(`Julia did not become usable at ${run.url}; see ${evidenceDir}. Run cleanup.`);
}

async function doctor() {
  const run = loadRun();
  const checks = {};
  if (run.mode === 'local') {
    const now = candidate();
    checks.sameCommit = now.commit === run.candidate.commit;
    checks.sameWorktree = now.worktreeSha256 === run.candidate.worktreeSha256;
    checks.serverAlive = alive(run.pid);
    const owners = checks.serverAlive ? listeners(run.port) : [];
    checks.portOwnedByRun = owners.length > 0 && owners.every(pid => alive(pid) && processGroup(pid) === run.pid);
    checks.listenerPids = owners;
  }
  try {
    checks.probe = await probe(run.url);
    checks.usable = usable(checks.probe);
    const served = checks.probe.health.body?.commit;
    if (run.mode === 'remote') checks.servedCommit = served ?? 'not reported';
  } catch (error) {
    checks.probe = { error: error.message };
    checks.usable = false;
  }
  const ok = Object.values(checks).every(value => typeof value !== 'boolean' || value);
  const report = { ok, runId: run.runId, url: run.url, mode: run.mode, session: run.session, candidate: run.candidate, checks, at: new Date().toISOString() };
  writeFileSync(join(run.evidenceDir, 'doctor.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!ok) process.exitCode = 1;
}

function test(specs) {
  const run = loadRun();
  if (!specs.length) throw new Error('Name at least one spec, for example .agents/skills/verify-julia/tests/home.spec.mjs');
  const result = spawnSync(process.execPath, [playwright, 'test', ...specs, '--reporter=line'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, JULIA_VERIFY_URL: run.url },
  });
  const output = `${result.stdout}${result.stderr}\nexitCode=${result.status}\n`;
  writeFileSync(join(run.evidenceDir, 'playwright-test.txt'), output);
  process.stdout.write(output);
  process.exitCode = result.status ?? 1;
}

async function cleanup() {
  const run = loadRun();
  spawnSync(process.execPath, [playwright, 'cli', `-s=${run.session}`, 'close'], { cwd: root, stdio: 'ignore' });
  if (run.mode === 'local' && alive(run.pid) && processGroup(run.pid) === run.pid) {
    process.kill(-run.pid, 'SIGTERM');
    for (let i = 0; i < 50 && alive(run.pid); i++) await new Promise(r => setTimeout(r, 100));
    if (alive(run.pid)) process.kill(-run.pid, 'SIGKILL');
  }
  if (run.distDir) rmSync(join(root, run.distDir), { recursive: true, force: true });
  rmSync(runFile);
  const kept = existsSync(join(run.evidenceDir, 'launch.json'));
  console.log(JSON.stringify({ stopped: run.mode === 'local' ? !alive(run.pid) : 'nothing to stop', evidenceDir: run.evidenceDir, evidenceKept: kept }, null, 2));
  if (!kept) process.exitCode = 1;
}

const [command, ...rest] = process.argv.slice(2);
const commands = { launch: () => launch(rest), doctor, test: () => test(rest), cleanup };
if (!commands[command]) {
  console.error('usage: verify-julia.mjs launch [--url <address>] | doctor | test <spec...> | cleanup');
  process.exit(2);
}
try { await commands[command](); } catch (error) { console.error(error.message); process.exitCode = 1; }
