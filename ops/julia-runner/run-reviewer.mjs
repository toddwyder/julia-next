// run-reviewer.mjs -- the graph's independent reviewer (JUL-128).
//
// Installed root-owned at /opt/julia-runner/ops/julia-runner/run-reviewer.mjs
// and started only by `sudo -n -u runner /usr/bin/node <this file>`
// (./sudoers). It reads {reviewer, prompt, limit_seconds} as JSON on stdin,
// where reviewer is 'codex' or 'deepseek', runs that reviewer from / (it never
// needs the card's working copy, which runner cannot read), and answers with
// one JSON line:
//
//   {status: 'ok', text, model}    the run finished; text is its final
//                                  message, where the graph reads the verdict
//   {status: 'failed', error, text, model}  a crash, a vendor error, an
//                                  abnormal exit: never a verdict
//
// model is what the reviewer itself reports it ran (Codex's session log, Pi's
// final message), not what was asked for.
//
// The reviewer runs in its own process group under its time limit
// (time-limit.mjs runLimited), so at the limit, or when the graph stops this
// launcher (SIGTERM, passed on by sudo), every process it started is stopped
// with it: Pi's or Codex's own children included. A stopped reviewer exits
// STOPPED_EXIT (124) and says so on stderr. runner also hosts Orca's server,
// so its other processes are never swept.
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPiSpawnSpec, parsePiJsonStream } from '../service-dropbox/run-pi-seat.mjs';
import { limitSeconds, runLimited, STOPPED_EXIT, stoppedLine } from './time-limit.mjs';

// Seconds, as time-limit.mjs LIMITS does for the builder and the tests.
export const LIMIT = { fallback: 20 * 60, max: 60 * 60 };
export const CODEX_MODEL = 'gpt-5.5';
// sudo resets PATH to its root-owned secure_path; nothing else of the caller's environment passes.
const ENV = { HOME: homedir(), PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C.UTF-8' };

// How each reviewer is started: always read-only, always from /.
export const REVIEWERS = {
  codex: () => ({
    command: 'codex',
    args: ['exec', '-m', CODEX_MODEL, '-c', 'model_reasoning_effort=high', '-s', 'read-only', '--skip-git-repo-check', '--json', '-'],
    env: ENV,
    stdin: true,
  }),
  // DeepSeek V4 Pro through the reviewer seat's own settings (run-pi-seat.mjs
  // SEATS['reviewer-backup']): its key reaches Pi's environment only.
  deepseek: (prompt) => {
    const spec = buildPiSpawnSpec('reviewer-backup', prompt, { mode: 'json', effort: 'high' });
    return { command: spec.command, args: spec.args, env: { ...ENV, ...pickKey(spec.env) }, stdin: false };
  },
};

function pickKey(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => name === 'COMMANDCODE_API_KEY'));
}

const json = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

// Codex (`codex exec --json`): the last agent message of a completed turn.
export function codexReply(stdout) {
  let thread = null;
  let text = null;
  let error = null;
  let completed = false;
  for (const event of String(stdout).split('\n').map(json)) {
    if (!event) continue;
    if (event.type === 'thread.started') thread = event.thread_id;
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') text = event.item.text;
    if (event.type === 'turn.completed') completed = true;
    if (event.type === 'turn.failed') error = event.error?.message ?? 'the turn failed';
    if (event.type === 'error') error = event.message ?? 'Codex reported an error';
  }
  if (error) return { ok: false, error, text, thread };
  if (!completed) return { ok: false, error: 'the turn did not complete', text, thread };
  return { ok: true, text: text ?? '', thread };
}

// The model a Codex run really used: its session log's turn_context.
export function codexModel(thread, { root = join(homedir(), '.codex', 'sessions'), read = readFileSync, list = readdirSync } = {}) {
  if (!thread) return null;
  const walk = (dir) => {
    for (const entry of list(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = walk(path);
        if (found) return found;
      } else if (entry.name.includes(thread) && entry.name.endsWith('.jsonl')) return path;
    }
    return null;
  };
  try {
    const log = walk(root);
    if (!log) return null;
    const context = read(log, 'utf8').split('\n').map(json).find((e) => e?.type === 'turn_context');
    return context?.payload?.model ?? null;
  } catch {
    return null;
  }
}

// Pi (the DeepSeek seat's stream): the last assistant message that ended the
// turn. agent_end repeats messages, sometimes without their text, so only
// message_end counts.
export function piReply(stdout) {
  const vendor = parsePiJsonStream(stdout);
  let final = null;
  for (const event of String(stdout).split('\n').map(json)) {
    if (event?.type === 'message_end' && event.message?.role === 'assistant') final = event.message;
  }
  const text = !final ? null : typeof final.content === 'string' ? final.content
    : (final.content ?? []).filter((part) => part?.type === 'text').map((part) => part.text).join('');
  const model = final?.model ?? null;
  if (!vendor.ok) return { ok: false, error: vendor.errorText, text, model };
  if (final?.stopReason !== 'stop') return { ok: false, error: 'the reviewer did not finish its turn', text, model };
  return { ok: true, text, model };
}

export async function review(request, { run = runLimited, model = codexModel, onOutput = () => {}, reviewers = REVIEWERS } = {}) {
  const which = request?.reviewer;
  if (!Object.hasOwn(reviewers, which)) return { status: 'failed', error: `refused: unknown reviewer ${JSON.stringify(which)}` };
  if (typeof request.prompt !== 'string' || !request.prompt.trim()) return { status: 'failed', error: 'refused: no prompt' };
  const seconds = limitSeconds(request.limit_seconds, LIMIT);
  let spec;
  try {
    spec = reviewers[which](request.prompt);
  } catch (error) {
    return { status: 'failed', error: `refused: ${error.message}` };
  }
  let stdout = '';
  let stderr = '';
  const options = { cwd: '/', env: spec.env, stdio: [spec.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] };
  const result = await run(spec.command, spec.args, options, {
    seconds,
    started: (child) => {
      child.stdout.on('data', (chunk) => { stdout += chunk; onOutput(); });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      if (spec.stdin) child.stdin.end(request.prompt);
    },
  });
  if (result.stopped) return { status: 'stopped', error: stoppedLine(seconds) };
  if (result.error) return { status: 'failed', error: `the reviewer did not start: ${result.error.message}` };
  const reply = which === 'codex' ? codexReply(stdout) : piReply(stdout);
  const ran = which === 'codex' ? model(reply.thread) : reply.model;
  const tail = stderr.trim().split('\n').slice(-3).join(' | ').slice(-500);
  if (result.code !== 0) {
    return { status: 'failed', error: `the reviewer exited ${result.code ?? result.signal}: ${reply.error ?? tail}`, text: reply.text, model: ran };
  }
  if (!reply.ok) return { status: 'failed', error: reply.error, text: reply.text, model: ran };
  return { status: 'ok', text: reply.text, model: ran };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // A progress line at most once a second while the reviewer prints; the answer is the last line.
  let last = 0;
  const onOutput = () => {
    if (Date.now() - last < 1000) return;
    last = Date.now();
    process.stdout.write('{"progress":true}\n');
  };
  // The graph stops this launcher with SIGTERM (through sudo). runLimited's
  // group is stopped by the limit; this stops it now, with everything in it.
  let group = null;
  const stop = () => {
    if (group) {
      try { process.kill(-group, 'SIGKILL'); } catch { /* already gone */ }
    }
    console.error('stopped: the graph stopped the reviewer');
    process.exit(STOPPED_EXIT);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  const request = json(readFileSync(0, 'utf8'));
  const run = (command, args, options, limits) => runLimited(command, args, options, {
    ...limits, started: (child) => { group = child.pid; limits.started(child); },
  });
  review(request, { run, onOutput }).then((reply) => {
    if (reply.status === 'stopped') {
      console.error(reply.error);
      process.exit(STOPPED_EXIT);
    }
    process.stdout.write(`${JSON.stringify(reply)}\n`);
  });
}
