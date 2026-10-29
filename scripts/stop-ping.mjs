#!/usr/bin/env node
// Mastra Code Notification hook: a Julia run has stopped and waits on Todd.
// Records the stop, posts a comment on the run's card, and sets Todd a reminder on it.
// Wired in .mastracode/hooks.json and, with --global, in ~/.mastracode/hooks.json so a
// session started outside this repository still pings.
// Design in docs/adr/0024-run-scorecard-and-stop-ping.md.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { appDataDir, cardForThread, stopsFile, threadProjectPath } from './scorecard.mjs';
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

// Linear never notifies Todd about a comment written with his own key, but an issue
// reminder he sets for himself is delivered like any notification, phone included.
const REMINDER_LEAD_MS = 30_000;
const REMINDER_MUTATION = `mutation Remind($id: String!, $at: DateTime!) { issueReminder(id: $id, reminderAt: $at) { success } }`;

function record(file, entry) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(entry) + '\n');
}

export async function handleStop(payload, env = process.env) {
  const file = stopsFile(env);
  const thread = payload.session_id;
  const db = join(appDataDir(env), 'mastra.db');
  const projectPath = threadProjectPath(db, thread);
  const card = cardForThread(db, thread) ?? branchCard(payload.cwd) ?? branchCard(projectPath);
  const stop = { id: randomUUID(), at: new Date().toISOString(), thread, cwd: payload.cwd ?? null, projectPath: projectPath ?? null, card: card ?? null, reason: payload.reason, message: payload.message ?? null };
  record(file, stop);
  if (!card) return { ...stop, posted: false, error: 'no card for this thread' };
  try {
    const opts = { apiKey: env.LINEAR_API_KEY };
    const comment = await postComment(card, stopComment({ reason: payload.reason, message: payload.message, thread, projectPath }), opts);
    const remindAt = new Date(Date.now() + REMINDER_LEAD_MS).toISOString();
    const { issueReminder } = await linearGraphQL(REMINDER_MUTATION, { id: card, at: remindAt }, opts);
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
