// julia-minimal-runner-adapters.mjs -- the real outside services behind
// julia-minimal-runner.mjs (JUL-122), on the OVH server. The jobs are split
// across accounts (Todd, 24 Sep):
//
//   * the runner itself runs as orchestrator-svc, started by systemd-run with
//     the Linear app credential loaded from systemd-creds; it alone reads it;
//   * Gemini edits as gemini-worker (no groups, no service keys, no commands);
//   * a non-LLM test worker runs the approved tests as julia-tester;
//   * DeepSeek reviews as runner (it holds only the Command Code key);
//   * the existing publisher opens the PR as orchestrator-svc.
//
// Each worker starts through sudo with one fixed, root-owned command
// (ops/julia-runner/sudoers) and gets its input on stdin and an environment of
// PATH and LANG only, so nothing of the runner's reaches it.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseAgyJsonResult } from '../ops/service-dropbox/run-agy-seat.mjs';
import { parsePiJsonStream } from '../ops/service-dropbox/run-pi-seat.mjs';
import { linearGraphQL, postComment } from './linear-cli.mjs';

// Each worker's account and the one command line it runs there.
export const WORKERS = {
  gemini: { account: 'gemini-worker', command: ['/usr/bin/node', '/opt/julia-runner/ops/julia-runner/run-gemini.mjs'] },
  tests: { account: 'julia-tester', command: ['/usr/bin/node', '/opt/julia-runner/ops/julia-runner/run-tests.mjs'] },
  review: { account: 'runner', command: ['/usr/bin/node', '/opt/julia-runner/ops/service-dropbox/run-pi-seat.mjs', 'reviewer-backup', '--effort', 'high'] },
};
// Exactly the command lines the sudoers rules allow; -n fails at once rather
// than waiting for a password nobody will type.
export const sudoCommand = (worker) => ['-n', '-u', WORKERS[worker].account, '--', ...WORKERS[worker].command];
const WORKER_ENV = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' };

// Runs a command to its end, handing each line of its output to onLine as the
// line arrives, so a long call shows progress while it runs.
function runStreaming(command, args, { input = '', onLine = () => {}, ...options } = {}) {
  return new Promise((done) => {
    const child = spawn(command, args, options);
    let stdout = '';
    let stderr = '';
    let partial = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
      const lines = (partial + chunk).split('\n');
      partial = lines.pop();
      lines.forEach((line) => onLine(line, stdout.length));
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => done({ status: null, error, stdout, stderr }));
    child.on('close', (status) => {
      if (partial) onLine(partial, stdout.length);
      done({ status, error: null, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

const lastLines = (text, count = 5) => String(text ?? '').trim().split('\n').slice(-count).join('\n');
const parseLine = (line) => {
  if (typeof line !== 'string') return line;
  try { return JSON.parse(line); } catch { return null; }
};

// ---------------------------------------------------------------- Gemini

// One progress line per Gemini tool step, when it starts: the tool's name and
// its first text argument (the file).
export function agyStepLine(line) {
  const step = parseLine(line)?.step_update;
  if (step?.state !== 'ACTIVE' || !step.tool_name) return null;
  const argument = Object.values(step.tool_info?.parameters ?? {}).find((value) => typeof value === 'string');
  return argument ? `${step.tool_name} ${argument}` : step.tool_name;
}

// agy exits 0 and says SUCCESS even when it denied a tool and stopped (step 1).
// The outcome is the stream's final {"event":"result"} line.
export function agyOutcome(stdout, stderr = '') {
  const events = String(stdout).split('\n').map(parseLine).filter(Boolean);
  const final = events.findLast((event) => event.event === 'result')?.result ?? (events.length === 1 ? events[0] : null);
  if (!final) return { ok: false, reason: `agy ended without a result${stderr ? `: ${lastLines(stderr, 1)}` : ''}` };
  const result = parseAgyJsonResult(JSON.stringify(final));
  if (!result.ok) return { ok: false, reason: result.errorText };
  const denied = final.denied_actions ?? [];
  if (denied.length) {
    const names = denied.map((d) => `${d.action} (${d.display_name})`).join(', ');
    return { ok: false, reason: `agy denied ${names}: ${lastLines(stderr, 1)}` };
  }
  if (!String(result.response ?? '').trim()) return { ok: false, reason: 'agy reported SUCCESS with an empty reply' };
  // The reply carries Gemini's hand-in (its JSON evidence) for the runner.
  return { ok: true, reason: null, text: String(result.response) };
}

export function geminiAdapter({ run = runStreaming } = {}) {
  return async (prompt, { cwd, onProgress = () => {} }) => {
    const onLine = (line) => { const step = agyStepLine(line); if (step) onProgress(step); };
    const turn = await run('sudo', sudoCommand('gemini'), { input: JSON.stringify({ worktree: cwd, prompt }), env: WORKER_ENV, onLine });
    if (turn.error) return { ok: false, reason: `the Gemini worker did not start: ${turn.error.message}` };
    return agyOutcome(turn.stdout, turn.stderr);
  };
}

// ---------------------------------------------------------------- Test worker

// The worker answers with one JSON line {status, output}. Anything else (sudo
// refused, the worker crashed) is a failed run with the reason, never a pass.
export function testerAdapter({ run = runStreaming } = {}) {
  return async (request) => {
    const answer = await run('sudo', sudoCommand('tests'), { input: JSON.stringify(request), env: WORKER_ENV });
    const reply = parseLine(lastLines(answer.stdout, 1));
    if (answer.status === 0 && Number.isInteger(reply?.status)) return { status: reply.status, output: String(reply.output ?? '') };
    return { status: 1, output: `the test worker did not answer (exit ${answer.status}): ${lastLines(answer.stderr) || answer.error?.message || ''}` };
  };
}

// ---------------------------------------------------------------- DeepSeek

// The last assistant message's text in Pi's JSON event stream.
export function lastAssistantText(stream) {
  let text = null;
  for (const line of String(stream).split('\n')) {
    const event = parseLine(line);
    for (const message of [event?.message, ...(event?.messages ?? [])]) {
      if (message?.role !== 'assistant') continue;
      const parts = typeof message.content === 'string' ? [message.content] : (message.content ?? []).filter((p) => p?.type === 'text').map((p) => p.text);
      if (parts.join('').trim()) text = parts.join('');
    }
  }
  return text;
}

// DeepSeek through the reviewer seat as runner, the prompt on stdin, from /
// (the runner's own folders are not the reviewer's business). A review is one
// long turn, so progress is the reply arriving, once per megabyte (Pi resends
// the growing message, so smaller steps flood the terminal).
export function deepseekAdapter({ run = runStreaming } = {}) {
  return async (prompt, { onProgress = () => {} } = {}) => {
    let reported = 0;
    const onLine = (_line, received) => {
      if (received - reported < 1024 * 1024) return;
      reported = received;
      onProgress(`${Math.round(received / 1024)} KB of the reply received`);
    };
    const reply = await run('sudo', sudoCommand('review'), { input: prompt, cwd: '/', env: WORKER_ENV, onLine });
    if (reply.error) return { ok: false, reason: `the review worker did not start: ${reply.error.message}` };
    if (reply.status !== 0) return { ok: false, reason: `the review exited ${reply.status}: ${lastLines(reply.stderr)}` };
    const vendor = parsePiJsonStream(reply.stdout);
    if (!vendor.ok) return { ok: false, reason: vendor.errorText };
    const text = lastAssistantText(reply.stdout);
    return text ? { ok: true, text } : { ok: false, reason: 'the reviewer gave no reply text' };
  };
}

// ---------------------------------------------------------------- Publisher

// The existing publisher, as orchestrator-svc: publish-pr.mjs pushes the
// worktree's HEAD with the GitHub App and opens the PR. Arguments only, no shell.
const PUBLISHER = ['--env-file=/etc/orchestrator-svc/.env.publisher', '/srv/orchestrator-svc/julia-next/scripts/publish-pr.mjs'];
const REPO = 'toddwyder/julia-next';

export function publishAdapter({ spawnImpl = spawnSync } = {}) {
  return async ({ branch, worktree, title, body, onProgress = () => {} }) => {
    const publish = (...args) => {
      const result = spawnImpl('node', [...PUBLISHER, ...args], { cwd: '/tmp', encoding: 'utf8' });
      if (result.status !== 0) throw new Error(`publish-pr ${args[0]} failed: ${lastLines(result.stderr)}`);
      return result.stdout;
    };
    onProgress(`pushing ${branch}`);
    publish('push', '--repo', REPO, '--branch', branch, '--cwd', worktree);
    onProgress('opening the PR');
    return { url: JSON.parse(lastLines(publish('open', '--repo', REPO, '--head', branch, '--base', 'main', '--title', title, '--body', body), 1)).url };
  };
}

// ---------------------------------------------------------------- Linear

// The runner's Linear identity is the "Julia controller" OAuth app. Its client
// id and secret are systemd credentials: systemd-run decrypts them from
// /etc/credstore.encrypted into a directory only this process's account can
// read, and names it in CREDENTIALS_DIRECTORY. Read in-process, never logged,
// never passed on.
export function readAppCredential({ dir = process.env.CREDENTIALS_DIRECTORY } = {}) {
  if (!dir) {
    throw new Error('the Linear app credential is not available: there is no systemd credentials directory. Start the runner with systemd-run and LoadCredentialEncrypted=linear-app-id and linear-app-secret (ops/julia-runner/README.md)');
  }
  try {
    return {
      clientId: readFileSync(join(dir, 'linear-app-id'), 'utf8').replace(/\n$/, ''),
      clientSecret: readFileSync(join(dir, 'linear-app-secret'), 'utf8').replace(/\n$/, ''),
    };
  } catch (error) {
    throw new Error(`the Linear app credential could not be read from the systemd credentials directory (${error.code ?? error.message})`);
  }
}

const TOKEN_URL = 'https://api.linear.app/oauth/token';
const TOKEN_SCOPE = 'comments:create read write';
// Todd's Linear user: finished work goes to UAT assigned to him (CLAUDE.md).
const TODD_LINEAR_USER_ID = 'a55c040c-d281-4382-8e66-c23ab7346919';

const CARD_QUERY = `query Card($id: String!) {
  issue(id: $id) { id identifier title description team { states { nodes { id name } } } comments(first: 250) { nodes { body createdAt } } }
}`;
const DESCRIBE_MUTATION = `mutation Describe($id: String!, $description: String!) {
  issueUpdate(id: $id, input: { description: $description }) { success }
}`;
const MOVE_MUTATION = `mutation Move($id: String!, $stateId: String!, $assigneeId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId, assigneeId: $assigneeId }) { success }
}`;

export function linearAdapter({ fetchImpl = fetch, readCredential = readAppCredential } = {}) {
  let token = null;
  // One client-credentials token per run, fetched on first use; the secret
  // goes only in this request's body, to Linear's token endpoint.
  const opts = async () => {
    if (!token) {
      const { clientId, clientSecret } = readCredential();
      const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: TOKEN_SCOPE, actor: 'app' });
      const res = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
      if (!res.ok) throw new Error(`Linear refused the app credential (HTTP ${res.status})`);
      token = (await res.json()).access_token;
      if (!token) throw new Error('Linear returned no access token for the app credential');
    }
    return { accessToken: token, fetchImpl };
  };
  const read = async (id) => (await linearGraphQL(CARD_QUERY, { id }, await opts())).issue;
  return {
    getCard: async (id) => {
      const issue = await read(id);
      const comments = [...issue.comments.nodes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return { identifier: issue.identifier, title: issue.title, description: issue.description ?? '', comments };
    },
    comment: async (id, body) => postComment(id, body, await opts()),
    // Ticks the acceptance boxes before the UAT move (acceptance-check.mjs tickCriteria).
    setDescription: async (id, description) => {
      const issue = await read(id);
      const { issueUpdate } = await linearGraphQL(DESCRIBE_MUTATION, { id: issue.id, description }, await opts());
      if (!issueUpdate?.success) throw new Error(`Linear refused to update ${id}'s description`);
    },
    moveToUat: async (id) => {
      const issue = await read(id);
      const uat = issue.team.states.nodes.find((state) => state.name === 'UAT');
      if (!uat) throw new Error('the team has no UAT state');
      const { issueUpdate } = await linearGraphQL(MOVE_MUTATION, { id: issue.id, stateId: uat.id, assigneeId: TODD_LINEAR_USER_ID }, await opts());
      if (!issueUpdate.success) throw new Error(`Linear refused to move ${id} to UAT`);
    },
  };
}
