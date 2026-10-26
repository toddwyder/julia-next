#!/usr/bin/env node
// Mastra Code Notification hook: a Julia run has stopped and waits on Todd.
// Records the stop, posts a comment on the run's card, and sets Todd a reminder on it.
// Wired in .mastracode/hooks.json; design in docs/adr/0024-run-scorecard-and-stop-ping.md.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { appDataDir, cardForThread, stopsFile } from './scorecard.mjs';
import { linearGraphQL, postComment } from './linear-cli.mjs';

const TODD_PROFILE = 'https://linear.app/julia-next/profiles/toddwyder';

const REASONS = {
  ask_question: 'asked you a question',
  tool_approval: 'needs you to approve a tool call',
  plan_approval: 'needs you to approve a plan',
  sandbox_access: 'needs access to a folder',
  agent_done: 'finished its turn and needs your reply',
};

export function stopComment({ reason, message, thread }) {
  const lines = [`${TODD_PROFILE} Julia stopped: the run ${REASONS[reason] ?? `stopped (${reason})`}.`];
  if (message?.trim()) lines.push('', '> ' + message.trim().slice(0, 1200).replace(/\n/g, '\n> '));
  lines.push('', `Mastra Code thread \`${thread}\`. Reply in that session to continue.`);
  return lines.join('\n');
}

function branchCard(cwd) {
  try {
    return execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' }).match(/jul-\d+/i)?.[0].toUpperCase();
  } catch {
    return undefined;
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
  const card = cardForThread(join(appDataDir(env), 'mastra.db'), thread) ?? branchCard(payload.cwd);
  const stop = { id: randomUUID(), at: new Date().toISOString(), thread, card: card ?? null, reason: payload.reason, message: payload.message ?? null };
  record(file, stop);
  if (!card) return { ...stop, posted: false, error: 'no card for this thread' };
  try {
    const opts = { apiKey: env.LINEAR_API_KEY };
    const comment = await postComment(card, stopComment({ reason: payload.reason, message: payload.message, thread }), opts);
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
  const result = await handleStop(payload);
  if (result.error) console.error(`stop-ping: ${result.error}`);
}
