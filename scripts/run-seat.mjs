// run-seat.mjs -- JUL-98 step 8 (Todd's Decision, 23 Sep): ONE seat, run as ONE
// command, with ONE time limit, answering through FILES.
//
// This is the worker side of the single-command route. The controller
// (graph/controller/seat-run.mjs) starts it in a plain Orca terminal on the
// worker daemon, so it runs as `runner`, in the card's working copy. Nothing is
// ever typed into that terminal: the brief arrives inside the command itself,
// base64-encoded so no quoting can break it (a 40,000-character command was
// measured arriving intact through `orca terminal create --command`, 23 Sep).
//
// WHAT IT WRITES, all under the working copy's `.julia/` (git-ignored, so the
// working copy still removes cleanly -- Orca refuses to remove one holding an
// untracked file, measured 23 Sep):
//   <tag>.brief.md     the brief, as the seat was given it
//   <tag>.out          the agent's stdout (for Pi, the JSON stream its cost is read from)
//   <tag>.err          the agent's stderr
//   <tag>.run.json     this run's record: times, exit, whether it was stopped at the limit,
//                      and (Gemini) the allowance read before and after
// and the SEAT writes two files itself, as its brief tells it to:
//   <tag>.progress.jsonl  one JSON line per `status` or `heartbeat`, in the old mailbox
//                         message shape, appended as it works (Todd, 23 Sep: "no black box")
//   <tag>.answer.json     its one answer, at the end. The
// controller reads those files directly -- the controller's account can read
// the working copy (proven on the server, 23 Sep 05:00Z) -- and never the screen.
//
// EXIT STATUS is about THIS SCRIPT, not the seat: 0 once the run record is
// written, whatever the seat did; non-zero only when the script itself could
// not do its job (bad arguments, an unwritable folder). What the seat did is in
// the run record and the answer file, where the controller reads it.

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPiSpawnSpec } from '../ops/service-dropbox/run-pi-seat.mjs';
import { readAgyAllowance, geminiAllowanceFromUsage, geminiAllowanceBuckets } from '../graph/controller/cost-read.mjs';

export const SEATS = Object.freeze(['builder', 'reviewer']);
export const AGENTS = Object.freeze(['agy', 'pi', 'stand-in']);
export const EFFORTS = Object.freeze(['low', 'medium', 'high']);
export const ANSWER_DIR = '.julia';
// One round, one seat. The round is in the name so a second round can never
// read the first round's answer as its own.
export const TAG_PATTERN = /^round-[1-9]-(builder|reviewer)$/;
// How long a seat that has been told to stop gets before it is killed outright.
export const KILL_GRACE_MS = 10000;

// Which run-pi-seat.mjs route runs which DeepSeek model. The route owns the
// provider, the key and the env var; this only picks it.
export const PI_ROUTE = Object.freeze({
  'deepseek-v4-pro': 'reviewer-backup',
  'deepseek-v4-flash': 'builder-backup',
});

export function seatFiles(worktree, tag) {
  const dir = join(worktree, ANSWER_DIR);
  return {
    dir,
    brief: join(dir, `${tag}.brief.md`),
    out: join(dir, `${tag}.out`),
    err: join(dir, `${tag}.err`),
    run: join(dir, `${tag}.run.json`),
    answer: join(dir, `${tag}.answer.json`),
    progress: join(dir, `${tag}.progress.jsonl`),
    pid: join(dir, `${tag}.pid.json`),
  };
}

export function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`run-seat: unexpected argument ${JSON.stringify(arg)}`);
    const name = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`run-seat: --${name} needs a value`);
    opts[name] = value;
    i += 1;
  }
  const missing = ['seat', 'agent', 'model', 'effort', 'tag', 'timeout-seconds', 'worktree', 'brief-b64'].filter((key) => !opts[key]);
  if (missing.length) throw new Error(`run-seat: missing --${missing.join(', --')}`);
  if (!SEATS.includes(opts.seat)) throw new Error(`run-seat: --seat must be one of ${SEATS.join('|')}`);
  if (!AGENTS.includes(opts.agent)) throw new Error(`run-seat: --agent must be one of ${AGENTS.join('|')}`);
  if (!EFFORTS.includes(opts.effort)) throw new Error(`run-seat: --effort must be one of ${EFFORTS.join('|')}`);
  if (!TAG_PATTERN.test(opts.tag) || !opts.tag.endsWith(`-${opts.seat}`)) {
    throw new Error(`run-seat: --tag must look like round-1-${opts.seat}, got ${JSON.stringify(opts.tag)}`);
  }
  const timeoutSeconds = Number(opts['timeout-seconds']);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error(`run-seat: --timeout-seconds must be a positive whole number, got ${JSON.stringify(opts['timeout-seconds'])}`);
  }
  const brief = Buffer.from(opts['brief-b64'], 'base64').toString('utf8');
  if (!brief.trim()) throw new Error('run-seat: the brief decoded to nothing');
  return {
    seat: opts.seat,
    agent: opts.agent,
    model: opts.model,
    effort: opts.effort,
    tag: opts.tag,
    timeoutSeconds,
    worktree: resolve(opts.worktree),
    brief,
  };
}

// The one command each agent runs as. The brief is always the last argument
// (never through a shell), which is how every probe on 23 Sep ran them.
export function agentSpawnSpec({ agent, model, effort, brief, seat, tag, worktree }, { readSecretImpl } = {}) {
  if (agent === 'agy') {
    return {
      command: 'agy',
      args: ['-p', brief, '--model', model, '--effort', effort, '--dangerously-skip-permissions', '--output-format', 'json'],
      env: process.env,
    };
  }
  if (agent === 'pi') {
    const route = PI_ROUTE[model];
    if (!route) throw new Error(`run-seat: no Pi route runs model ${JSON.stringify(model)} (known: ${Object.keys(PI_ROUTE).join(', ')})`);
    return buildPiSpawnSpec(route, brief, { mode: 'json', effort, ...(readSecretImpl ? { readSecretImpl } : {}) });
  }
  if (agent === 'stand-in') {
    // The free stand-in: a script, no model, no spend. It lives in the working
    // copy, so it is the code under test's own copy.
    return {
      command: process.execPath,
      args: [join(worktree, 'scripts', 'stand-in-seat.mjs'), '--seat', seat, '--tag', tag, '--worktree', worktree],
      env: process.env,
    };
  }
  throw new Error(`run-seat: unknown agent ${JSON.stringify(agent)}`);
}

// A reading of the Gemini allowance, or the reason there is none. Never throws:
// a failed reading is recorded, and the controller refuses the cost line for it.
async function allowanceReading(readAllowanceImpl, cwd) {
  try {
    return { reading: geminiAllowanceFromUsage(await readAllowanceImpl({ cwd }), { buckets: geminiAllowanceBuckets() }), error: null };
  } catch (error) {
    return { reading: null, error: error.message };
  }
}

// Start the seat, stop it at the limit, record what happened. `spawnImpl`,
// `readAllowanceImpl` and `now` are injected so the tests never start an agent.
export async function runSeat(opts, {
  spawnImpl = spawn,
  readAllowanceImpl = readAgyAllowance,
  readSecretImpl,
  now = () => new Date().toISOString(),
  killGraceMs = KILL_GRACE_MS,
  killImpl = (pid, signal) => process.kill(pid, signal),
} = {}) {
  const files = seatFiles(opts.worktree, opts.tag);
  mkdirSync(files.dir, { recursive: true });
  // A leftover from an earlier run of the same tag must never be read as this
  // run's answer.
  for (const path of [files.out, files.err, files.run, files.answer, files.progress, files.pid]) rmSync(path, { force: true });
  writeFileSync(files.brief, opts.brief);

  const before = opts.agent === 'agy' ? await allowanceReading(readAllowanceImpl, opts.worktree) : null;
  const spec = agentSpawnSpec(opts, { readSecretImpl });
  const startedAt = now();
  // The first progress line is this script's own, at the moment the agent is
  // started, so the controller's five-minute stuck rule counts from a real
  // report of the seat starting, not from the terminal opening (PR #102
  // review, finding 2). Every line after it is the seat's.
  writeFileSync(files.progress, `${JSON.stringify({ type: 'status', subject: `${opts.seat} started (${opts.agent}, ${opts.model}, effort ${opts.effort})`, body: '', payload: { phase: 'starting', from: 'run-seat' }, created_at: startedAt })}\n`);
  const out = createWriteStream(files.out);
  const err = createWriteStream(files.err);

  const result = await new Promise((resolveRun) => {
    // Its own process group, so the stop reaches everything the agent started.
    const child = spawnImpl(spec.command, spec.args, { cwd: opts.worktree, env: spec.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let timedOut = false;
    let killTimer = null;
    child.stdout?.pipe(out);
    child.stderr?.pipe(err);
    // WHO THE AGENT IS, for a stop from outside. The agent runs in its own
    // process group (`detached`), whose id is its pid. A stop from the
    // controller cannot come through this script: closing an Orca terminal
    // kills what runs in it outright -- measured 2026-09-23, a probe with a
    // handler for SIGHUP, SIGTERM, SIGINT and SIGQUIT logged none of them and
    // no exit -- and the agent's own group survives that. So the controller
    // stops the GROUP itself, as the worker, and this file is how it finds it.
    writeFileSync(files.pid, `${JSON.stringify({ pid: child.pid ?? null, pgid: child.pid ?? null, startedAt })}\n`);
    const stopTimer = setTimeout(() => {
      timedOut = true;
      try { killImpl(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
      killTimer = setTimeout(() => {
        try { killImpl(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
      }, killGraceMs);
    }, opts.timeoutSeconds * 1000);
    const finish = (value) => {
      clearTimeout(stopTimer);
      clearTimeout(killTimer);
      resolveRun({ ...value, timedOut });
    };
    child.on('error', (error) => finish({ exitCode: null, signal: null, spawnError: error.message }));
    child.on('close', (exitCode, signal) => finish({ exitCode, signal, spawnError: null }));
  });
  await Promise.all([new Promise((r) => out.end(r)), new Promise((r) => err.end(r))]);
  const endedAt = now();
  const after = opts.agent === 'agy' ? await allowanceReading(readAllowanceImpl, opts.worktree) : null;

  const record = {
    seat: opts.seat,
    agent: opts.agent,
    model: opts.model,
    effort: opts.effort,
    tag: opts.tag,
    timeoutSeconds: opts.timeoutSeconds,
    startedAt,
    endedAt,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    spawnError: result.spawnError,
    answerWritten: existsSync(files.answer),
    allowanceBefore: before?.reading ?? null,
    allowanceAfter: after?.reading ?? null,
    allowanceError: before?.error ?? after?.error ?? null,
  };
  writeFileSync(files.run, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }
  try {
    const record = await runSeat(opts);
    console.log(`run-seat: ${opts.tag} ${record.timedOut ? 'stopped at its limit' : `exited ${record.exitCode ?? record.spawnError}`}; answer ${record.answerWritten ? 'written' : 'NOT written'}`);
  } catch (error) {
    console.error(`run-seat: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
