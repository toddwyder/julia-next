// run-reviewer.mjs -- the graph's independent reviewer (JUL-128).
//
// Installed root-owned at /opt/julia-runner/ops/julia-runner/run-reviewer.mjs
// and started by a fixed sudo rule as runner (Codex/Pi) or gemini-worker
// (Gemini). It reads {reviewer, prompt, limit_seconds} as JSON on stdin,
// runs the selected reviewer without candidate filesystem access, and answers with
// one JSON line:
//
//   {status: 'ok', text, model}    the run finished; text is its final
//                                  message, where the graph reads the verdict
//   {status: 'failed', error, text, model}  a crash, a vendor error, an
//                                  abnormal exit: never a verdict
//
// model is what the reviewer itself reports it ran (Codex's session log, Pi's
// final message), not what was asked for. A run whose model cannot be
// confirmed is 'failed': it never counts as a review.
//
// The reviewer runs in its own systemd user unit, under reap.py, in its own
// process group, under its time limit (time-limit.mjs runLimited). reap.py is
// the reviewer's child subreaper: anything the reviewer starts stays below it,
// even a process that left the group (setsid) or double-forked, and when the
// reviewer ends, hits its limit, or the graph stops this launcher (SIGTERM,
// passed on by sudo), reap.py stops all of it. Then the scope is killed, which
// stops anything left in its cgroup however it got there. A stopped reviewer
// exits STOPPED_EXIT (124) and says so on stderr. runner also hosts Orca's
// server, so nothing is swept by account.
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPiSpawnSpec, parsePiJsonStream } from '../service-dropbox/run-pi-seat.mjs';
import { worktreeProblem } from './run-gemini.mjs';
import { limitSeconds, runLimited, STOPPED_EXIT, stoppedLine } from './time-limit.mjs';

// Seconds, as time-limit.mjs LIMITS does for the builder and the tests.
export const LIMIT = { fallback: 20 * 60, max: 60 * 60 };
export const BUILDER_LIMIT = { fallback: 60 * 60, max: 3 * 60 * 60 };
export const CODEX_MODEL = 'gpt-5.5';
export const GEMINI_MODEL = 'gemini-3.8-flash';
// The reviewer's subreaper (see above), beside this file.
export const REAPER = join(dirname(fileURLToPath(import.meta.url)), 'reap.py');
export const PYTHON = '/usr/bin/python3';
// How long reap.py is given, after SIGTERM, to sweep everything below it before
// its group is killed: at the time limit (runLimited's grace) and when the
// graph stops the launcher. It must outlast reap.py's own GRACE_SECONDS +
// KILL_SECONDS (3 + 5 s) with room to spare, or a SIGKILL could cut the sweep
// short (scripts/julia-runner-reviewer.test.mjs checks the two files agree).
export const STOP_GRACE_MS = 15_000;
// sudo resets PATH to its root-owned secure_path; nothing else of the caller's environment passes.
const ENV = { HOME: homedir(), PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C.UTF-8' };

// How each reviewer is started: always read-only, always from /.
export const REVIEWERS = {
  codex: (_prompt, _worktree, selectedModel = CODEX_MODEL) => {
    if (selectedModel !== CODEX_MODEL) throw new Error(`Codex reviewer model ${selectedModel} is not installed`);
    return {
    command: 'codex',
    args: ['exec', '-m', CODEX_MODEL, '-c', 'model_reasoning_effort=high', '-s', 'read-only', '--skip-git-repo-check', '--json', '-'],
    env: ENV,
    stdin: true,
    kind: 'codex',
    };
  },
  // DeepSeek V4 Pro through the reviewer seat's own settings (run-pi-seat.mjs
  // SEATS['reviewer-backup']): its key reaches Pi's environment only.
  deepseek: (prompt, _worktree, selectedModel = 'deepseek-v4-pro') => {
    if (selectedModel !== 'deepseek-v4-pro') throw new Error(`DeepSeek reviewer model ${selectedModel} is not installed`);
    const spec = buildPiSpawnSpec('reviewer-backup', prompt, { mode: 'json', effort: 'high' });
    return { command: spec.command, args: spec.args, env: { ...ENV, ...pickKey(spec.env) }, stdin: false, kind: 'pi' };
  },
  gemini: (_prompt, _worktree, selectedModel = GEMINI_MODEL) => {
    if (selectedModel !== GEMINI_MODEL) throw new Error(`Gemini reviewer model ${selectedModel} is not installed`);
    return {
      command: join(homedir(), '.local', 'bin', 'agy'),
      args: ['--model', selectedModel, '--effort', 'high', '--print-timeout', '0', '--input-format', 'stream-json',
        '--output-format', 'stream-json', '--disable-slash-commands'],
      env: { ...ENV, USER: 'gemini-worker' }, stdin: true, streamPrompt: true, kind: 'gemini', readOnly: true,
    };
  },
};

// The graph selects the model through MODEL_CATALOG before calling this
// account-specific launcher. A builder gets write access only to its card copy.
export const BUILDERS = {
  codex: (_prompt, worktree, selectedModel = CODEX_MODEL) => {
    if (selectedModel !== CODEX_MODEL) throw new Error(`Codex builder model ${selectedModel} is not installed`);
    return {
    command: 'codex',
    args: ['exec', '-m', CODEX_MODEL, '-c', 'model_reasoning_effort=high', '-s', 'workspace-write', '-C', worktree, '--json', '-'],
    env: ENV, stdin: true, kind: 'codex',
    };
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

// The model a Codex run really used: its session log's turn_context. The log
// is named rollout-<time>-<thread>.jsonl; only that exact thread counts, and
// it is looked for a few times in case Codex is still writing it.
export async function codexModel(thread, {
  root = join(homedir(), '.codex', 'sessions'), read = readFileSync, list = readdirSync, tries = 5, pause = 200,
} = {}) {
  if (!thread) return null;
  const walk = (dir) => {
    for (const entry of list(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = walk(path);
        if (found) return found;
      } else if (entry.name.startsWith('rollout-') && entry.name.endsWith(`-${thread}.jsonl`)) return path;
    }
    return null;
  };
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const log = walk(root);
      const context = log && read(log, 'utf8').split('\n').map(json).find((e) => e?.type === 'turn_context');
      if (context?.payload?.model) return String(context.payload.model);
    } catch { /* not there yet */ }
    if (attempt < tries) await new Promise((done) => setTimeout(done, pause));
  }
  return null;
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

// Antigravity CLI's stream: init reports the model it actually started and
// result is its final answer. A denied tool can still end with SUCCESS, so it
// never counts as a completed review.
export function geminiReply(stdout) {
  const events = String(stdout).split('\n').map(json).filter(Boolean);
  const init = events.find((event) => event.event === 'init');
  const results = events.filter((event) => event.event === 'result').map((event) => event.result);
  const final = results.at(-1);
  const model = init?.init?.model ?? null;
  const text = final?.response ?? null;
  if (!init || !final || results.some((result) => result?.conversation_id !== init.conversation_id)) {
    return { ok: false, error: 'the Gemini turn did not finish with a matching result', text, model };
  }
  const failed = results.find((result) => result.status !== 'SUCCESS' || result.denied_actions?.length);
  if (failed || !String(text ?? '').trim()) {
    return { ok: false, error: String(failed?.error ?? (failed?.denied_actions?.length ? 'Gemini was denied a tool' : 'Gemini gave no completed reply')),
      text, model };
  }
  return { ok: true, text, model };
}

// A large full diff can be clipped by a model's single-turn input handling.
// Stream bounded parts into one agy conversation; its intermediate responses
// become context for the final verdict. Every byte of the brief is sent once.
export function geminiMessages(prompt, maxBytes = 90_000) {
  const lines = prompt.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const parts = [];
  let part = '';
  let size = 0;
  const flush = () => {
    if (part) parts.push(part);
    part = '';
    size = 0;
  };
  for (const line of lines) {
    const lineSize = Buffer.byteLength(line);
    if (lineSize <= maxBytes) {
      if (size + lineSize > maxBytes) flush();
      part += line;
      size += lineSize;
      continue;
    }
    // A minified asset or lockfile can be one very long diff line. Split it
    // at Unicode character boundaries; concatenating the parts restores it.
    flush();
    for (const character of line) {
      const bytes = Buffer.byteLength(character);
      if (size + bytes > maxBytes) flush();
      part += character;
      size += bytes;
    }
  }
  flush();
  return parts.map((body, index) => {
    const content = parts.length === 1 ? body : index === parts.length - 1
      ? `Final part ${index + 1}/${parts.length} of one review. Do not use tools. Read this part and all prior parts. Now give the final verdict required by the role file.\n\n${body}`
      : `Part ${index + 1}/${parts.length} of one review. Do not use tools. Read this part and reply with concise provisional findings only. The final part will ask for a verdict.\n\n${body}`;
    return `${JSON.stringify({ event: 'user', message: { content } })}\n`;
  }).join('');
}

// Each review runs in its own systemd user scope (a cgroup): nothing its
// processes start can leave it, whether by setsid, a double fork or a scrubbed
// environment, and killing the scope kills all of it. This needs the account's
// systemd user manager (`loginctl enable-linger runner`); without one no review
// is started, since it could not be contained.
export const SCOPE_PREFIX = 'julia-review-';

// The environment that reaches the account's user manager, or null when it has none.
export function userManager({ uid = process.getuid?.(), exists = existsSync } = {}) {
  if (uid === undefined) return null;
  const dir = `/run/user/${uid}`;
  return exists(`${dir}/systemd/private`) ? { XDG_RUNTIME_DIR: dir } : null;
}

// Kill everything in the scope, pass after pass, until its cgroup is empty or
// gone. Returns the processes still in it (nothing, normally).
export async function stopScope(unit, { env, run = spawnSync, read = readFileSync, passes = 20, pause = 100 } = {}) {
  const systemctl = (...args) => run('systemctl', ['--user', ...args], { env, encoding: 'utf8' });
  let left = [];
  for (let pass = 0; pass < passes; pass += 1) {
    const cgroup = String(systemctl('show', '-p', 'ControlGroup', '--value', unit).stdout ?? '').trim();
    if (!cgroup) return []; // the scope is gone: nothing of it runs
    try {
      left = read(`/sys/fs/cgroup${cgroup}/cgroup.procs`, 'utf8').split('\n').filter(Boolean).map(Number);
    } catch {
      return []; // its cgroup is gone
    }
    if (left.length === 0) return [];
    systemctl('kill', '--signal=SIGKILL', unit);
    await new Promise((done) => setTimeout(done, pause));
  }
  return left;
}

export const CONTAIN = { manager: userManager, stop: stopScope };

export async function review(request, {
  run = runLimited, model = codexModel, onOutput = () => {}, reviewers = null, kill = process.kill.bind(process),
  contain = CONTAIN, role = 'reviewer', worktreeCheck = worktreeProblem,
} = {}) {
  const which = role === 'builder' ? request?.builder : request?.reviewer;
  const table = reviewers ?? (role === 'builder' ? BUILDERS : REVIEWERS);
  if (!['builder', 'reviewer'].includes(role) || !Object.hasOwn(table, which)) {
    return { status: 'failed', error: `refused: unknown ${role} ${JSON.stringify(which)}` };
  }
  if (typeof request.prompt !== 'string' || !request.prompt.trim()) return { status: 'failed', error: 'refused: no prompt' };
  if (role === 'builder') {
    try {
      const problem = worktreeCheck(request.worktree);
      if (problem) return { status: 'failed', error: problem };
    } catch (error) {
      return { status: 'failed', error: `refused: the card worktree could not be checked: ${error.message}` };
    }
  }
  const manager = contain.manager();
  if (!manager) {
    return { status: 'failed', error: "refused: the reviewer's account has no systemd user manager (loginctl enable-linger), "
      + 'so a review could not be contained, and none was started' };
  }
  const seconds = limitSeconds(request.limit_seconds, role === 'builder' ? BUILDER_LIMIT : LIMIT);
  let spec;
  try {
    spec = table[which](request.prompt, request.worktree, request.model);
  } catch (error) {
    return { status: 'failed', error: `refused: ${error.message}` };
  }
  let stdout = '';
  let stderr = '';
  const unit = `${SCOPE_PREFIX}${randomUUID()}.${spec.readOnly ? 'service' : 'scope'}`;
  const stop = () => contain.stop(unit, { env: { ...process.env, ...manager } });
  const options = { cwd: role === 'builder' ? request.worktree : '/', env: { ...spec.env, ...manager },
    stdio: [spec.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] };
  // A transient service can enforce filesystem restrictions; a scope cannot
  // (verified on this server). Gemini gets only its own home writable for the
  // CLI session, and cannot even read the candidate. Its whole diff is in the
  // prompt. Existing Codex/Pi process scopes retain their tested containment.
  const command = spec.readOnly
    ? ['--user', '--pipe', '--wait', '--collect', '--quiet', `--unit=${unit}`,
      '--working-directory=/home/gemini-worker',
      '-p', 'ProtectSystem=strict', '-p', 'PrivateTmp=yes', '-p', 'ReadWritePaths=/home/gemini-worker',
      '-p', 'InaccessiblePaths=/srv/julia-runner', '--', PYTHON, REAPER, '--', spec.command, ...spec.args]
    : ['--user', '--scope', '--quiet', '--collect', `--unit=${unit}`, '--', PYTHON, REAPER, '--', spec.command, ...spec.args];
  const result = await run('systemd-run', command, options, {
    seconds,
    graceMs: STOP_GRACE_MS,
    started: (child) => {
      child.stdout.on('data', (chunk) => { stdout += chunk; onOutput(); });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      // reap.py killed outright (only root or the kernel's out-of-memory killer
      // can: it sweeps before any exit of its own) cannot sweep: stop the rest
      // of its group, and then its whole scope, at once.
      child.on('exit', (code, signal) => {
        if (!signal) return;
        try { kill(-child.pid, 'SIGKILL'); } catch { /* the group is gone */ }
        stop();
      });
      if (spec.stdin) child.stdin.end(spec.streamPrompt ? geminiMessages(request.prompt) : request.prompt);
    },
  });
  // However the reviewer ended, nothing of its scope is left running.
  const left = await stop();
  if (left.length) {
    return { status: 'failed', error: `the reviewer left ${left.length} process(es) running that could not be stopped: ${left.join(', ')}` };
  }
  if (result.stopped) return { status: 'stopped', error: stoppedLine(seconds) };
  if (result.error) return { status: 'failed', error: `the reviewer did not start: ${result.error.message}` };
  const kind = spec.kind ?? (which === 'codex' ? 'codex' : 'pi');
  const reply = kind === 'codex' ? codexReply(stdout) : kind === 'gemini' ? geminiReply(stdout) : piReply(stdout);
  const ran = kind === 'codex' ? await model(reply.thread) : reply.model;
  const tail = stderr.trim().split('\n').slice(-3).join(' | ').slice(-500);
  if (result.code !== 0) {
    const how = result.code === null ? `was stopped by ${result.signal}` : `exited ${result.code}`;
    return { status: 'failed', error: `the ${role} ${how}${reply.error || tail ? `: ${reply.error ?? tail}` : ''}`, text: reply.text, model: ran };
  }
  if (!reply.ok) return { status: 'failed', error: reply.error, text: reply.text, model: ran };
  if (!ran) return { status: 'failed', error: 'the model that ran could not be confirmed, so the review does not count', text: reply.text };
  return { status: 'ok', text: reply.text, model: ran };
}

export function main(role = 'reviewer') {
  // A progress line at most once a second while the reviewer prints; the answer is the last line.
  let last = 0;
  const onOutput = () => {
    if (Date.now() - last < 1000) return;
    last = Date.now();
    process.stdout.write('{"progress":true}\n');
  };
  // The graph stops this launcher with SIGTERM (through sudo): the reviewer's
  // group gets SIGTERM, so reap.py sweeps everything below it, then SIGKILL.
  let group = null;
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const signal = (name) => { if (group) { try { process.kill(-group, name); } catch { /* already gone */ } } };
    signal('SIGTERM');
    // Past the grace, SIGKILL: reap.py then dies by a signal, and review()
    // sweeps everything carrying the run's mark before it answers, which ends
    // this launcher (below). The last timer is only a backstop.
    setTimeout(() => signal('SIGKILL'), STOP_GRACE_MS).unref();
    setTimeout(finish, STOP_GRACE_MS + 30_000).unref();
  };
  const finish = () => {
    console.error('stopped: the graph stopped the reviewer');
    process.exit(STOPPED_EXIT);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  const request = json(readFileSync(0, 'utf8'));
  const run = (command, args, options, limits) => runLimited(command, args, options, {
    // runLimited's account sweep is for the dedicated builder/test accounts.
    // A reviewer is contained by its own user unit; sweeping gemini-worker
    // would kill that account's systemd manager as well as the review.
    ...limits, account: 'reviewer', started: (child) => { group = child.pid; limits.started(child); },
  });
  review(request, { run, onOutput, role }).then((reply) => {
    if (stopping) finish();
    if (reply.status === 'stopped') {
      console.error(reply.error);
      process.exit(STOPPED_EXIT);
    }
    process.stdout.write(`${JSON.stringify(reply)}\n`);
  }).catch((error) => {
    console.error(`the ${role} launcher failed: ${error.message}`);
    process.exitCode = 1;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
