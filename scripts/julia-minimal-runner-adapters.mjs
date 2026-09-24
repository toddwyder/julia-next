// julia-minimal-runner-adapters.mjs -- the real outside services behind
// julia-minimal-runner.mjs (JUL-122): Gemini on this laptop through agy,
// DeepSeek and the publisher on the server over SSH, and Linear through
// linear-cli.mjs. Every call is an argument array or stdin, never a prompt,
// title or body placed inside a shell string.
import { spawnSync } from 'node:child_process';
// eslint-disable-next-line no-restricted-imports -- input files only, deleted after use, never a progress record: the PR title and body travel to the server as files so no card text is ever placed inside a shell string. https://man.openbsd.org/scp.1
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseAgyJsonResult } from '../ops/service-dropbox/run-agy-seat.mjs';
import { parsePiJsonStream } from '../ops/service-dropbox/run-pi-seat.mjs';
import { linearGraphQL, postComment } from './linear-cli.mjs';

// ---------------------------------------------------------------- Gemini

// Headless agy runs a shell command only if the user's global allow list in
// ~/.gemini/antigravity-cli/settings.json names it; anything else is denied
// and ends the turn. A project's own permission rules are ignored (measured
// 24 Sep, agy 1.2.7), so that global list is the command limit. No --project
// and no --sandbox (on Windows it needs admin and is denied). The worktree
// goes in with --add-dir and is named in the brief: without both, agy refused
// to read the folder and Gemini guessed paths under the home folder (24 Sep).
// --print is variadic and must come last, straight before the prompt
// (run-agy-seat.mjs).
export const agyArgs = (prompt, worktree) => ['--add-dir', worktree, '--output-format', 'json', '--disable-slash-commands', '--print', `Your working folder is ${worktree}.\n\n${prompt}`];

// No secrets, and no way to push: git's own environment config empties the
// credential helper and points origin's push URL nowhere.
export function workerEnv(env) {
  const kept = Object.fromEntries(Object.entries(env).filter(([name]) => !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|^NODE_TEST_CONTEXT$|^GIT_CONFIG/i.test(name)));
  return {
    ...kept,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: 'remote.origin.pushurl',
    GIT_CONFIG_VALUE_1: 'push-disabled-by-julia-runner:',
  };
}

// agy exits 0 and says SUCCESS even when it denied a tool and stopped (step 1).
export function agyOutcome(stdout, stderr = '') {
  const result = parseAgyJsonResult(stdout);
  if (!result.ok) return { ok: false, reason: result.errorText };
  const denied = JSON.parse(stdout).denied_actions ?? [];
  if (denied.length) {
    const names = denied.map((d) => `${d.action} (${d.display_name})`).join(', ');
    return { ok: false, reason: `agy denied ${names}: ${stderr.trim().split('\n').at(-1) ?? ''}` };
  }
  if (!String(result.response ?? '').trim()) return { ok: false, reason: 'agy reported SUCCESS with an empty reply' };
  return { ok: true, reason: null };
}

// Windows refuses a command line over 32,767 characters, and the brief is one argument.
const MAX_BRIEF_CHARS = 30_000;

export function geminiAdapter() {
  return async (prompt, { cwd }) => {
    if (prompt.length > MAX_BRIEF_CHARS) return { ok: false, reason: `the brief is ${prompt.length} characters, over the ${MAX_BRIEF_CHARS} a Windows command line can carry` };
    const run = spawnSync('agy', agyArgs(prompt, cwd), { cwd, encoding: 'utf8', env: workerEnv(process.env), maxBuffer: 64 * 1024 * 1024 });
    if (run.error) return { ok: false, reason: `agy did not start: ${run.error.message}` };
    return agyOutcome(run.stdout, run.stderr);
  };
}

// ---------------------------------------------------------------- Server

const SERVER = { host: 'ubuntu@100.125.239.98', key: join(homedir(), '.ssh', 'ovh_runner_ed25519') };
const SERVER_CHECKOUT = '/srv/orchestrator-svc/julia-next';
const ssh = (script, options = {}) => spawnSync('ssh', ['-i', SERVER.key, '-o', 'BatchMode=yes', SERVER.host, script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
const tail = (text) => String(text ?? '').trim().split('\n').slice(-5).join('\n');

// The last assistant message's text in Pi's JSON event stream.
export function lastAssistantText(stream) {
  let text = null;
  for (const line of String(stream).split('\n')) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    for (const message of [event?.message, ...(event?.messages ?? [])]) {
      if (message?.role !== 'assistant') continue;
      const parts = typeof message.content === 'string' ? [message.content] : (message.content ?? []).filter((p) => p?.type === 'text').map((p) => p.text);
      if (parts.join('').trim()) text = parts.join('');
    }
  }
  return text;
}

// DeepSeek through the server's reviewer seat, the route measured in step 1:
// the pinned run-pi-seat.mjs copied into a scratch folder the runner account
// can read, the prompt on stdin, the scratch folder removed on exit.
export function deepseekAdapter() {
  const script = [
    'set -e',
    'D=$(sudo -u runner mktemp -d /home/runner/julia-runner-review-XXXXXX)',
    'trap \'sudo rm -rf "${D:?}"\' EXIT',
    `sudo cp ${SERVER_CHECKOUT}/ops/service-dropbox/run-pi-seat.mjs ${SERVER_CHECKOUT}/ops/service-dropbox/read-secret.mjs "$D"/`,
    'sudo chown runner: "$D"/*',
    'cd /tmp',
    'sudo -u runner timeout 1800 node "$D/run-pi-seat.mjs" reviewer-backup --effort high',
  ].join('\n');
  return async (prompt) => {
    const run = ssh(script, { input: prompt });
    if (run.status !== 0) return { ok: false, reason: `the server review exited ${run.status}: ${tail(run.stderr)}` };
    const vendor = parsePiJsonStream(run.stdout);
    if (!vendor.ok) return { ok: false, reason: vendor.errorText };
    const text = lastAssistantText(run.stdout);
    return text ? { ok: true, text } : { ok: false, reason: 'the reviewer gave no reply text' };
  };
}

// The CLAUDE.md publishing route: the branch travels as a git bundle, the
// runner account checks it out, orchestrator-svc pushes and opens the PR with
// the GitHub App. Title and body travel as files, never inside the script.
export function publishAdapter({ repo = 'toddwyder/julia-next' } = {}) {
  return async ({ branch, sha, worktree, title, body }) => {
    const local = mkdtempSync(join(tmpdir(), 'julia-runner-publish-'));
    const name = `julia-runner-${sha.slice(0, 12)}`;
    try {
      const bundle = spawnSync('git', ['bundle', 'create', join(local, `${name}.bundle`), branch], { cwd: worktree, encoding: 'utf8' });
      if (bundle.status !== 0) throw new Error(`git bundle failed: ${tail(bundle.stderr)}`);
      writeFileSync(join(local, `${name}.title`), title);
      writeFileSync(join(local, `${name}.body`), body);
      const copy = spawnSync('scp', ['-i', SERVER.key, '-o', 'BatchMode=yes', ...['bundle', 'title', 'body'].map((ext) => join(local, `${name}.${ext}`)), `${SERVER.host}:/tmp/`], { encoding: 'utf8' });
      if (copy.status !== 0) throw new Error(`scp failed: ${tail(copy.stderr)}`);
      const publisher = `sudo -u orchestrator-svc node --env-file=/etc/orchestrator-svc/.env.publisher ${SERVER_CHECKOUT}/scripts/publish-pr.mjs`;
      const script = [
        'set -e',
        `F=/tmp/${name}; W=/home/runner/wt-${name}`,
        'trap \'sudo -u runner git -C /home/runner/julia-next worktree remove --force "$W" 2>/dev/null || true; sudo rm -f "$F".bundle "$F".title "$F".body\' EXIT',
        `sudo -u runner git -C /home/runner/julia-next fetch -q "$F.bundle" "+${branch}:${branch}"`,
        `sudo -u runner git -C /home/runner/julia-next worktree add -q "$W" "${branch}"`,
        `test "$(sudo -u runner git -C "$W" rev-parse HEAD)" = "${sha}"`,
        'cd /tmp',
        `${publisher} push --repo ${repo} --branch "${branch}" --cwd "$W" >&2`,
        `${publisher} open --repo ${repo} --head "${branch}" --base main --title "$(cat "$F.title")" --body "$(cat "$F.body")"`,
      ].join('\n');
      const run = ssh(script);
      if (run.status !== 0) throw new Error(`publishing on the server failed: ${tail(run.stderr)}`);
      return { url: JSON.parse(run.stdout.trim().split('\n').at(-1)).url };
    } finally {
      rmSync(local, { recursive: true, force: true });
    }
  };
}

// ---------------------------------------------------------------- Linear

const CARD_QUERY = `query Card($id: String!) {
  issue(id: $id) { id identifier title description team { states { nodes { id name } } } comments(first: 250) { nodes { body createdAt } } }
  viewer { id }
}`;
const MOVE_MUTATION = `mutation Move($id: String!, $stateId: String!, $assigneeId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId, assigneeId: $assigneeId }) { success }
}`;

// UAT, assigned to the key's owner (CLAUDE.md: finished work goes to UAT for Todd).
export function linearAdapter({ apiKey = process.env.LINEAR_API_KEY } = {}) {
  const opts = { apiKey };
  const read = (id) => linearGraphQL(CARD_QUERY, { id }, opts);
  return {
    getCard: async (id) => {
      const { issue } = await read(id);
      const comments = [...issue.comments.nodes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return { identifier: issue.identifier, title: issue.title, description: issue.description ?? '', comments };
    },
    comment: (id, body) => postComment(id, body, opts),
    moveToUat: async (id) => {
      const { issue, viewer } = await read(id);
      const uat = issue.team.states.nodes.find((state) => state.name === 'UAT');
      if (!uat) throw new Error('the team has no UAT state');
      const { issueUpdate } = await linearGraphQL(MOVE_MUTATION, { id: issue.id, stateId: uat.id, assigneeId: viewer.id }, opts);
      if (!issueUpdate.success) throw new Error(`Linear refused to move ${id} to UAT`);
    },
  };
}
