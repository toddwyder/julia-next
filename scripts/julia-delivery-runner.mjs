// The Windows delivery handoff for JUL-196.  It owns run files, never Linear
// mutations, publishing, UAT, or Factory.  Adapters keep the process boundary
// testable and make each worker's observed identity part of the durable record.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIssue } from './linear-cli.mjs';
import { git, runChecks, localTester } from './julia-minimal-runner-checks.mjs';
import { LIMITS, runLimited } from '../ops/julia-runner/time-limit.mjs';

const SHA = /^[0-9a-f]{40}$/i;
const MAX_ROUNDS = 3;

function refusal(card) {
  if (!card || card.identifier == null) return 'Linear did not return a card';
  if (card.identifier !== card.expectedId) return `Linear returned ${card.identifier}, not the requested card`;
  if (card.state?.name !== 'Ready') return `card is not authorized to start (state: ${card.state?.name ?? 'unknown'})`;
  if (!/^##\s+Acceptance criteria\s*$/mi.test(card.description ?? '')) return 'card has no approved acceptance criteria';
  return null;
}

function approvedInput(card, configuration) {
  return { issueId: card.identifier, title: card.title, description: card.description, configuration, readAt: new Date().toISOString() };
}

export function workerPrompt(role, card, configuration, runPath, approvedPath, findings = null) {
  const chosen = configuration[role];
  const common = `Issue: ${card.identifier}\nSaved run: ${runPath}\nApproved input: ${approvedPath}\nConfigured ${role}: ${JSON.stringify(chosen)}`;
  if (role === 'builder') return `${common}\n\nExplicitly read and follow .agents/skills/implement/SKILL.md for ${card.identifier}. The approved requirements are only in ${approvedPath}; do not reread Linear. Work only in the prepared isolated worktree.${findings ? `\n\nRepair these review findings:\n${findings}` : ''}`;
  return `${common}\n\nReview the candidate named in the saved handoff file only. You are independent of the builder and must not receive its conversation. End with exactly VERDICT: PASS or VERDICT: FAIL, and name the reviewed 40-character commit.`;
}

function validObserved(role, configured, observed) {
  if (!observed || observed.harness !== configured.harness || observed.model !== configured.model || observed.maker !== configured.maker) return `${role} observed identity does not match its saved configuration`;
  if (role === 'reviewer' && observed.maker.trim().toLowerCase() === configured.builderMaker?.trim().toLowerCase()) return 'reviewer maker matches builder maker';
  return null;
}

function reviewVerdict(text, commit) {
  const verdict = /^VERDICT:\s*(PASS|FAIL)\s*$/mi.exec(text ?? '')?.[1];
  if (!verdict) return { error: 'review output has no exact PASS/FAIL verdict' };
  if (verdict === 'PASS' && !new RegExp(`\\b${commit}\\b`, 'i').test(text)) return { error: 'PASS does not name the exact candidate commit' };
  return { verdict };
}

async function fileSave(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function park(reason, round = null) { return { outcome: 'park', reason, round }; }

// The JUL-122 time limiter owns the child process group; this adapter only
// maps the saved catalog harnesses to their unattended command lines.
export function productionLauncher(worktree) {
  return async (role, request) => {
    const configured = request.configuration;
    const command = configured.harness === 'claude-code' ? 'claude' : configured.harness === 'codex' ? 'codex' : null;
    const args = configured.harness === 'claude-code' ? ['-p', '--model', configured.model, request.prompt]
      : configured.harness === 'codex' ? ['exec', '-m', configured.model, '-s', 'read-only', '--skip-git-repo-check', '-'] : [];
    if (!command) return { exitCode: 2, observed: null, text: `unsupported harness ${configured.harness}` };
    let output = ''; let error = '';
    const result = await runLimited(command, args, { cwd: role === 'builder' ? worktree : undefined, stdio: ['pipe', 'pipe', 'pipe'] }, {
      seconds: LIMITS.builder.fallback,
      started: (child) => { child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { error += chunk; }); if (configured.harness === 'codex') child.stdin.end(request.prompt); },
    });
    const observed = /^OBSERVED:\s*(\{.*\})$/m.exec(output)?.[1];
    let identity = null; try { identity = observed && JSON.parse(observed); } catch { /* fail closed below */ }
    return { exitCode: result.stopped ? 124 : result.code ?? 1, observed: identity, text: output || error, outputPath: null, timedOut: result.stopped };
  };
}

export async function runDelivery({ issueId, configuration, runPath, approved = null }, { readCard, save = fileSave, launch, candidate, prepareWorktree = async () => ({ ok: true }) }) {
  const statePath = join(dirname(runPath), `${issueId}-state.json`);
  const finish = async (result) => { await save(statePath, { issueId, configuration, result, finishedAt: new Date().toISOString() }); return result; };
  // The single read is deliberately before any worktree or worker operation.
  const fetched = approved?.card ?? await readCard(issueId);
  const card = { ...fetched, expectedId: issueId };
  const invalid = refusal(card);
  if (invalid) return finish(park(invalid));
  const approvedPath = join(dirname(runPath), `${issueId}-approved.json`);
  if (!approved) await save(approvedPath, { card, configuration, ...approvedInput(card, configuration) });
  const prepared = await prepareWorktree({ issueId, configuration, runPath });
  if (!prepared?.ok) return finish(park(prepared?.reason ?? 'could not prepare isolated worktree'));
  let findings = null;
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const builder = await launch('builder', { prompt: workerPrompt('builder', card, configuration, runPath, approvedPath, findings), configuration: configuration.builder, round });
    const builderIdentity = validObserved('builder', configuration.builder, builder.observed);
    if (builder.exitCode !== 0 || builderIdentity) return finish(park(builderIdentity ?? `builder exited ${builder.exitCode}`, round));
    const current = await candidate({ round });
    if (!SHA.test(current?.commit ?? '') || !current.clean || !current.checks?.pass) return finish(park(!SHA.test(current?.commit ?? '') ? 'candidate has no immutable commit' : !current.clean ? 'candidate drifted or is dirty' : 'candidate checks failed', round));
    const handoffPath = join(dirname(runPath), `${issueId}-handoff-round-${round}.json`);
    const handoff = { issueId, round, approvedPath, candidate: current, builder: { configured: configuration.builder, observed: builder.observed, exitCode: builder.exitCode, outputPath: builder.outputPath ?? null }, createdAt: new Date().toISOString() };
    await save(handoffPath, handoff);
    const reviewerConfig = { ...configuration.reviewer, builderMaker: configuration.builder.maker };
    const reviewer = await launch('reviewer', { prompt: `${workerPrompt('reviewer', card, configuration, runPath, approvedPath)}\nHandoff: ${handoffPath}\nCandidate: ${current.commit}`, configuration: reviewerConfig, handoffPath, round });
    const reviewerIdentity = validObserved('reviewer', reviewerConfig, reviewer.observed);
    const verdict = reviewVerdict(reviewer.text, current.commit);
    const record = { ...handoff, reviewer: { configured: configuration.reviewer, observed: reviewer.observed, exitCode: reviewer.exitCode, outputPath: reviewer.outputPath ?? null, verdict: verdict.verdict ?? null }, result: verdict.error ?? verdict.verdict };
    await save(handoffPath, record);
    if (reviewer.exitCode !== 0 || reviewerIdentity || verdict.error) return finish(park(reviewerIdentity ?? verdict.error ?? `reviewer exited ${reviewer.exitCode}`, round));
    if (verdict.verdict === 'PASS') {
      const afterReview = await candidate({ round, afterReview: true });
      if (afterReview.commit !== current.commit || !afterReview.clean || !afterReview.checks?.pass) return finish(park('candidate changed after review', round));
      return finish({ outcome: 'pass', commit: current.commit, handoffPath });
    }
    findings = reviewer.text;
  }
  return finish(park('three builder/reviewer rounds did not produce a passing reviewed commit', MAX_ROUNDS));
}

// A thin production adapter. A Windows operator supplies a pre-created,
// isolated worktree; tests use injected adapters and do not start real workers.
export async function startDelivery(issueId, configuration, { runPath = join('.julia', 'runs', `${issueId}.json`), worktree = process.env.JULIA_DELIVERY_WORKTREE, readCard = (id) => getIssue(id, { apiKey: process.env.LINEAR_API_KEY }), launch } = {}) {
  const statePath = join(dirname(runPath), `${issueId}-state.json`);
  const state = async (result) => { await fileSave(statePath, { issueId, configuration, result, finishedAt: new Date().toISOString() }); return result; };
  if (!worktree) return state(park('JULIA_DELIVERY_WORKTREE is required; no worker was launched'));
  let approved = null;
  try { approved = JSON.parse(await readFile(join(dirname(runPath), `${issueId}-approved.json`), 'utf8')); } catch { /* a new run reads Linear below */ }
  launch ??= productionLauncher(worktree);
  const candidate = async () => {
    try {
      const commit = git(worktree, 'rev-parse', 'HEAD'); const clean = !git(worktree, 'status', '--porcelain');
      const branch = git(worktree, 'branch', '--show-current');
      const base = git(worktree, 'merge-base', 'HEAD', 'origin/main');
      const checks = await runChecks({ worktree, branch, base, test: localTester });
      return { commit, clean, checks };
    } catch (error) { return { commit: null, clean: false, checks: { pass: false, error: error.message } }; }
  };
  const prepareWorktree = async () => ({ ok: spawnSync('git', ['-C', worktree, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' }).stdout.trim() === 'true', reason: 'configured worktree is not a git worktree' });
  return runDelivery({ issueId, configuration, runPath, approved }, { readCard, launch, candidate, prepareWorktree });
}
