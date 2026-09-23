// seat-run.mjs -- JUL-98 step 8 (Todd's Decision, 23 Sep): the controller runs
// each seat as ONE command with ONE time limit, and reads its answers from
// FILES in the working copy.
//
// WHAT THIS REPLACES. The start-then-message route -- `worker-start`, adopting
// a terminal, typing a brief into it, waiting on Orca's mailbox for a
// `worker_done`, guessing from screen state whether a turn had started. Every
// JUL-92 attempt on 22-23 Sep died somewhere in that machinery (a brief Orca
// said it delivered and never typed; a verdict Orca refused to accept from the
// worker that wrote it). It is retired, not patched.
//
// WHAT HAPPENS NOW, per seat:
//   1. One plain Orca terminal on the WORKER daemon (so it runs as `runner`),
//      in the card's working copy, running scripts/run-seat.mjs with the brief
//      carried in the command, base64-encoded. Nothing is typed into it.
//   2. While it runs, the controller reads the seat's progress file every
//      minute (Todd, 23 Sep: "no black box"): the current step goes on the card,
//      and a seat whose progress file has not changed for five minutes is
//      treated as stuck and stopped.
//   3. It ends when run-seat.mjs prints its end marker, or is stopped at its
//      time limit, or is stopped as stuck. THE STOP finds the seat's
//      processes by their SEAT TOKEN -- a random value the controller makes
//      per run, which run-seat.mjs hands the agent as JULIA_SEAT_TOKEN and
//      every process it starts inherits -- and kills them, as the worker,
//      through a second short terminal (`stopSeatCommand`). Nothing the agent
//      can write decides what is killed (PR #103 review). It is NOT closing
//      the seat's terminal: measured 2026-09-23, closing an Orca terminal kills
//      what runs in it outright, with no signal a handler can catch, and the
//      detached agent survives it (the first stand-in `stuck` run did).
//   4. The answer, the run record and the agent's own output are read from
//      `.julia/` in the working copy, directly, as `orchestrator-svc` -- which
//      can read them (proven on the server, 23 Sep 05:00Z). Never the screen.
//
// SEATS, FOR NOW: Gemini builds, DeepSeek (Pi) reviews, and nothing else. No
// backup seats. A card asking for anything else is refused with that reason
// rather than started on something it did not ask for.

import { readFileSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { MODEL_CATALOG } from '../../scripts/seat-labels.mjs';
import {
  seatCostLine, readFailedCostLine, deepseekExtractFromSeatStream, geminiExtractFromAllowance,
} from './cost.mjs';
import { WORKER_SCRIPT_END_MARKER, workerScriptExitCode } from './wiring.mjs';

export const ANSWER_DIR = '.julia';

// The two worker skills, and only two. Paths: the worker reads the file in its
// own working copy.
export const WORKER_SKILLS = Object.freeze({
  builder: '.claude/skills/julia-builder/SKILL.md',
  reviewer: '.claude/skills/julia-reviewer/SKILL.md',
});

// The vendor model ids the seats run on, per MODEL_CATALOG model name.
export const LAUNCH_MODEL_IDS = Object.freeze({
  'deepseek-v4-pro': 'deepseek-v4-pro',
  'deepseek-v4-flash': 'deepseek-v4-flash',
  'gemini-3.8-flash': 'gemini-3.8-flash',
});

// The ONLY seats this route runs today (Todd's Decision, 23 Sep). The other
// JUL-81 workers come back one at a time, each as a row here.
export const SEAT_ROUTES = Object.freeze({
  builder: Object.freeze({ entry: 'gemini', agent: 'agy' }),
  reviewer: Object.freeze({ entry: 'pi-deepseek', agent: 'pi' }),
});

export const DEFAULT_TIME_LIMITS_MS = Object.freeze({
  builder: 30 * 60 * 1000,
  reviewer: 20 * 60 * 1000,
});
// Todd, 23 Sep: a running worker whose progress file has not changed in five
// minutes is stuck.
export const STUCK_AFTER_MS = 5 * 60 * 1000;
// Todd, 23 Sep: the controller reads the progress file every minute.
export const PROGRESS_READ_MS = 60 * 1000;
// How often the terminal is read for run-seat.mjs's end marker.
export const END_POLL_MS = 5000;
// run-seat.mjs enforces the time limit itself; this is how long past it the
// controller waits for the end marker before it stops the terminal itself.
export const END_MARKER_GRACE_MS = 2 * 60 * 1000;
// The brief rides in the command. 40,000 characters was measured arriving
// intact (23 Sep); the cap keeps well inside that. It is also well inside the
// second limit on the way: run-seat.mjs hands the decoded brief to the agent
// as ONE argument, and Linux refuses a single argument over 128 KB with E2BIG
// (hit for real on 23 Sep, handing a 205 KB review brief to `pi`). 36,000
// base64 characters decode to about 27 KB.
export const MAX_BRIEF_B64 = 36000;

export const SEAT_TERMINAL_TITLE_PREFIX = 'julia-seat-';
// After a stop, how long the controller waits for run-seat.mjs's run record --
// which it writes only once the agent's process group has exited -- before it
// reports the stop as NOT confirmed (PR #102 review, findings 1 and 3).
export const STOP_CONFIRM_MS = 60 * 1000;
export const EFFORTS = Object.freeze(['low', 'medium', 'high']);

export function seatTag(round, seat) {
  return `round-${round}-${seat}`;
}

export function seatFilePaths(worktreePath, tag) {
  const dir = join(worktreePath, ANSWER_DIR);
  return {
    dir,
    answer: join(dir, `${tag}.answer.json`),
    progress: join(dir, `${tag}.progress.jsonl`),
    run: join(dir, `${tag}.run.json`),
    out: join(dir, `${tag}.out`),
  };
}

// A limit in words: "90-second" rather than a rounded-up "2-minute".
export function limitInWords(ms) {
  return ms < 120000 ? `${Math.round(ms / 1000)}-second` : `${Math.round(ms / 60000)}-minute`;
}

export const STOP_MARKER_GONE = 'JULIA_STOP:gone';
export const STOP_MARKER_ALIVE = 'JULIA_STOP:alive';
export const STOP_TERMINAL_TITLE_PREFIX = 'julia-stop-';

export const SEAT_TOKEN_ENV = 'JULIA_SEAT_TOKEN';
export const SEAT_TOKEN_PATTERN = /^[0-9a-f]{32}$/;

export function newSeatToken() {
  return randomBytes(16).toString('hex');
}

// The stop, as ONE shell line run by the WORKER (only it may signal its own
// processes). It finds every process whose environment carries this seat's
// exact token -- read from /proc/<pid>/environ, which only the processes' own
// account can read -- sends TERM, then KILL, then looks again. `gone` means no
// process with the token is left. Why the token and not a process group:
//   * nothing the agent can write decides what is killed (a pid file in the
//     working copy could be forged to redirect the kill or fake "gone");
//   * a recycled pid does not carry the token;
//   * a grandchild that moved to a new process group still does.
// The token must be exactly 32 lowercase hex characters -- anything else is
// refused, never interpolated.
export function stopSeatCommand(token, { graceSeconds = 5 } = {}) {
  if (typeof token !== 'string' || !SEAT_TOKEN_PATTERN.test(token)) throw new Error('refusing to build a stop for a seat token that is not 32 lowercase hex characters');
  if (!Number.isInteger(graceSeconds) || graceSeconds < 0) throw new Error('refusing a stop grace that is not a whole number of seconds');
  const find = `julia_seat() { for d in /proc/[0-9]*; do [ "$d" = "/proc/$$" ] && continue; tr '\\0' '\\n' < "$d/environ" 2>/dev/null | grep -qx "${SEAT_TOKEN_ENV}=${token}" && echo "\${d#/proc/}"; done; }`;
  return `${find}; P=$(julia_seat); [ -n "$P" ] && kill -TERM $P 2>/dev/null; sleep ${graceSeconds}; `
    + `P=$(julia_seat); [ -n "$P" ] && kill -KILL $P 2>/dev/null; sleep 1; `
    + `P=$(julia_seat); if [ -n "$P" ]; then echo ${STOP_MARKER_ALIVE} $P; else echo ${STOP_MARKER_GONE}; fi; echo "${WORKER_SCRIPT_END_MARKER}:$?"`;
}

// Run the stop and read its answer. Never throws: what it could or could not
// do is the answer, and the caller reports it.
export async function stopSeatGroup({ boundaries, worktreePath, tag, token, sleepImpl, nowMs, pollMs = 1000, timeoutMs = 60000, warn = () => {} }) {
  let command;
  try { command = stopSeatCommand(token); } catch (error) { return { gone: false, reason: error.message }; }
  let terminal = null;
  try {
    const created = await boundaries.workerTerminalCreateImpl({ worktreePath, title: `${STOP_TERMINAL_TITLE_PREFIX}${tag}`, command });
    terminal = created?.terminal?.handle ?? null;
    if (!terminal) return { gone: false, reason: 'orca terminal create answered no handle for the stop' };
    const lines = [];
    let cursor = null;
    const giveUpAt = nowMs() + timeoutMs;
    for (;;) {
      const answer = await boundaries.terminalReadImpl({ terminal, cursor, limit: 200 });
      const read = answer?.terminal ?? {};
      for (const line of read.tail ?? []) lines.push(String(line).trim());
      if (read.nextCursor !== null && read.nextCursor !== undefined) cursor = read.nextCursor;
      if (workerScriptExitCode(lines) !== null) break;
      if (nowMs() >= giveUpAt) return { gone: false, reason: `the stop did not finish within ${Math.round(timeoutMs / 1000)} s` };
      await sleepImpl(pollMs);
    }
    if (lines.includes(STOP_MARKER_GONE)) return { gone: true, reason: null };
    const alive = lines.find((line) => line.startsWith(`${STOP_MARKER_ALIVE} `));
    return { gone: false, reason: alive ? `processes still carrying the seat token after TERM and KILL: ${alive.slice(STOP_MARKER_ALIVE.length + 1)}` : 'the stop gave no answer' };
  } catch (error) {
    return { gone: false, reason: `the stop could not be run: ${error.message}` };
  } finally {
    if (terminal) {
      try { await boundaries.terminalCloseImpl({ terminal }); } catch (error) { warn(`[controller] could not close the stop terminal ${terminal}: ${error.message}`); }
    }
  }
}

// What a seat runs as. `choice` is one seat's entry from scripts/seat-labels.mjs.
// The stand-in is reachable only when the caller says so explicitly -- only
// scripts/controller-stand-in.mjs does -- never from a card's labels.
export function launchFor(seat, choice, { standIn = false } = {}) {
  const route = SEAT_ROUTES[seat];
  if (!route) return { ok: false, reason: `the single-command route has no ${seat} seat` };
  if (standIn) return { ok: true, seat, entry: 'stand-in', agent: 'stand-in', model: 'stand-in', effort: 'low', modelLabel: null };
  if (choice?.entry !== route.entry) {
    return {
      ok: false,
      reason: `the ${seat} seat runs only on ${route.entry} for now (Todd's Decision, 23 Sep: Gemini builds, DeepSeek reviews, no backups yet), and this card asks for ${JSON.stringify(choice?.entry ?? null)}${choice?.modelLabel ? ` (label ${choice.modelLabel})` : ''}`,
    };
  }
  const model = LAUNCH_MODEL_IDS[MODEL_CATALOG[choice.modelLabel]?.model];
  if (!model) return { ok: false, reason: `no launch model id for model label ${JSON.stringify(choice.modelLabel)}` };
  // Card-label data, so checked here and refused in words, never passed on to
  // throw somewhere mid-carry (PR #102 review, finding 5).
  const effort = choice.effort ?? 'medium';
  if (!EFFORTS.includes(effort)) return { ok: false, reason: `the ${seat} seat's effort ${JSON.stringify(effort)} is not one of ${EFFORTS.join(', ')}` };
  return { ok: true, seat, entry: route.entry, agent: route.agent, model, effort, modelLabel: choice.modelLabel };
}

function bullets(items) {
  return (items ?? []).map((item) => `- ${item}`).join('\n');
}

// The brief one fresh worker is started with. One step in, one brief out.
export function buildStepBrief({ seat, card, step, files = [] }) {
  const skill = WORKER_SKILLS[seat];
  if (!skill) throw new Error(`buildStepBrief: no worker skill for seat ${JSON.stringify(seat)} (seats: ${Object.keys(WORKER_SKILLS).join(', ')})`);
  if (!step?.title) throw new Error('buildStepBrief: the step needs a title');
  const lines = [
    `# ${card.identifier} -- ${step.title}`,
    '',
    `You are the ${seat} for this ONE step. Your standing orders are \`${skill}\` in this`,
    'working copy: read it before anything else and follow it. You have no memory of any other step',
    'and you are not given one.',
    '',
    '## The card',
    '',
    `${card.identifier}: ${card.title}`,
  ];
  if (card.url) lines.push(card.url);
  lines.push('', '## This step', '', step.brief ?? '');
  if (step.criteria?.length) lines.push('', '### What this step is judged on', '', bullets(step.criteria));
  if (files.length) lines.push('', '## The files this step is about', '', bullets(files));
  if (step.priorFinding) {
    // The ONE thing that may travel from an earlier round: the finding this
    // round exists to fix.
    lines.push('', '## The review finding you are fixing', '', step.priorFinding);
  }
  lines.push('');
  return lines.join('\n');
}

// How the seat reports. Appended to every brief: these two files are the only
// channels the controller reads.
export function reportingInstructions({ seat, tag, timeLimitMs }) {
  const minutes = Math.round(timeLimitMs / 60000);
  const answerShape = seat === 'builder'
    ? '`{"outcome":"done","summary":"<your hand-in>"}` when the work is committed, or `{"outcome":"blocked","summary":"<why you stopped>"}`'
    : '`{"verdict":"approve","summary":"<what you checked>"}` or `{"verdict":"changes_needed","findings":"<each finding, ranked, with its source>"}`';
  return [
    '## How you report -- the only two things the controller reads',
    '',
    'The controller reads two files in this working copy and nothing else: not your screen, not any message.',
    '',
    `1. **Progress, as you work.** Append one JSON line to \`${ANSWER_DIR}/${tag}.progress.jsonl\` each time you start a new part of the job (\`"type":"status"\`), and at least every two minutes while you work (\`"type":"heartbeat"\`). One line looks like:`,
    `   \`{"type":"status","subject":"writing the failing test","body":"","payload":{"phase":"red"},"created_at":"2026-09-23T05:00:00Z"}\``,
    '   **If this file does not change for five minutes, you are treated as stuck and stopped.** Before any command that may run long, write a heartbeat first.',
    `2. **Your answer, once, at the end.** Write \`${ANSWER_DIR}/${tag}.answer.json\`: ${answerShape}.`,
    '',
    `\`${ANSWER_DIR}/\` is ignored by git; never commit it. You have ${minutes} minutes in all; after that you are stopped and the step fails.`,
    '',
  ].join('\n');
}

// Single-quoted for the shell; a value that could break out of the quoting is
// refused rather than interpolated.
function shellArg(value, what) {
  const text = String(value);
  if (text.includes("'")) throw new Error(`seat-run: refusing to build a shell command with a quote in ${what}: ${text}`);
  return `'${text}'`;
}

export function seatCommand({ worktreePath, seat, launch, tag, timeLimitMs, brief, token }) {
  if (!SEAT_TOKEN_PATTERN.test(String(token))) throw new Error('seatCommand: a seat needs a 32-hex-character seat token');
  const b64 = Buffer.from(brief, 'utf8').toString('base64');
  if (b64.length > MAX_BRIEF_B64) {
    throw new Error(`the ${seat} brief is ${b64.length} characters encoded, over the ${MAX_BRIEF_B64} a command carries safely -- refusing to start a seat on a brief that may arrive cut`);
  }
  const line = [
    `node ${shellArg(`${worktreePath}/scripts/run-seat.mjs`, 'the working copy path')}`,
    `--seat ${shellArg(seat, 'the seat')}`,
    `--agent ${shellArg(launch.agent, 'the agent')}`,
    `--model ${shellArg(launch.model, 'the model')}`,
    `--effort ${shellArg(launch.effort, 'the effort')}`,
    `--tag ${shellArg(tag, 'the tag')}`,
    `--timeout-seconds ${Math.ceil(timeLimitMs / 1000)}`,
    `--worktree ${shellArg(worktreePath, 'the working copy path')}`,
    `--seat-token ${token}`,
    `--brief-b64 ${b64}`,
  ].join(' ');
  return `${line}; echo "${WORKER_SCRIPT_END_MARKER}:$?"`;
}

// The progress file, read. Lines that are not JSON are counted, never guessed
// at. `payload` may be an object or, as Orca's mailbox sent it, a JSON string.
export function parseProgress(text) {
  const entries = [];
  let invalid = 0;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      let payload = parsed.payload ?? {};
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch { payload = {}; }
      }
      entries.push({
        type: parsed.type ?? null,
        subject: String(parsed.subject ?? ''),
        body: String(parsed.body ?? ''),
        phase: payload?.phase ?? null,
        createdAt: parsed.created_at ?? null,
      });
    } catch {
      invalid += 1;
    }
  }
  const lastStatus = [...entries].reverse().find((entry) => entry.type === 'status') ?? null;
  return { entries, invalid, last: entries[entries.length - 1] ?? null, lastStatus };
}

// Was the seat's reply CUT OFF at its output limit? Read from the agent's own
// saved JSON stream: the last assistant `message_end` names why it stopped, and
// `length` means the reply hit the limit before it finished. A seat that stops
// there usually never writes its answer, and the card must say THAT -- not
// "no verdict", which reads as the seat having nothing to say (Todd, 23 Sep).
// Pi's stream shape (`--mode json`); the stand-in writes the same shape. Gemini's
// `agy -p --output-format json` records no such reason that has been seen yet.
export function cutOffOf(outText) {
  let last = null;
  for (const raw of String(outText ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('{')) continue;
    try {
      const event = JSON.parse(line);
      if (event?.type === 'message_end' && event.message?.role === 'assistant') last = event.message;
    } catch { /* not an event line */ }
  }
  if (last?.stopReason !== 'length') return null;
  return { stopReason: 'length', outputTokens: last.usage?.output ?? null, reasoningTokens: last.usage?.reasoning ?? null };
}

// A file's "has it changed" fingerprint, or null when it does not exist yet.
function fingerprintOf(path, statImpl) {
  try {
    const stat = statImpl(path);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function readJson(path, readFileImpl, what) {
  let text;
  try {
    text = readFileImpl(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { value: null, reason: `no ${what} was written (${path})` };
    return { value: null, reason: `the ${what} could not be read: ${error.message}` };
  }
  try {
    return { value: JSON.parse(text), reason: null };
  } catch (error) {
    return { value: null, reason: `the ${what} is not valid JSON (${error.message})` };
  }
}

export function validateAnswer(seat, answer) {
  if (!answer || typeof answer !== 'object') return 'the answer is not a JSON object';
  if (seat === 'builder') {
    if (!['done', 'blocked'].includes(answer.outcome)) return `the builder's answer has outcome ${JSON.stringify(answer.outcome)}, not "done" or "blocked"`;
    if (typeof answer.summary !== 'string' || !answer.summary.trim()) return "the builder's answer has no summary";
    return null;
  }
  if (!['approve', 'changes_needed'].includes(answer.verdict)) return `the reviewer's answer has verdict ${JSON.stringify(answer.verdict)}, not "approve" or "changes_needed"`;
  if (answer.verdict === 'changes_needed' && !(typeof answer.findings === 'string' && answer.findings.trim())) {
    return "the reviewer asked for changes but named no findings";
  }
  return null;
}

// The seat's cost line, from its run record and its own output. A read that
// cannot be done is a `readFailed` line carrying the reason -- never a guess.
export function costLineFor({ seat, launch, run, outText }) {
  try {
    if (!run?.startedAt || !run?.endedAt) throw new Error('the run record has no start and end time');
    if (launch.agent === 'stand-in') {
      return seatCostLine({
        seat, vendor: 'stand-in', model: 'stand-in (no model)', tokens: { input: 0, output: 0, cacheRead: 0 },
        totalTokens: 0, peakContext: 0, usd: 0, startedAt: run.startedAt, endedAt: run.endedAt,
      });
    }
    if (launch.agent === 'agy') {
      if (run.allowanceError) throw new Error(`the Gemini allowance could not be read: ${run.allowanceError}`);
      return seatCostLine({ seat, ...geminiExtractFromAllowance({ model: launch.model, before: run.allowanceBefore, after: run.allowanceAfter, startedAt: run.startedAt, endedAt: run.endedAt }) });
    }
    if (launch.agent === 'pi') {
      const events = String(outText ?? '').split(/\r?\n/).filter((line) => line.trim().startsWith('{')).map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
      return seatCostLine({ seat, ...deepseekExtractFromSeatStream(events, { startedAt: run.startedAt, endedAt: run.endedAt }) });
    }
    throw new Error(`no cost source for agent ${JSON.stringify(launch.agent)}`);
  } catch (error) {
    return readFailedCostLine({ seat, model: launch.model, reason: error.message });
  }
}

// Run one seat to its end. Never throws for anything the SEAT did: a timeout,
// a stuck seat, a missing or bad answer all come back as `ok: false` with the
// reason. It throws only when the controller itself could not start the seat.
export async function runSeat({
  seat,
  round,
  launch,
  worktreePath,
  brief,
  boundaries,
  timeLimitMs = DEFAULT_TIME_LIMITS_MS[seat],
  stuckAfterMs = STUCK_AFTER_MS,
  progressReadMs = PROGRESS_READ_MS,
  endPollMs = END_POLL_MS,
  endMarkerGraceMs = END_MARKER_GRACE_MS,
  stopConfirmMs = STOP_CONFIRM_MS,
  seatTokenImpl = newSeatToken,
  onProgress = async () => {},
  readFileImpl = readFileSync,
  statImpl = statSync,
  sleepImpl = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
  nowMs = () => Date.now(),
  warn = console.error,
} = {}) {
  const tag = seatTag(round, seat);
  const paths = seatFilePaths(worktreePath, tag);
  const fullBrief = `${brief}\n${reportingInstructions({ seat, tag, timeLimitMs })}`;
  const token = seatTokenImpl();
  const command = seatCommand({ worktreePath, seat, launch, tag, timeLimitMs, brief: fullBrief, token });

  const created = await boundaries.workerTerminalCreateImpl({ worktreePath, title: `${SEAT_TERMINAL_TITLE_PREFIX}${tag}`, command });
  const terminal = created?.terminal?.handle ?? null;
  if (!terminal) {
    throw new Error(`the ${seat} seat could not start: orca terminal create on the worker daemon answered no terminal handle (${JSON.stringify(created ?? null).slice(0, 200)})`);
  }
  if (created.terminal.warning) warn(`[controller] ${created.terminal.warning}`);

  const startedMs = nowMs();
  let lastChangeMs = startedMs;
  let lastFingerprint = null;
  let lastProgressReadMs = -Infinity;
  let lastPhaseShown = null;
  let progress = parseProgress('');
  let stoppedAs = null; // 'stuck' | 'overtime'
  const lines = [];
  let cursor = null;
  let exitCode = null;
  let stop = null;

  const readProgressNow = async () => {
    const fingerprint = fingerprintOf(paths.progress, statImpl);
    if (fingerprint !== null && fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint;
      lastChangeMs = nowMs();
      try { progress = parseProgress(readFileImpl(paths.progress, 'utf8')); } catch (error) { warn(`[controller] could not read ${paths.progress}: ${error.message}`); }
      const shown = progress.lastStatus ? `${progress.lastStatus.subject}${progress.lastStatus.phase ? ` (${progress.lastStatus.phase})` : ''}` : null;
      if (shown && shown !== lastPhaseShown) {
        lastPhaseShown = shown;
        try { await onProgress({ seat, round, tag, status: progress.lastStatus, last: progress.last, count: progress.entries.length }); } catch (error) {
          // The card not being updated never stops the seat.
          warn(`[controller] could not show the ${tag} progress on the card: ${error.message}`);
        }
      }
    }
  };

  try {
    for (;;) {
      const answer = await boundaries.terminalReadImpl({ terminal, cursor, limit: 2000 });
      const read = answer?.terminal ?? {};
      for (const line of read.tail ?? []) lines.push(String(line));
      if (read.nextCursor !== null && read.nextCursor !== undefined) cursor = read.nextCursor;
      exitCode = workerScriptExitCode(lines);
      if (exitCode !== null) break;

      const now = nowMs();
      if (now - lastProgressReadMs >= progressReadMs) {
        lastProgressReadMs = now;
        await readProgressNow();
        if (nowMs() - lastChangeMs >= stuckAfterMs) { stoppedAs = 'stuck'; break; }
      }
      if (now - startedMs >= timeLimitMs + endMarkerGraceMs) { stoppedAs = 'overtime'; break; }
      await sleepImpl(endPollMs);
    }

    if (stoppedAs) {
      // THE STOP: the agent's group, killed as the worker. Then run-seat.mjs
      // sees its agent exit, writes its run record and prints its end marker,
      // which is read here as usual -- polled, not slept on, because the
      // Gemini seat's second allowance reading comes before the record.
      stop = await stopSeatGroup({ boundaries, worktreePath, tag, token, sleepImpl, nowMs, warn });
      const giveUpAt = nowMs() + stopConfirmMs;
      for (;;) {
        const answer = await boundaries.terminalReadImpl({ terminal, cursor, limit: 2000 });
        const read = answer?.terminal ?? {};
        for (const line of read.tail ?? []) lines.push(String(line));
        if (read.nextCursor !== null && read.nextCursor !== undefined) cursor = read.nextCursor;
        if (workerScriptExitCode(lines) !== null || fingerprintOf(paths.run, statImpl) !== null) break;
        if (nowMs() >= giveUpAt) break;
        await sleepImpl(endPollMs);
      }
    }
  } finally {
    // Cleanup only. Closing it is NOT a stop (see the header), so nothing
    // below reads the close as one.
    try {
      await boundaries.terminalCloseImpl({ terminal });
    } catch (error) {
      warn(`[controller] could not close the ${tag} terminal ${terminal}: ${error.message}`);
    }
  }
  const endedMs = nowMs();
  // A STOP IS CONFIRMED, NOT ASSUMED: only the worker-side check finding no
  // process with the seat token left confirms it. run-seat.mjs's record is
  // written when its direct child exits, which says nothing about processes
  // the agent started (PR #103 review, finding 4).
  const stopConfirmed = !stoppedAs || stop?.gone === true;
  const unconfirmed = stoppedAs && !stopConfirmed
    ? ` -- and the stop is NOT confirmed (${stop?.reason ?? 'no answer from the stop'}), so the seat may still be running`
    : '';
  // One last read, so the card and the result carry the final report.
  try { await readProgressNow(); } catch { /* reported below if it matters */ }

  const run = readJson(paths.run, readFileImpl, 'run record');
  let outText = '';
  try { outText = readFileImpl(paths.out, 'utf8'); } catch { /* no output is a cost-read reason, below */ }
  const costLine = run.value ? costLineFor({ seat, launch, run: run.value, outText }) : readFailedCostLine({ seat, model: launch.model, reason: run.reason });
  const base = {
    seat, round, tag, launch, terminal, run: run.value, progress, costLine, stopConfirmed, stop,
    minutes: Math.round(((endedMs - startedMs) / 60000) * 10) / 10,
  };

  if (stoppedAs === 'stuck') {
    return { ...base, ok: false, stuck: true, reason: `the ${seat} (round ${round}) was stopped as stuck: its progress file had not changed for ${limitInWords(stuckAfterMs).replace('-', ' ')}s${progress.last ? ` (last report: ${progress.last.type} "${progress.last.subject}" at ${progress.last.createdAt ?? 'an unknown time'})` : ' (it never reported at all)'}${unconfirmed}` };
  }
  if (stoppedAs === 'overtime' || run.value?.timedOut) {
    return { ...base, ok: false, timedOut: true, reason: `the ${seat} (round ${round}) ran past its ${limitInWords(timeLimitMs)} limit and was stopped${unconfirmed}` };
  }
  if (exitCode !== 0) {
    const tail = lines.slice(-5).join(' | ');
    return { ...base, ok: false, reason: `the ${seat} (round ${round}) could not be run: run-seat.mjs exited ${exitCode} -- ${tail || 'it printed nothing'}` };
  }
  if (!run.value) return { ...base, ok: false, reason: `the ${seat} (round ${round}) left no run record: ${run.reason}` };
  if (run.value.spawnError) return { ...base, ok: false, reason: `the ${seat} (round ${round}) could not start its agent: ${run.value.spawnError}` };

  const answer = readJson(paths.answer, readFileImpl, 'answer file');
  const cutOff = cutOffOf(outText);
  if (!answer.value && cutOff) {
    return {
      ...base, ok: false, cutOff,
      reason: `the ${seat} (round ${round})'s reply was CUT OFF at its output limit (stop reason "length"${cutOff.outputTokens !== null ? `, ${cutOff.outputTokens} output tokens${cutOff.reasoningTokens !== null ? `, ${cutOff.reasoningTokens} of them thinking` : ''}` : ''}) before it wrote its answer`,
    };
  }
  if (!answer.value) {
    return { ...base, ok: false, reason: `the ${seat} (round ${round}) finished (exit ${run.value.exitCode}) without a usable answer: ${answer.reason}` };
  }
  const invalid = validateAnswer(seat, answer.value);
  if (invalid) return { ...base, ok: false, answer: answer.value, reason: `the ${seat} (round ${round}) answered, but ${invalid}` };
  return { ...base, ok: true, answer: answer.value, reason: null };
}
