#!/usr/bin/env node
// JUL-292 -- the machine: one command starts a card and it runs to UAT by
// itself. `start <CARD>` spawns a fresh Mastra Code session to build the card,
// a second fresh session (Shipping) to judge it against the card's own words,
// then puts the change on a preview address, reruns the regression suite there
// and hands Todd the address. Nothing in between needs a human.
//
// The run lives where the dashboard already reads it: <state>/state/runs/<id>.json,
// one file per card, every step with its start and finish time.
//
// Every outside service is reached through the tool that owns it. Linear through
// scripts/linear-cli.mjs, GitHub through gh, model sessions through the
// `mastracode` launcher (the one place a session gets a trace file, so its cost
// reaches the scorecard), the Julia app through the verify-julia skill. Each
// session's prompt is written next to its log, so a stopped card can be read back.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { ACTIVE_RUN_STATUSES, readJsonRecord, runsFolder, stateRoot, writeJsonRecord } from '../lib/state.js';
import { shippingVerdict } from '../../scripts/check-shipping-verdict.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
export const DASHBOARD_ROOT = resolve(here, '..');
export const REPO_ROOT = resolve(here, '../..');
const LINEAR_CLI = join(REPO_ROOT, 'scripts/linear-cli.mjs');
const VERIFY_JULIA = join(REPO_ROOT, '.agents/skills/verify-julia/verify-julia.mjs');

// The Start screen offers four efforts. Each one is a thinking budget, and this
// is the only place the two vocabularies meet.
export const THINKING_FOR_EFFORT = Object.freeze({ small: 'low', medium: 'medium', large: 'high', unlimited: 'max' });
export const PREVIEW_PORT = 4314;
// The order the machine works in. A card already built and pulled can be picked up at any
// of these with --from, which is how a card that stopped earlier is carried on.
export const STEPS = Object.freeze(['build', 'shipping', 'preview', 'smoke', 'uat']);
const CARD_PATTERN = /^JUL-\d+$/;

const now = () => new Date().toISOString();

export function normalizeCard(value) {
  const card = String(value ?? '').trim().toUpperCase();
  if (!CARD_PATTERN.test(card)) throw new Error(`"${value ?? ''}" is not a card; pass one like JUL-290`);
  return card;
}

export const runIdFor = card => normalizeCard(card).toLowerCase();

export function branchFor(card, title) {
  const slug = String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 5)
    .join('-');
  const number = normalizeCard(card).slice(4);
  return slug ? `feat/jul-${number}-${slug}` : `feat/jul-${number}`;
}

export const thinkingForEffort = effort => THINKING_FOR_EFFORT[effort] ?? THINKING_FOR_EFFORT.large;

// A dashboard card is proved on a second copy of the dashboard; a Julia card is
// proved on its pull request's Vercel preview. The diff decides, because a card
// label and the code it ends up touching do not always agree.
export function previewKind(changedPaths) {
  const paths = (changedPaths ?? []).filter(Boolean);
  if (!paths.length) throw new Error('the pull request changes no files; there is nothing to preview');
  return paths.some(path => path.startsWith('dashboard/')) ? 'dashboard' : 'julia';
}

export function newRunRecord({ card, branch, worktree, models, pull = null }) {
  return {
    id: runIdFor(card),
    card: normalizeCard(card),
    status: 'running',
    startedAt: now(),
    updatedAt: now(),
    branch,
    worktree,
    models,
    pull,
    preview: null,
    steps: [],
    rounds: { shipping: 0, remediation: 0 },
    waitingFor: null,
    stoppedBecause: null,
  };
}

export const stepEntry = (name, log) => ({ name, status: 'running', startedAt: now(), finishedAt: null, detail: null, log });

export function recordFile(card, env = process.env) {
  return join(runsFolder(env), `${runIdFor(card)}.json`);
}

export function saveRecord(record, env = process.env) {
  record.updatedAt = now();
  mkdirSync(runsFolder(env), { recursive: true });
  writeJsonRecord(recordFile(record.card, env), record);
  return record;
}

const latest = (record, name) => [...record.steps].reverse().find(step => step.name === name) ?? null;

// ---------------------------------------------------------------------------
// running commands

// CLICOLOR_FORCE is set in this agent shell, so `gh` paints its JSON and nothing can parse it.
// Every command the machine runs is read by a program, never by a person, so colour is off.
export function commandEnv(env = process.env) {
  const clean = { ...env, NO_COLOR: '1', CLICOLOR: '0' };
  delete clean.CLICOLOR_FORCE;
  delete clean.GH_FORCE_TTY;
  return clean;
}

export const withoutColour = text => String(text ?? '').replace(/\u001b\[[0-9;]*m/g, '');

function shell(command, args, { cwd = REPO_ROOT } = {}) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', env: commandEnv(), maxBuffer: 64 * 1024 * 1024 });
}

export function printed(command, args, options) {
  const result = shell(command, args, options);
  // spawnSync reports the exit code as `status`; `code` belongs to execFileSync.
  if (result.status !== 0) {
    const tail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').slice(-2).join(' | ');
    throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status ?? result.signal}): ${tail}`);
  }
  return result.stdout ?? '';
}

function ghJson(args) {
  const text = withoutColour(printed('gh', args));
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`gh ${args.join(' ')} did not print JSON: ${text.slice(0, 200)}`);
  }
}

function run(command, args, { cwd = REPO_ROOT, log = null, input = null, timeoutMs = 0 } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd, env: commandEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const sink = chunk => {
      if (log) appendFileSync(log, chunk);
    };
    child.stdout.on('data', chunk => {
      stdout += chunk;
      sink(chunk);
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
      sink(chunk);
    });
    const timer = timeoutMs ? setTimeout(() => child.kill('SIGKILL'), timeoutMs) : null;
    child.on('error', error => {
      if (timer) clearTimeout(timer);
      fail(new Error(`${command} could not start: ${error.message}`));
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      done({ code, signal, stdout, stderr });
    });
    child.stdin.end(input ?? '');
  });
}

async function mustRun(command, args, options, what) {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    const tail = `${result.stdout}${result.stderr}`.trim().split('\n').slice(-3).join(' | ');
    throw new Error(`${what} failed (exit ${result.code ?? result.signal}): ${tail}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// the card, the pull request, the branch

export function readIssue(card) {
  const issue = JSON.parse(printed(process.execPath, [LINEAR_CLI, 'get-issue', normalizeCard(card)]));
  if (!issue) throw new Error(`${card} is not on the board`);
  return issue;
}

export function pullNamesCard(pull, card) {
  const wanted = normalizeCard(card);
  if (String(pull.title ?? '').includes(wanted)) return true;
  return String(pull.body ?? '')
    .split('\n')
    .some(line => line.trim() === `Card: ${wanted}`);
}

export function pullForCard(card) {
  const pulls = ghJson(['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,headRefName,headRefOid,title,body,url']);
  return pulls.find(pull => pullNamesCard(pull, card)) ?? null;
}

export function worktreeHolding(branch) {
  const listing = printed('git', ['worktree', 'list', '--porcelain']);
  for (const block of listing.split('\n\n').filter(Boolean)) {
    const lines = block.split('\n');
    const path = lines.find(line => line.startsWith('worktree '))?.slice('worktree '.length);
    const ref = lines.find(line => line.startsWith('branch '))?.slice('branch '.length);
    if (path && ref === `refs/heads/${branch}`) return path;
  }
  return null;
}

// A card's branch can live in a checkout of its own (the operator keeps one per card while it
// is being built), which no `git worktree add` from here can claim again. Reuse it by name.
export function checkoutOn(path, branch) {
  const head = shell('git', ['-C', path, 'rev-parse', '--abbrev-ref', 'HEAD']);
  return head.status === 0 && String(head.stdout).trim() === branch;
}

export function ensureWorktree({ branch, path, base = 'origin/main' }) {
  if (checkoutOn(path, branch)) return path;
  const held = worktreeHolding(branch);
  if (held) return held;
  mkdirSync(resolve(path, '..'), { recursive: true });
  const exists = shell('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0;
  printed('git', exists ? ['worktree', 'add', path, branch] : ['worktree', 'add', '-b', branch, path, base]);
  return path;
}

// ---------------------------------------------------------------------------
// sessions

export function sessionArgs({ model, effort, title, timeoutMs }) {
  return [
    '--prompt', '-',
    '--model', model,
    '--thinking-level', thinkingForEffort(effort),
    '--title', title,
    '--output', 'jsonl',
    '--permission-mode', 'auto',
    '--timeout', String(Math.max(60, Math.floor(timeoutMs / 1000))),
  ];
}

export function lastSessionResult(text) {
  const lines = String(text ?? '').split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line.startsWith('{')) continue;
    try {
      const event = JSON.parse(line);
      if (event?.type === 'result') return event;
    } catch {
      // the CLI writes coloured progress lines too; they are not JSON
    }
  }
  return null;
}

async function runSession({ name, prompt, cwd, model, effort, title, log, timeoutMs }) {
  mkdirSync(resolve(log, '..'), { recursive: true });
  writeFileSync(log.replace(/\.log$/, '.prompt.md'), prompt);
  const args = sessionArgs({ model, effort, title, timeoutMs });
  appendFileSync(log, `\n$ mastracode ${args.join(' ')}\n`);
  const child = spawn('mastracode', args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let killed = false;
  const backstop = setTimeout(() => {
    killed = true;
    child.kill('SIGKILL');
  }, timeoutMs + 120_000);
  await new Promise((done, fail) => {
    child.stdout.on('data', chunk => {
      stdout += chunk;
      appendFileSync(log, chunk);
    });
    child.stderr.on('data', chunk => appendFileSync(log, chunk));
    child.on('error', error => {
      clearTimeout(backstop);
      fail(new Error(`${name} session could not start: ${error.message}`));
    });
    child.on('close', () => {
      clearTimeout(backstop);
      done();
    });
    child.stdin.end(prompt);
  });
  if (killed) throw new Error(`${name} session was still running after ${Math.round(timeoutMs / 60000)} minutes and was stopped; its work is in ${cwd}, its log is ${log}`);
  const result = lastSessionResult(stdout);
  if (result?.status !== 'completed' || result.exitCode !== 0) {
    throw new Error(`${name} session did not finish (${result?.status ?? 'no result event'}, exit ${result?.exitCode ?? '?'}); log ${log}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// prompts

export function buildPrompt({ card, issue, branch, pull }) {
  return `You are the build session for Linear card ${card}: ${issue.title}

The card, in full. Its acceptance criteria are the only definition of done, and
its UAT steps are what Todd will do on the preview.

---
${issue.description ?? '(the card has no description)'}
---

Read AGENTS.md at the repository root first, then docs/plans/path-forward.md.
Activate the poteto-mode skill and follow it as written, using the playbook its
table names for this card's label.

You are on branch ${branch}.${pull ? `
Pull request #${pull.number} is already open for this branch and may already carry
work: ${pull.url}` : ''}

Finish the card on this branch:
- If the branch already satisfies every acceptance criterion, change nothing and
  say what you checked.
- Otherwise make the change, prove it yourself by running it, then commit and
  push to ${branch}.
- Open the pull request to main if there is none, naming the card in the body on
  its own line as: Card: ${card}
- Build the card's scorecard with: node scripts/scorecard.mjs ${card} --write
- Post one Linear comment on ${card} per acceptance criterion, naming the evidence
  you checked, with: node scripts/linear-cli.mjs comment ${card} --file <path>

Do not merge the pull request and do not move the card; Shipping and Todd decide
those. When you are done, print what you changed, the pull request number, and
what Shipping should look at first.`;
}

export function shippingPrompt({ card, issue, pull, verifierModel }) {
  return `You are Shipping for Linear card ${card}: ${issue.title}

You did not build this card and you never see the builder's conversation. Your
job is to find out whether the change does what the card says, by running it.

The card, in full:

---
${issue.description ?? '(the card has no description)'}
---

The change is pull request #${pull.number} on ${pull.headRefName}, head ${pull.headRefOid}:
${pull.url}

Work the way Todd would:
- Read the diff (gh pr diff ${pull.number}) and the card's acceptance criteria.
- Run the change yourself. For a dashboard card, build this branch and start a
  copy on a free port, or drive a preview address if you were given one. For a
  Julia card, use .agents/skills/verify-julia/verify-julia.mjs. Read the page and
  run the tests; do not trust a summary of them.
- Judge each acceptance criterion PASS or FAIL on what you saw. A criterion you
  could not check is a FAIL, and says what you could not reach.

Report both ways, in exactly these two shapes:
1. One Linear comment on ${card} per criterion naming the evidence you checked,
   posted with: node scripts/linear-cli.mjs comment ${card} --file <path>
2. One pull request comment on #${pull.number} holding a fenced json block:

\`\`\`json
{"juliaShippingVerdict":1,"card":"${card}","head":"${pull.headRefOid}","verdict":"PASS","builder":"<GitHub login of the head commit author>","verifier":"${verifierModel}","criteria":[{"criterion":"<the card's own words>","verdict":"PASS","note":"<what you ran and what you saw>"}]}
\`\`\`

When any criterion fails, put "FAIL" in the verdict and on every criterion that
failed and say what you saw instead. The head commit author is in:
gh pr view ${pull.number} --json commits
Post the block with: gh pr comment ${pull.number} --body-file <path>

Do not fix anything, do not push, do not merge, do not move the card.`;
}

export function remediationPrompt({ card, issue, pull, verdict }) {
  const failed = (verdict?.criteria ?? []).filter(criterion => criterion.verdict !== 'PASS');
  const reasons = failed.map(criterion => `- ${criterion.criterion}: ${criterion.note ?? '(no note)'}`).join('\n');
  return `You are the remediation session for Linear card ${card}: ${issue.title}

Shipping judged pull request #${pull.number} (${pull.url}) and these criteria
failed:

${reasons || '- the verdict listed none; read the pull request comments for what Shipping saw'}

Read AGENTS.md, then docs/plans/path-forward.md. Activate the poteto-mode skill
and follow its Bug fix playbook: find the cause Shipping's reason points at, fix
it, prove it, and add a check that would have caught it.

Work on branch ${pull.headRefName}. Commit, push, and post one Linear comment on
${card} saying what you changed for each failing criterion.

Do not merge and do not move the card; Shipping's next pass has to find it green
on its own.`;
}

// ---------------------------------------------------------------------------
// preview

export function tailnetHost() {
  const result = shell('/usr/bin/env', ['bash', '-lc', 'tailscale ip -4 2>/dev/null | head -1']);
  const address = result.status === 0 ? String(result.stdout).trim() : '';
  return address || '127.0.0.1';
}

async function waitForDashboard(address, log, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL('/api/health', address), { signal: AbortSignal.timeout(10_000) });
      const body = await response.json();
      appendFileSync(log, `health ${response.status} ${JSON.stringify(body).slice(0, 300)}\n`);
      if (body?.status === 'ok') return body;
    } catch (error) {
      appendFileSync(log, `health not up yet: ${error.message}\n`);
    }
    await sleep(3_000);
  }
  throw new Error(`the preview on ${address} never answered /api/health; see ${log}`);
}

async function dashboardPreview({ worktree, card, log, env = process.env }) {
  const dashboard = join(worktree, 'dashboard');
  if (!existsSync(join(dashboard, 'node_modules'))) {
    await mustRun('npm', ['ci'], { cwd: dashboard, log }, 'npm ci for the preview build');
  }
  await mustRun('npm', ['run', 'build'], { cwd: dashboard, log }, 'npm run build for the preview');
  const address = `http://${tailnetHost()}:${PREVIEW_PORT}`;
  const child = spawn('node', ['server.js'], {
    cwd: dashboard,
    env: {
      ...process.env,
      DASHBOARD_HOST: '0.0.0.0',
      DASHBOARD_PORT: String(PREVIEW_PORT),
      DASHBOARD_STATE_DIR: join(stateRoot(env), 'preview-state'),
    },
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', chunk => appendFileSync(log, chunk));
  child.unref();
  appendFileSync(log, `preview pid ${child.pid} at ${address}\n`);
  await waitForDashboard(address, log);
  return { kind: 'dashboard', address, port: PREVIEW_PORT, pid: child.pid, cardPage: `${address}/start/${card}` };
}

export async function vercelPreview({ repo, sha, log, timeoutMs = 20 * 60_000 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const deployments = ghJson(['api', `repos/${repo}/deployments?sha=${sha}&per_page=20`]);
    for (const deployment of deployments) {
      const statuses = ghJson(['api', `repos/${repo}/deployments/${deployment.id}/statuses`]);
      const ready = statuses.find(status => status.environment_url);
      if (ready) return { kind: 'julia', address: ready.environment_url, deployment: deployment.id, state: ready.state };
    }
    appendFileSync(log, `no preview for ${sha} yet (${deployments.length} deployment(s))\n`);
    await sleep(15_000);
  }
  throw new Error(`Vercel published no preview for ${sha}; see ${log}`);
}

// ---------------------------------------------------------------------------
// smoke: the whole regression suite, on the preview

export function juliaSpecs() {
  const folder = join(REPO_ROOT, '.agents/skills/verify-julia/tests');
  return readdirSync(folder)
    .filter(name => name.endsWith('.spec.mjs'))
    .sort()
    .map(name => join(folder, name));
}

export function smokeCommands({ kind, address, worktree }) {
  if (kind === 'dashboard') {
    const dashboard = join(worktree, 'dashboard');
    return [
      { cwd: dashboard, command: 'npm', args: ['test'], what: `${dashboard}: npm test` },
      { cwd: dashboard, command: 'npm', args: ['run', 'lint'], what: 'dashboard lint' },
      { cwd: dashboard, command: 'node', args: ['scripts/lanes.mjs', '--url', address], what: `lanes.mjs against ${address}` },
      { cwd: dashboard, command: 'node', args: ['scripts/check-start-address.mjs', address], what: `Start screen check on ${address}` },
    ];
  }
  return [
    { cwd: REPO_ROOT, command: process.execPath, args: [VERIFY_JULIA, 'launch', '--url', address], what: `verify-julia launch --url ${address}` },
    { cwd: REPO_ROOT, command: process.execPath, args: [VERIFY_JULIA, 'doctor'], what: 'verify-julia doctor' },
    { cwd: REPO_ROOT, command: process.execPath, args: [VERIFY_JULIA, 'test', ...juliaSpecs()], what: 'verify-julia test' },
  ];
}

// ---------------------------------------------------------------------------
// what Todd reads

export function uatSection(description) {
  const text = String(description ?? '');
  const heading = text.match(/^#{1,6}\s*UAT steps\s*$/im);
  if (!heading) return '';
  const rest = text.slice(heading.index + heading[0].length);
  const next = rest.search(/^#{1,6}\s/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

export function uatComment({ card, issue, preview }) {
  const address = preview.kind === 'dashboard' ? preview.cardPage : preview.address;
  return `The change for ${card} is on a preview address and waiting for you.

${address}

The card's own steps, in household terms:

${uatSection(issue.description) || '(the card carries no UAT steps of its own yet)'}

Open the address, follow those steps, and reply here with yes if it holds. A yes
lands it and it finishes with its retro; a no sends it back with your note.`;
}

export function passing(verdict) {
  return verdict?.ok === true;
}

export function failedCriteria(verdict) {
  return (verdict?.criteria ?? []).filter(criterion => criterion.verdict !== 'PASS');
}

// ---------------------------------------------------------------------------
// steps

async function buildStep({ record, issue, env, name = 'build', verdict = null }) {
  const step = latest(record, name);
  const pull = pullForCard(record.card);
  record.worktree = ensureWorktree({ branch: record.branch, path: record.worktree });
  saveRecord(record, env);
  await runSession({
    name,
    prompt: name === 'remediation'
      ? remediationPrompt({ card: record.card, issue, pull: record.pull ?? pull, verdict })
      : buildPrompt({ card: record.card, issue, branch: record.branch, pull }),
    cwd: record.worktree,
    model: record.models.builder,
    effort: record.models.effort,
    title: `${record.card} ${name}`,
    log: step.log,
    timeoutMs: 3 * 60 * 60_000,
  });
  const opened = pullForCard(record.card);
  if (!opened) throw new Error(`the build session finished with no pull request naming ${record.card} on ${record.branch}; see ${step.log}`);
  record.pull = opened;
  saveRecord(record, env);
  return `pull request #${opened.number} on ${opened.headRefName} at ${opened.headRefOid.slice(0, 7)}`;
}

async function shippingStep({ record, issue, env }) {
  const step = latest(record, 'shipping');
  record.rounds.shipping += 1;
  saveRecord(record, env);
  await runSession({
    name: 'shipping',
    prompt: shippingPrompt({ card: record.card, issue, pull: record.pull, verifierModel: record.models.shipping }),
    cwd: record.worktree,
    model: record.models.shipping,
    effort: 'large',
    title: `${record.card} shipping`,
    log: step.log,
    timeoutMs: 90 * 60_000,
  });
  const pulled = ghJson(['pr', 'view', String(record.pull.number), '--json', 'headRefOid,headRefName,title,body,comments']);
  const verdict = shippingVerdict({
    pull: { head: { sha: pulled.headRefOid, ref: pulled.headRefName }, title: pulled.title, body: pulled.body },
    comments: (pulled.comments ?? []).map((comment, index) => ({ id: String(index), body: comment.body, createdAt: comment.createdAt })),
  });
  return { verdict, head: pulled.headRefOid };
}

async function previewStep({ record, env, log }) {
  const files = printed('gh', ['pr', 'diff', String(record.pull.number), '--name-only'])
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const kind = previewKind(files);
  if (kind === 'dashboard') return dashboardPreview({ worktree: record.worktree, card: record.card, log, env });
  const repo = ghJson(['repo', 'view', '--json', 'nameWithOwner']).nameWithOwner;
  const preview = await vercelPreview({ repo, sha: record.pull.headRefOid, log });
  appendFileSync(log, `preview ${preview.address}\n`);
  return preview;
}

async function smokeStep({ preview, worktree, log }) {
  const commands = smokeCommands({ kind: preview.kind, address: preview.address, worktree });
  for (const entry of commands) {
    appendFileSync(log, `\n$ ${entry.command} ${entry.args.join(' ')}\n`);
    await mustRun(entry.command, entry.args, { cwd: entry.cwd, log, timeoutMs: 45 * 60_000 }, entry.what);
  }
  return commands.map(entry => entry.what).join(', ');
}

async function uatStep({ record, issue, env, preview, log }) {
  const file = log.replace(/\.log$/, '.comment.md');
  writeFileSync(file, uatComment({ card: record.card, issue, preview }));
  await mustRun(process.execPath, [LINEAR_CLI, 'comment', record.card, '--file', file], { cwd: REPO_ROOT, log }, `Linear comment on ${record.card}`);
  await mustRun(process.execPath, [LINEAR_CLI, 'state', record.card, 'UAT'], { cwd: REPO_ROOT, log }, `moving ${record.card} to UAT`);
  await mustRun(process.execPath, [LINEAR_CLI, 'remind', record.card], { cwd: REPO_ROOT, log }, `reminding Todd about ${record.card}`);
  record.status = 'waiting';
  record.waitingFor = `Todd's yes on ${preview.kind === 'dashboard' ? preview.cardPage : preview.address}`;
  saveRecord(record, env);
  return record.waitingFor;
}

// ---------------------------------------------------------------------------
// the run

export function runFolderFor(card, env = process.env) {
  return join(runsFolder(env), runIdFor(card));
}

export function readDraft(env = process.env) {
  try {
    return JSON.parse(readFileSync(join(stateRoot(env), 'state', 'draft.json'), 'utf8'));
  } catch {
    return null;
  }
}

export function modelsFor(env = process.env) {
  const defaults = JSON.parse(readFileSync(join(DASHBOARD_ROOT, 'config', 'defaults.json'), 'utf8'));
  const draft = readDraft(env);
  return {
    builder: draft?.groups?.building?.model ?? defaults.mainSession,
    shipping: defaults.shipping,
    effort: draft?.effort ?? defaults.effort,
  };
}

export async function machine({ card, env = process.env, branch: wantedBranch, from = 'build', worktree = null }) {
  if (!STEPS.includes(from)) throw new Error(`--from must be one of ${STEPS.join(', ')}, not "${from}"`);
  const prior = readJsonRecord(recordFile(card, env)).value;
  if (prior && [...ACTIVE_RUN_STATUSES, 'waiting'].includes(prior.status)) {
    throw new Error(`${card} already has a run ${prior.status} since ${prior.startedAt}; finish or stop that one first (${recordFile(card, env)})`);
  }
  const issue = readIssue(card);
  const openPull = pullForCard(card);
  if (from !== 'build' && !openPull) throw new Error(`${card} has no open pull request, so there is nothing past the build to run`);
  const branch = wantedBranch ?? openPull?.headRefName ?? branchFor(card, issue.title);
  const record = newRunRecord({
    card,
    branch,
    worktree: worktree ? resolve(worktree) : join(env.JULIA_RUN_WORKTREES || join(stateRoot(env), 'worktrees'), runIdFor(card)),
    models: modelsFor(env),
    pull: openPull,
  });
  record.pickedUpAt = from;
  record.skipped = STEPS.slice(0, STEPS.indexOf(from));
  const held = worktreeHolding(branch);
  if (held) record.worktree = held;
  const folder = runFolderFor(card, env);
  mkdirSync(folder, { recursive: true });
  saveRecord(record, env);
  console.log(`${card}: started on ${branch}`);

  const note = message => {
    const file = join(folder, 'stop.md');
    writeFileSync(file, message);
    const posted = shell(process.execPath, [LINEAR_CLI, 'comment', card, '--file', file]);
    if (posted.status !== 0) console.error(`could not comment on ${card}: ${String(posted.stderr).trim()}`);
  };

  const step = async (name, work) => {
    const entry = stepEntry(name, join(folder, `${name}.log`));
    record.steps.push(entry);
    saveRecord(record, env);
    console.log(`${card}: ${name} started`);
    try {
      const detail = await work(entry);
      entry.status = 'done';
      entry.finishedAt = now();
      entry.detail = typeof detail === 'string' ? detail : String(detail?.summary ?? 'done');
      saveRecord(record, env);
      console.log(`${card}: ${name} done -- ${entry.detail}`);
      return detail;
    } catch (error) {
      entry.status = 'failed';
      entry.finishedAt = now();
      entry.detail = error.message;
      saveRecord(record, env);
      throw error;
    }
  };

  try {
    if (from === 'build') await step('build', () => buildStep({ record, issue, env }));
    let shipping = null;

    if (STEPS.indexOf(from) <= STEPS.indexOf('shipping')) {
      shipping = await step('shipping', () => shippingStep({ record, issue, env }));

      if (!passing(shipping.verdict)) {
        record.rounds.remediation += 1;
        saveRecord(record, env);
        await step('remediation', () => buildStep({ record, issue, env, name: 'remediation', verdict: shipping.verdict }));
        shipping = await step('shipping', () => shippingStep({ record, issue, env }));
        if (!passing(shipping.verdict)) {
          record.status = 'stopped';
          record.stoppedBecause = `Shipping failed twice on ${card}: ${shipping.verdict?.missing?.join('; ') ?? 'no verdict on the head'}`;
          saveRecord(record, env);
          console.error(`${card}: ${record.stoppedBecause}`);
          note(`Stopped: ${record.stoppedBecause}. Nothing merges. Next step is diagnosis: what the process got wrong and what would stop it coming back.`);
          return record;
        }
      }
    }

    record.pull = ghJson(['pr', 'view', String(record.pull.number), '--json', 'number,headRefName,headRefOid,title,body,url,state']);
    const preview = await step('preview', entry => previewStep({ record, env, log: entry.log }));
    record.preview = preview;
    saveRecord(record, env);

    await step('smoke', entry => smokeStep({ preview, worktree: record.worktree, log: entry.log }));
    await step('uat', entry => uatStep({ record, issue, env, preview, log: entry.log }));

    console.log(`${card}: waiting -- ${record.waitingFor}`);
    return record;
  } catch (error) {
    record.status = 'failed';
    record.stoppedBecause = error.message;
    saveRecord(record, env);
    console.error(`${card}: stopped at ${record.steps.at(-1)?.name ?? 'start'} -- ${error.message}`);
    note(`The run for ${card} stopped at ${record.steps.at(-1)?.name ?? 'start'}: ${error.message}`);
    return record;
  }
}

// ---------------------------------------------------------------------------

export function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!['--state', '--branch', '--from', '--worktree'].includes(arg)) throw new Error(`unknown flag "${arg}"`);
    const value = argv[index + 1];
    if (!value) throw new Error(`${arg} needs a value`);
    flags[arg.slice(2)] = value;
    index += 1;
  }
  return flags;
}

export async function main(argv = process.argv.slice(2)) {
  const [command, cardArg] = argv;
  if (command !== 'start' || !cardArg) {
    console.error('usage: run-card.mjs start <CARD> [--branch <name>] [--worktree <dir>] [--state <dir>] [--from <step>]');
    process.exitCode = 2;
    return;
  }
  const flags = parseFlags(argv.slice(2));
  const env = { ...process.env, ...(flags.state ? { DASHBOARD_STATE_DIR: flags.state } : {}) };
  const record = await machine({ card: normalizeCard(cardArg), env, branch: flags.branch, from: flags.from, worktree: flags.worktree });
  process.exitCode = record.status === 'waiting' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
