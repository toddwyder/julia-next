#!/usr/bin/env node
// julia-minimal-runner.mjs -- a small, deterministic, fixed-route Julia
// refactoring runner. Todd gives it one Linear issue ID; it drives a fixed
// sequence (fetch -> Gemini implement+commit -> checks -> DeepSeek review ->
// at most one Gemini correction round -> done/blocked) and reports a
// reviewed candidate. It does not select issues, publish, deploy, or
// supervise itself with another model.
//
// Deliberately independent of the existing controller/graph/queue/publisher/
// seat-table/run-seat machinery (that machinery is for the always-on graph;
// this is the fixed-route exception for a laptop session, agreed with Todd).
// CLI model calls go straight to `agy` (Gemini CLI) and `pi` (DeepSeek, via
// the Command Code route) -- flags below are taken from `agy --help` and
// from ops/service-dropbox/run-pi-seat.mjs's own comments (read, not
// imported), not guessed.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getIssue } from './linear-cli.mjs';

export const STATE_DIR = '.julia-runner-state';
export const MAX_ATTEMPTS = 2;
export const MAX_DIFF_BYTES = 200_000;
export const REVIEW_AXES = ['spec', 'standards'];

export const DEFAULT_IMPLEMENT_SKILL_PATH =
  process.env.JULIA_RUNNER_IMPLEMENT_SKILL ?? 'C:\\Users\\toddw\\Documents\\Codex\\2026-09-23\\le\\work\\cc-implement-skill.md';
export const DEFAULT_TDD_SKILL_PATH =
  process.env.JULIA_RUNNER_TDD_SKILL ?? 'C:\\Users\\toddw\\.agents\\skills\\tdd\\SKILL.md';

// ---------------------------------------------------------------------------
// State file: one atomic JSON file per issue, in an ignored local directory.
// ---------------------------------------------------------------------------

export function stateFilePath(stateDir, issueId) {
  return join(stateDir, `${issueId}.json`);
}

export function loadState(stateDir, issueId) {
  const path = stateFilePath(stateDir, issueId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Write-to-temp-then-rename, so a crash mid-write never leaves a half-written
// (unparsable) state file behind for the next run to trip over.
export function saveStateAtomic(stateDir, issueId, state) {
  mkdirSync(stateDir, { recursive: true });
  const path = stateFilePath(stateDir, issueId);
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, path);
  return state;
}

export function initialState(issueId) {
  return {
    issue: issueId,
    phase: 'fetch',
    attempt: 1,
    branch: null,
    worktree: null,
    baseSha: null,
    candidateSha: null,
    checks: [],
    review: [],
    reason: null,
    updatedAt: null,
  };
}

// ---------------------------------------------------------------------------
// One run at a time. A stale lock (holder pid no longer alive) is reclaimed.
// ---------------------------------------------------------------------------

function lockFilePath(stateDir, issueId) {
  return join(stateDir, `${issueId}.lock`);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireLock(stateDir, issueId) {
  mkdirSync(stateDir, { recursive: true });
  const path = lockFilePath(stateDir, issueId);
  if (existsSync(path)) {
    const holder = Number(readFileSync(path, 'utf8').trim());
    if (Number.isInteger(holder) && pidAlive(holder)) {
      throw new Error(`julia-minimal-runner: issue ${issueId} is already being run (pid ${holder}); only one run at a time`);
    }
  }
  writeFileSync(path, String(process.pid));
  return path;
}

export function releaseLock(path) {
  try { unlinkSync(path); } catch { /* already gone */ }
}

// ---------------------------------------------------------------------------
// The state machine's reducer. Pure: given the current state and an outcome
// of the phase that just ran, returns the next state. This is the seam the
// tests exercise directly, with no process spawned.
// ---------------------------------------------------------------------------

export function advancePhase(state, outcome) {
  const at = () => new Date().toISOString();
  switch (state.phase) {
    case 'fetch':
      if (outcome.type === 'fetched') {
        return { ...state, phase: 'implement', branch: outcome.branch, worktree: outcome.worktree, baseSha: outcome.baseSha, updatedAt: at() };
      }
      if (outcome.type === 'fetchFailed') {
        return { ...state, phase: 'blocked', reason: outcome.reason, updatedAt: at() };
      }
      break;
    case 'implement':
      if (outcome.type === 'implemented') {
        return { ...state, phase: 'check', candidateSha: outcome.candidateSha, updatedAt: at() };
      }
      if (outcome.type === 'implementFailed') {
        return { ...state, phase: 'blocked', reason: outcome.reason, updatedAt: at() };
      }
      break;
    case 'check':
      if (outcome.type === 'checksPassed') {
        return { ...state, phase: 'review', checks: [...state.checks, outcome.result], updatedAt: at() };
      }
      if (outcome.type === 'checksFailed') {
        const checks = [...state.checks, outcome.result];
        if (state.attempt < MAX_ATTEMPTS) {
          return { ...state, phase: 'implement', attempt: state.attempt + 1, checks, reason: outcome.result.summary, updatedAt: at() };
        }
        return { ...state, phase: 'blocked', checks, reason: `checks still failing after ${state.attempt} attempts: ${outcome.result.summary}`, updatedAt: at() };
      }
      break;
    case 'review':
      if (outcome.type === 'reviewClean') {
        return { ...state, phase: 'done', review: [...state.review, outcome.result], updatedAt: at() };
      }
      if (outcome.type === 'reviewFindings') {
        const review = [...state.review, outcome.result];
        if (state.attempt < MAX_ATTEMPTS) {
          return { ...state, phase: 'implement', attempt: state.attempt + 1, review, reason: outcome.result.summary, updatedAt: at() };
        }
        return { ...state, phase: 'blocked', review, reason: `review still finds actionable issues after ${state.attempt} attempts: ${outcome.result.summary}`, updatedAt: at() };
      }
      if (outcome.type === 'reviewFailed') {
        return { ...state, phase: 'blocked', review: [...state.review, outcome.result], reason: outcome.reason, updatedAt: at() };
      }
      break;
    default:
      break;
  }
  throw new Error(`advancePhase: outcome ${JSON.stringify(outcome.type)} is not valid in phase ${JSON.stringify(state.phase)}`);
}

// ---------------------------------------------------------------------------
// Git helpers. Every call is an argument array, never shell interpolation.
// ---------------------------------------------------------------------------

export function runGit(args, { cwd, execImpl = spawnSync } = {}) {
  const result = execImpl('git', args, { cwd, encoding: 'utf8' });
  if (result.error) throw new Error(`git ${args.join(' ')} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${result.status}: ${(result.stderr || '').trim()}`);
  }
  return (result.stdout || '').trim();
}

export function branchNameFor(issueId) {
  return `runner/${issueId.toLowerCase()}`;
}

export function worktreePathFor(worktreeRoot, issueId) {
  return join(worktreeRoot, issueId.toLowerCase());
}

// Create the worktree the first time; resume it (unchanged) on later runs of
// the same issue. Returns the base SHA the branch forked from.
export function ensureWorktree({ repoRoot, worktreeRoot, issueId, execImpl }) {
  const branch = branchNameFor(issueId);
  const worktree = worktreePathFor(worktreeRoot, issueId);
  if (existsSync(worktree)) {
    const head = runGit(['rev-parse', 'HEAD'], { cwd: worktree, execImpl });
    return { branch, worktree, baseSha: head };
  }
  const baseSha = runGit(['rev-parse', 'HEAD'], { cwd: repoRoot, execImpl });
  mkdirSync(dirname(worktree), { recursive: true });
  runGit(['worktree', 'add', '-b', branch, worktree, baseSha], { cwd: repoRoot, execImpl });
  return { branch, worktree, baseSha };
}

// "Changed base" guard: the commit we started from must still be an ancestor
// of the worktree's HEAD. If it isn't, something rewrote history under us.
export function baseStillAnAncestor({ worktree, baseSha, execImpl }) {
  const result = execImpl('git', ['merge-base', '--is-ancestor', baseSha, 'HEAD'], { cwd: worktree, encoding: 'utf8' });
  return result.status === 0;
}

// ---------------------------------------------------------------------------
// Issue validation: fail clearly rather than guess at a missing TDD seam.
// ---------------------------------------------------------------------------

export function validateIssueForTdd(issue) {
  if (!issue) return { ok: false, reason: 'issue not found or ambiguous' };
  if (!issue.description || !issue.description.trim()) {
    return { ok: false, reason: `issue ${issue.identifier ?? ''} has no description, so there is no agreed public behavior/test seam to build from` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Prompts.
// ---------------------------------------------------------------------------

function readSkill(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`julia-minimal-runner: could not read skill file ${path}: ${error.message}`);
  }
}

export function buildImplementPrompt(issue, { implementSkillPath = DEFAULT_IMPLEMENT_SKILL_PATH, tddSkillPath = DEFAULT_TDD_SKILL_PATH, findings = [] } = {}) {
  const implementSkill = readSkill(implementSkillPath);
  const tddSkill = readSkill(tddSkillPath);
  const findingsSection = findings.length
    ? `\n\n## Correction round\n\nThe previous candidate failed review or checks. Fix these before anything else:\n\n${findings.map((f) => `- ${f}`).join('\n')}\n`
    : '';
  return [
    '# Implement skill',
    implementSkill,
    '# TDD skill',
    tddSkill,
    '# Issue',
    `${issue.identifier ?? issue.id}: ${issue.title ?? ''}`,
    issue.description ?? '',
    findingsSection,
    '\nCommit your work to the current branch when done, as the implement skill says.',
  ].join('\n\n');
}

export function buildReviewPrompt(axis, issue, diff) {
  if (axis === 'spec') {
    return [
      'Review the diff below against the originating issue. Report: (a) requirements missing or partial; ' +
        '(b) behaviour not asked for (scope creep); (c) requirements that look implemented but wrong. ' +
        'Quote the issue for each finding. Under 400 words.',
      'End your report with exactly one line: "VERDICT: CLEAN" if there are no actionable findings, or "VERDICT: FINDINGS" if there are.',
      `## Issue ${issue.identifier ?? issue.id}: ${issue.title ?? ''}`,
      issue.description ?? '',
      '## Diff',
      diff,
    ].join('\n\n');
  }
  return [
    'Review the diff below against this repo\'s documented standards (CLAUDE.md, AGENTS.md) and ordinary code-smell judgement ' +
      '(Fowler ch.3: mysterious names, duplication, feature envy, primitive obsession, speculative generality, and the like). ' +
      'Report hard standard violations separately from judgement calls. Under 400 words.',
    'End your report with exactly one line: "VERDICT: CLEAN" if there are no actionable findings, or "VERDICT: FINDINGS" if there are.',
    '## Diff',
    diff,
  ].join('\n\n');
}

// ---------------------------------------------------------------------------
// Model command specs. Flags verified against `agy --help` and against
// ops/service-dropbox/run-pi-seat.mjs's own comments (read, not imported).
// ---------------------------------------------------------------------------

export function agySpawnSpec(prompt) {
  return {
    command: 'agy',
    args: ['-p', prompt, '--dangerously-skip-permissions', '--output-format', 'json'],
  };
}

// Read-only: run from a scratch directory, never the worktree, so DeepSeek
// has nothing to edit even if it tried. The diff and issue are in the prompt.
export function piReviewSpawnSpec(prompt) {
  return {
    command: 'pi',
    args: ['--provider', 'commandcode', '--model', 'deepseek/deepseek-v4-pro', '-p', '--mode', 'json', '--', prompt],
  };
}

export function extractVerdict(output) {
  const match = /VERDICT:\s*(CLEAN|FINDINGS)/.exec(String(output));
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Checks: targeted (framework lint) then the full suite once, as the repo
// already runs it (`.github/workflows/ci.yml`). There is no typecheck
// command in this repo's package.json, so none is invented or run here.
// ---------------------------------------------------------------------------

export function runChecks({ worktree, execImpl }) {
  const targeted = execImpl('npm', ['run', 'lint:framework'], { cwd: worktree, encoding: 'utf8' });
  if (targeted.status !== 0) {
    return { pass: false, summary: `npm run lint:framework failed (exit ${targeted.status})`, targeted: targeted.stdout + targeted.stderr, suite: null };
  }
  const suite = execImpl('node', ['--test', 'scripts/*.test.mjs'], { cwd: worktree, encoding: 'utf8', shell: true });
  if (suite.status !== 0) {
    return { pass: false, summary: `node --test scripts/*.test.mjs failed (exit ${suite.status})`, targeted: targeted.stdout, suite: suite.stdout + suite.stderr };
  }
  return { pass: true, summary: 'lint:framework and full test suite passed', targeted: targeted.stdout, suite: suite.stdout };
}

// ---------------------------------------------------------------------------
// Orchestration. Each call performs at most one phase's external effect, then
// persists the resulting state, so resuming never repeats a completed effect.
// ---------------------------------------------------------------------------

async function stepFetch(state, deps) {
  const { fetchIssueImpl, repoRoot, worktreeRoot, execImpl } = deps;
  let issue;
  try {
    issue = await fetchIssueImpl(state.issue);
  } catch (error) {
    return advancePhase(state, { type: 'fetchFailed', reason: `could not fetch issue ${state.issue}: ${error.message}` });
  }
  const valid = validateIssueForTdd(issue);
  if (!valid.ok) return advancePhase(state, { type: 'fetchFailed', reason: valid.reason });
  const { branch, worktree, baseSha } = ensureWorktree({ repoRoot, worktreeRoot, issueId: state.issue, execImpl });
  deps.issueCache = issue;
  return advancePhase(state, { type: 'fetched', branch, worktree, baseSha });
}

function checkBaseUnchanged(state, execImpl) {
  if (!baseStillAnAncestor({ worktree: state.worktree, baseSha: state.baseSha, execImpl })) {
    throw new Error(`julia-minimal-runner: base commit ${state.baseSha} is no longer an ancestor of ${state.worktree}'s HEAD -- the base changed under this run`);
  }
}

async function stepImplement(state, deps) {
  const { execImpl, spawnImpl, issueCache, fetchIssueImpl } = deps;
  checkBaseUnchanged(state, execImpl);
  const issue = issueCache ?? await fetchIssueImpl(state.issue);
  const findings = [...state.checks, ...state.review].map((r) => r.summary).filter(Boolean);
  const prompt = buildImplementPrompt(issue, { findings: state.attempt > 1 ? findings : [] });
  const spec = agySpawnSpec(prompt);
  const before = runGit(['rev-parse', 'HEAD'], { cwd: state.worktree, execImpl });
  const result = spawnImpl(spec.command, spec.args, { cwd: state.worktree, encoding: 'utf8' });
  if (result.error) return advancePhase(state, { type: 'implementFailed', reason: `agy failed to start: ${result.error.message}` });
  if (result.status !== 0) return advancePhase(state, { type: 'implementFailed', reason: `agy exited ${result.status}: ${(result.stderr || '').slice(-500)}` });
  const after = runGit(['rev-parse', 'HEAD'], { cwd: state.worktree, execImpl });
  if (after === before) return advancePhase(state, { type: 'implementFailed', reason: 'agy finished but left no new commit' });
  return advancePhase(state, { type: 'implemented', candidateSha: after });
}

async function stepCheck(state, deps) {
  const { execImpl } = deps;
  checkBaseUnchanged(state, execImpl);
  const result = runChecks({ worktree: state.worktree, execImpl });
  return advancePhase(state, { type: result.pass ? 'checksPassed' : 'checksFailed', result });
}

async function stepReview(state, deps) {
  const { execImpl, spawnImpl, issueCache, fetchIssueImpl, maxDiffBytes = MAX_DIFF_BYTES } = deps;
  checkBaseUnchanged(state, execImpl);
  const issue = issueCache ?? await fetchIssueImpl(state.issue);
  let diff;
  try {
    diff = runGit(['diff', `${state.baseSha}...${state.candidateSha}`], { cwd: state.worktree, execImpl });
  } catch (error) {
    return advancePhase(state, { type: 'reviewFailed', result: { axes: {} }, reason: `could not read the pinned diff: ${error.message}` });
  }
  if (diff.length > maxDiffBytes) diff = `${diff.slice(0, maxDiffBytes)}\n...[diff truncated at ${maxDiffBytes} bytes]`;

  const axes = {};
  for (const axis of REVIEW_AXES) {
    const prompt = buildReviewPrompt(axis, issue, diff);
    const spec = piReviewSpawnSpec(prompt);
    const result = spawnImpl(spec.command, spec.args, { cwd: tmpdir(), encoding: 'utf8' });
    if (result.error) {
      return advancePhase(state, { type: 'reviewFailed', result: { axes }, reason: `DeepSeek (${axis}) failed to start: ${result.error.message}` });
    }
    if (result.status !== 0) {
      return advancePhase(state, { type: 'reviewFailed', result: { axes }, reason: `DeepSeek (${axis}) exited ${result.status}: ${(result.stderr || '').slice(-500)}` });
    }
    const output = result.stdout || '';
    const verdict = extractVerdict(output);
    if (!verdict) {
      return advancePhase(state, { type: 'reviewFailed', result: { axes }, reason: `DeepSeek (${axis}) gave no VERDICT line` });
    }
    axes[axis] = { verdict, output };
  }
  const findingAxes = Object.entries(axes).filter(([, v]) => v.verdict === 'FINDINGS').map(([axis]) => axis);
  const result = { axes, summary: findingAxes.length ? `actionable findings on: ${findingAxes.join(', ')}` : 'clean on both axes' };
  return advancePhase(state, { type: findingAxes.length ? 'reviewFindings' : 'reviewClean', result });
}

const STEPS = { fetch: stepFetch, implement: stepImplement, check: stepCheck, review: stepReview };

export function summarize(state) {
  return {
    issue: state.issue,
    branch: state.branch,
    candidateSha: state.candidateSha,
    phase: state.phase,
    attempt: state.attempt,
    checks: state.checks,
    review: state.review,
    reason: state.reason,
    nextAction: state.phase === 'done'
      ? 'reviewed candidate ready; PR creation is a separate manual follow-up'
      : state.phase === 'blocked'
        ? `blocked: ${state.reason}`
        : `resume with the same issue ID to continue from phase ${state.phase}`,
  };
}

export async function runIssue(issueId, opts = {}) {
  const stateDir = opts.stateDir ?? STATE_DIR;
  const repoRoot = opts.repoRoot ?? process.cwd();
  const worktreeRoot = opts.worktreeRoot ?? join(stateDir, 'worktrees');
  const execImpl = opts.execImpl ?? spawnSync;
  const spawnImpl = opts.spawnImpl ?? spawnSync;
  const fetchIssueImpl = opts.fetchIssueImpl ?? ((id) => getIssue(id, { apiKey: process.env.LINEAR_API_KEY }));
  const maxDiffBytes = opts.maxDiffBytes ?? MAX_DIFF_BYTES;

  const lock = acquireLock(stateDir, issueId);
  try {
    let state = loadState(stateDir, issueId) ?? initialState(issueId);
    const deps = { fetchIssueImpl, repoRoot, worktreeRoot, execImpl, spawnImpl, maxDiffBytes, issueCache: null };
    while (state.phase !== 'done' && state.phase !== 'blocked') {
      const step = STEPS[state.phase];
      if (!step) throw new Error(`julia-minimal-runner: no handler for phase ${JSON.stringify(state.phase)}`);
      state = await step(state, deps);
      saveStateAtomic(stateDir, issueId, state);
    }
    return summarize(state);
  } finally {
    releaseLock(lock);
  }
}

// ---------------------------------------------------------------------------
// CLI entry.
// ---------------------------------------------------------------------------

function preflight() {
  const problems = [];
  for (const command of ['git', 'agy', 'pi', 'npm', 'node']) {
    const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
    if (result.error) problems.push(`${command}: not runnable here (${result.error.message})`);
  }
  return problems;
}

async function main() {
  const issueId = process.argv[2];
  if (!issueId) {
    console.error('usage: node scripts/julia-minimal-runner.mjs <LINEAR-ISSUE-ID>');
    process.exitCode = 2;
    return;
  }
  const problems = preflight();
  if (problems.length) {
    console.error(`julia-minimal-runner: missing prerequisites:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exitCode = 3;
    return;
  }
  try {
    const result = await runIssue(issueId);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.phase === 'blocked' ? 1 : 0;
  } catch (error) {
    console.error(`julia-minimal-runner: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
