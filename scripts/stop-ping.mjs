#!/usr/bin/env node
// Mastra Code Notification hook: a Julia run has stopped and waits on Todd.
// Records the stop, posts a comment on the run's card, and sets Todd a reminder on it.
// Wired in .mastracode/hooks.json and, with --global, in ~/.mastracode/hooks.json so a
// session started outside this repository still pings.
// Design in docs/adr/0024-run-scorecard-and-stop-ping.md.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { appDataDir, cardForThread, newestThread, stopsFile, threadExists, threadProjectPath } from './scorecard.mjs';
import { linearGraphQL, postComment } from './linear-cli.mjs';

const TODD_PROFILE = 'https://linear.app/julia-next/profiles/toddwyder';

const REASONS = {
  ask_question: 'asked you a question',
  tool_approval: 'needs you to approve a tool call',
  plan_approval: 'needs you to approve a plan',
  sandbox_access: 'needs access to a folder',
  agent_done: 'finished its turn and needs your reply',
};

// `mastracode -t <id>` is headless-only: in the interactive CLI it starts a new chat instead
// of opening the thread. `mastracode resume` is the command that reopens the thread, and with
// it the card the run was working on.
export function resumeCommand({ thread, projectPath }) {
  return `${projectPath ? `cd ${projectPath} && ` : ''}mastracode resume ${thread}`;
}

export function stopComment({ reason, message, thread, projectPath }) {
  const lines = [`${TODD_PROFILE} Julia stopped: the run ${REASONS[reason] ?? `stopped (${reason})`}.`];
  if (message?.trim()) lines.push('', '> ' + message.trim().slice(0, 1200).replace(/\n/g, '\n> '));
  lines.push('', `Continue in that session: \`${resumeCommand({ thread, projectPath })}\` (\`-t\` only works headless and opens a new chat).`);
  return lines.join('\n');
}

function branchCard(cwd) {
  if (!cwd) return undefined;
  try {
    return execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).match(/jul-\d+/i)?.[0].toUpperCase();
  } catch {
    return undefined;
  }
}

// A chat can be started somewhere with no card in it: no kickoff line, no card in its title,
// no card branch under the session's folder (the home directory is the usual case after a
// reboot). Such a chat still stops and still needs a ping. It is bound to the card it last
// pinged about, once, and the binding is reused so later stops in it stay on that card.
export function threadCardsFile(env = process.env) {
  return join(dirname(stopsFile(env)), 'thread-cards.json');
}

export function readThreadCards(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function bindThreadCard(file, thread, card, source) {
  if (!thread || !card) return;
  mkdirSync(dirname(file), { recursive: true });
  const cards = readThreadCards(file);
  cards[thread] = { card, source, at: new Date().toISOString() };
  writeFileSync(file, JSON.stringify(cards, null, 2) + '\n');
}

// The card the last recorded stop belonged to. A stop record carries its card; the ping
// record written after it carries the comment instead.
export function lastCardFromStops(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  for (const line of text.split('\n').filter(Boolean).reverse()) {
    try {
      const entry = JSON.parse(line);
      if (entry.card) return entry.card;
    } catch {
      // A half-written line is not worth failing a ping over.
    }
  }
  return undefined;
}

// The first source that names a card wins; the card's source is recorded with the stop so a
// bound or inherited card is never mistaken for one the thread itself declared.
export function resolveCard({ threadCard, cwdCard, projectCard, binding, lastCard }) {
  if (threadCard) return { card: threadCard, source: 'thread' };
  if (cwdCard) return { card: cwdCard, source: 'branch' };
  if (projectCard) return { card: projectCard, source: 'project branch' };
  if (binding) return { card: binding, source: 'binding' };
  if (lastCard) return { card: lastCard, source: 'last ping' };
  return { card: undefined, source: null };
}

// The global wiring must not ping a second time when the session's own project already wires
// this hook; one stop is one comment and one reminder. A session started in the home directory
// resolves the global file as its project file, and that is this hook, not a second one.
export function projectWiresStopPing(projectDir, { home = homedir(), read = readFileSync, real = realpathSync } = {}) {
  const projectFile = join(projectDir, '.mastracode', 'hooks.json');
  try {
    if (real(projectFile) === real(join(home, '.mastracode', 'hooks.json'))) return false;
  } catch {
    // One of the two files is missing, so they cannot be the same file.
  }
  try {
    const config = JSON.parse(read(projectFile, 'utf8'));
    return Object.values(config).some(hooks => Array.isArray(hooks) && hooks.some(hook => String(hook?.command ?? '').includes('stop-ping.mjs')));
  } catch {
    return false;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The thread id a resumed session never sends. Walk the processes above this hook for
// `mastracode resume <thread>`, which is how the session that stopped was opened.
export function resumeThreadFromProcesses(startPid = process.ppid, { read = readFileSync } = {}) {
  let pid = startPid;
  for (let depth = 0; depth < 8 && pid > 1; depth += 1) {
    let cmdline;
    let stat;
    try {
      cmdline = read(`/proc/${pid}/cmdline`, 'utf8').split('\0');
      stat = read(`/proc/${pid}/stat`, 'utf8');
    } catch {
      return undefined;
    }
    const at = cmdline.indexOf('resume');
    if (at !== -1 && UUID.test(cmdline[at + 1] ?? '')) return cmdline[at + 1];
    const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    pid = Number(after[1]);
  }
  return undefined;
}

// Which session a stop belongs to. A payload id is used only when it names a thread
// that exists; otherwise the resume command above, then the thread that moved last.
// The source is recorded with the stop, so a guessed thread is never read as a fact.
export function resolveThread(payload, db, { exists = threadExists, resume = resumeThreadFromProcesses, newest = newestThread } = {}) {
  const claimed = payload?.session_id;
  if (UUID.test(claimed ?? '') && exists(db, claimed)) return { thread: claimed, threadSource: 'payload' };
  const fromProcess = resume();
  if (fromProcess && exists(db, fromProcess)) return { thread: fromProcess, threadSource: 'resume command' };
  const latest = newest(db);
  if (latest) return { thread: latest, threadSource: 'newest thread' };
  return { thread: claimed, threadSource: 'payload, unverified' };
}

// Linear never notifies Todd about a comment written with his own key, but an issue
// reminder he sets for himself is delivered like any notification, phone included.
const REMINDER_LEAD_MS = 30_000;
const REMINDER_MUTATION = `mutation Remind($id: String!, $at: DateTime!) { issueReminder(id: $id, reminderAt: $at) { success } }`;

function record(file, entry) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(entry) + '\n');
}

export async function handleStop(payload, env = process.env, {
  threadCardFor = cardForThread,
  projectPathFor = threadProjectPath,
  threadFor = resolveThread,
  post = postComment,
  remind = linearGraphQL,
} = {}) {
  const file = stopsFile(env);
  const cardsFile = threadCardsFile(env);
  const db = join(appDataDir(env), 'mastra.db');
  const { thread, threadSource } = threadFor(payload, db);
  const projectPath = projectPathFor(db, thread);
  const bindings = readThreadCards(cardsFile);
  const binding = bindings[thread]?.card;
  const { card, source } = resolveCard({
    threadCard: threadCardFor(db, thread),
    cwdCard: branchCard(payload.cwd),
    projectCard: branchCard(projectPath),
    binding,
    lastCard: lastCardFromStops(file),
  });
  const stop = { id: randomUUID(), at: new Date().toISOString(), thread, threadSource, cwd: payload.cwd ?? null, projectPath: projectPath ?? null, card: card ?? null, cardSource: source, reason: payload.reason, message: payload.message ?? null };
  record(file, stop);
  if (!card) return { ...stop, posted: false, error: 'no card for this thread' };
  if (source === 'last ping') bindThreadCard(cardsFile, thread, card, source);
  try {
    const opts = { apiKey: env.LINEAR_API_KEY };
    const comment = await post(card, stopComment({ reason: payload.reason, message: payload.message, thread, projectPath }), opts);
    const remindAt = new Date(Date.now() + REMINDER_LEAD_MS).toISOString();
    const { issueReminder } = await remind(REMINDER_MUTATION, { id: card, at: remindAt }, opts);
    const ping = { id: stop.id, comment: comment.url, notified: issueReminder.success, remindAt };
    record(file, ping);
    return { ...stop, ...ping, posted: true };
  } catch (error) {
    record(file, { id: stop.id, error: error.message });
    return { ...stop, posted: false, error: error.message };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const payload = JSON.parse(readFileSync(0, 'utf8'));
  if (process.argv.includes('--global') && projectWiresStopPing(payload.cwd)) process.exit(0);
  const result = await handleStop(payload);
  if (result.error) console.error(`stop-ping: ${result.error}`);
}
