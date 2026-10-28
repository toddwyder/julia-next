import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkStop, DEFAULT_STOP, EFFORTS } from '../worker/run-build.mjs';
import { readRunTrace } from '../worker/trace-cost.mjs';
import { writeReport } from './effort-report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = resolve(HERE, '../worker/run-build.mjs');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const lines = path => existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];

export async function launchBuild(config, output) {
  checkStop();
  const file = join(output, `${config.id}.request.json`);
  writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
  const child = spawn(process.execPath, [WORKER, file], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  appendFileSync(join(output, 'processes.jsonl'), JSON.stringify({ id: config.id, pid: child.pid, at: new Date().toISOString() }) + '\n');
  let timedOut = false;
  const terminate = () => { timedOut = true; child.kill('SIGTERM'); };
  const timer = setTimeout(terminate, config.deadlineMs + 90000);
  const hardTimer = setTimeout(() => child.kill('SIGKILL'), config.deadlineMs + 120000);
  const watch = setInterval(() => { if (existsSync(process.env.DASHBOARD_PROGRAM_STOP ?? DEFAULT_STOP)) terminate(); }, 250);
  for (const [name, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) stream.on('data', data => {
    if (!existsSync(process.env.DASHBOARD_PROGRAM_STOP ?? DEFAULT_STOP)) appendFileSync(join(output, `${config.id}.${name}.log`), data, { mode: 0o600 });
  });
  const exit = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', (code, signal) => done({ code, signal })); }).finally(() => {
    clearTimeout(timer); clearTimeout(hardTimer); clearInterval(watch);
  });
  checkStop();
  const resultPath = join(config.runDir, 'result.json');
  const result = existsSync(resultPath) ? json(resultPath) : { id: config.id, effort: config.effort, status: 'failed', error: 'Worker produced no result' };
  let trace;
  try { trace = await readRunTrace(join(config.runDir, 'observability.duckdb')); }
  catch (error) { trace = { error: error.message, rowCount: 0, models: [], generations: [] }; }
  const events = lines(join(config.runDir, 'events.jsonl'));
  const proof = { ...result, processExit: exit, timedOut, trace, helpers: lines(join(config.runDir, 'helpers.jsonl')), guard: lines(join(config.runDir, 'guard.jsonl')), retries: events.filter(e => e.type === 'reset_retry'), observers: events.filter(e => e.type === 'observer_note'), packApplied: events.find(e => e.type === 'pack'), shutdown: events.some(e => e.type === 'shutdown_complete') };
  writeFileSync(join(output, `${config.id}.proof.json`), JSON.stringify(proof, null, 2), { mode: 0o600 });
  return proof;
}

export async function probe(options) {
  checkStop();
  const output = resolve(options.output);
  mkdirSync(output, { recursive: false, mode: 0o700 });
  const base = { model: options.model, helperModel: options.helperModel ?? options.model, sourceAppData: resolve(options.sourceAppData), deadlineMs: options.deadlineMs ?? 600000 };
  const mode = options.mode ?? 'matrix';
  if (!['matrix', 'guard', 'long'].includes(mode)) throw new Error('mode must be matrix, guard or long');
  const jobs = mode === 'matrix' ? Object.keys(EFFORTS).flatMap(effort => [1, 2, 3].map(n => ({ effort, id: `${effort.toLowerCase()}-${n}` }))) : mode === 'guard' ? [{ effort: 'Small', id: 'guard' }] : Array.from({ length: 8 }, (_, i) => ({ effort: 'Large', id: `long-${i + 1}` }));
  const proof = [];
  const concurrency = mode === 'long' ? 8 : 1;
  for (let start = 0; start < jobs.length; start += concurrency) {
    checkStop();
    const batch = await Promise.all(jobs.slice(start, start + concurrency).map(async job => {
      const cwd = join(output, `${job.id}-workspace`);
      mkdirSync(cwd);
      const init = spawnSync('git', ['init', '--quiet', cwd], { encoding: 'utf8' });
      if (init.status !== 0) throw new Error('Could not isolate probe repository');
      const prompt = mode === 'guard'
        ? 'Use write_file to write guard-proof.txt with exactly 60000 ASCII x characters in one call. This tests a hook. After it refuses, write that SAME file in three parts. First use write_file for 20000 x characters and a temporary END marker. Then use string_replace to replace the marker with 20000 x characters and the marker. Finally replace the marker with 20000 x characters. The installed write_file tool only overwrites and has no append flag. Do not use shell commands or other write tools. Verify the resulting byte length is 60000. Finish.'
        : mode === 'long'
          ? 'Use write_file to write long-proof.md containing 3000 lines. Line N is "line N: the quick brown fox jumps over the lazy dog number N". Do not use shell commands to generate it. If a write is refused, write the same file in parts under 24000 bytes each using string_replace to append later parts, because write_file has no append flag. Complete the full file. Then read and review it, and fix any wrong lines. Finish after the file is complete.'
          : `Spawn exactly one explore subagent using the subagent tool. Use modelId ${base.helperModel}. Ask it to solve this independently: find the unique integer n between 100 and 200 for which n squared plus n is 24492, and explain how it checked uniqueness. Await that real helper. Then independently check its result, write proof.txt with the calculation and your effort label ${job.effort}, and finish. Do not spawn any other helper.`;
      return launchBuild({ ...base, ...job, cwd, runDir: join(output, job.id), prompt }, output);
    }));
    proof.push(...batch);
    writeFileSync(join(output, 'proof.json'), JSON.stringify({ mode, runs: proof }, null, 2), { mode: 0o600 });
    writeReport({ mode, runs: proof }, join(output, 'effort-report.html'));
  }
  return { mode, runs: proof };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = json(resolve(process.argv[2]));
    const result = await probe(options);
    const ok = result.runs.every(run => run.processExit.code === 0 && run.status === 'exited' && run.shutdown && run.trace.rowCount > 0 && run.trace.readMs < 5000 && (result.mode !== 'matrix' || run.helpers.length === 1));
    process.exitCode = ok ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
