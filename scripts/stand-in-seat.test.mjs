// stand-in-seat.test.mjs -- JUL-98 step 8: the free stand-in seat, run for
// real against a throwaway git repo. It is the fake that the server-side
// stand-in test (scripts/controller-stand-in.mjs) leans on, so it is pinned
// here: which scenario does what, and that what it writes is what the
// controller reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { standIn, scenarioOf, progressLine, STAND_IN_FINDING, BUSY_SILENT_MS } from './stand-in-seat.mjs';
import { seatFiles } from './run-seat.mjs';
import { parseProgress, validateAnswer, cutOffOf } from '../graph/controller/seat-run.mjs';

const dirs = [];
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'stand-in-'));
  dirs.push(dir);
  const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  git('init', '-q');
  writeFileSync(join(dir, '.gitignore'), '.julia/\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  return { dir, head: () => execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), status: () => execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' }) };
}

function brief(dir, tag, text) {
  const files = seatFiles(dir, tag);
  mkdirSync(files.dir, { recursive: true });
  writeFileSync(files.brief, text);
  return files;
}

test('the scenario is one line of the brief, and an unknown one is refused', () => {
  assert.equal(scenarioOf('# x\n\nStand-in scenario: changes-then-pass\n'), 'changes-then-pass');
  assert.throws(() => scenarioOf('no scenario here'), /names no known stand-in scenario/);
  assert.throws(() => scenarioOf('Stand-in scenario: explode\n'), /names no known/);
});

test('a progress line is the old mailbox message shape, and the controller reads it back', () => {
  const line = progressLine({ type: 'status', subject: 'building', phase: 'red', at: '2026-09-23T05:00:00Z' });
  const parsed = JSON.parse(line);
  assert.deepEqual(Object.keys(parsed), ['type', 'subject', 'body', 'payload', 'created_at']);
  const read = parseProgress(line + line.replace('status', 'heartbeat'));
  assert.equal(read.entries.length, 2);
  assert.equal(read.lastStatus.phase, 'red');
});

test('pass: the builder commits and answers done; the reviewer changes nothing and approves; both report progress', async () => {
  const r = repo();
  const before = r.head();
  const b = brief(r.dir, 'round-1-builder', 'Stand-in scenario: pass\n');
  await standIn({ seat: 'builder', tag: 'round-1-builder', worktree: r.dir });
  const built = JSON.parse(readFileSync(b.answer, 'utf8'));
  assert.equal(validateAnswer('builder', built), null);
  assert.equal(built.outcome, 'done');
  assert.notEqual(r.head(), before, 'a new commit');
  assert.equal(r.status(), '', 'nothing uncommitted: .julia/ is ignored');
  assert.ok(parseProgress(readFileSync(b.progress, 'utf8')).entries.length >= 2);

  const head = r.head();
  const v = brief(r.dir, 'round-1-reviewer', 'Stand-in scenario: pass\n');
  await standIn({ seat: 'reviewer', tag: 'round-1-reviewer', worktree: r.dir });
  const verdict = JSON.parse(readFileSync(v.answer, 'utf8'));
  assert.equal(validateAnswer('reviewer', verdict), null);
  assert.equal(verdict.verdict, 'approve');
  assert.equal(r.head(), head);
  assert.equal(r.status(), '');
});

test('cut-off: the reviewer prints a reply stopped at "length" and writes NO answer, which the controller reads as cut off', async () => {
  const r = repo();
  const v = brief(r.dir, 'round-1-reviewer', 'Stand-in scenario: cut-off\n');
  const printed = [];
  const write = process.stdout.write;
  process.stdout.write = (chunk) => { printed.push(String(chunk)); return true; };
  try {
    await standIn({ seat: 'reviewer', tag: 'round-1-reviewer', worktree: r.dir });
  } finally {
    process.stdout.write = write;
  }
  assert.ok(!existsSync(v.answer), 'no verdict was written');
  assert.deepEqual(cutOffOf(printed.join('')), { stopReason: 'length', outputTokens: 16384, reasoningTokens: 16384 });
});

test('changes-then-pass: round 1 asks for changes; round 2 must be GIVEN that finding; then approves', async () => {
  const r = repo();
  brief(r.dir, 'round-1-builder', 'Stand-in scenario: changes-then-pass\n');
  await standIn({ seat: 'builder', tag: 'round-1-builder', worktree: r.dir });
  const v1 = brief(r.dir, 'round-1-reviewer', 'Stand-in scenario: changes-then-pass\n');
  await standIn({ seat: 'reviewer', tag: 'round-1-reviewer', worktree: r.dir });
  const first = JSON.parse(readFileSync(v1.answer, 'utf8'));
  assert.equal(first.verdict, 'changes_needed');
  assert.equal(first.findings, STAND_IN_FINDING);

  // A round-2 builder NOT handed the finding refuses -- this is what proves the
  // finding travels in the real route.
  const lost = brief(r.dir, 'round-2-builder', 'Stand-in scenario: changes-then-pass\n');
  await standIn({ seat: 'builder', tag: 'round-2-builder', worktree: r.dir });
  assert.equal(JSON.parse(readFileSync(lost.answer, 'utf8')).outcome, 'blocked');

  const b2 = brief(r.dir, 'round-2-builder', `Stand-in scenario: changes-then-pass\n\n## The review finding you are fixing\n\n${STAND_IN_FINDING}\n`);
  await standIn({ seat: 'builder', tag: 'round-2-builder', worktree: r.dir });
  assert.equal(JSON.parse(readFileSync(b2.answer, 'utf8')).outcome, 'done');
  assert.ok(existsSync(join(r.dir, 'stand-in', 'round-2-fix.txt')));
  const v2 = brief(r.dir, 'round-2-reviewer', 'Stand-in scenario: changes-then-pass\n');
  await standIn({ seat: 'reviewer', tag: 'round-2-reviewer', worktree: r.dir });
  assert.equal(JSON.parse(readFileSync(v2.answer, 'utf8')).verdict, 'approve');
});

test('busy-silent: each seat reports once, works without a progress line for longer than the stand-in stuck limit, then finishes normally', async () => {
  assert.ok(BUSY_SILENT_MS > 2 * 60 * 1000, 'longer than the 60 s stand-in stuck rule by more than two reads');
  const r = repo();
  const before = r.head();
  const b = brief(r.dir, 'round-1-builder', 'Stand-in scenario: busy-silent\n');
  const cpuBefore = process.cpuUsage();
  await standIn({ seat: 'builder', tag: 'round-1-builder', worktree: r.dir }, { busyMs: 400 });
  const cpu = process.cpuUsage(cpuBefore);
  assert.ok(cpu.user + cpu.system > 250 * 1000, 'the builder burned CPU while silent');
  assert.equal(JSON.parse(readFileSync(b.answer, 'utf8')).outcome, 'done');
  assert.notEqual(r.head(), before);

  const v = brief(r.dir, 'round-1-reviewer', 'Stand-in scenario: busy-silent\n');
  const written = [];
  const write = process.stdout.write;
  process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };
  try {
    await standIn({ seat: 'reviewer', tag: 'round-1-reviewer', worktree: r.dir }, { busyMs: 50 });
  } finally {
    process.stdout.write = write;
  }
  assert.ok(written.some((line) => line.includes('"message_update"')), 'the reviewer printed a Pi-shaped stream while silent');
  assert.equal(JSON.parse(readFileSync(v.answer, 'utf8')).verdict, 'approve');
  assert.equal(parseProgress(readFileSync(v.progress, 'utf8')).entries.length, 2, 'started + reviewing, and nothing while busy');
});

// The acceptance check (Todd, 23 Sep): the stand-in answers the criteria and
// UAT items its brief lists by id -- except in missing-evidence, where the
// builder leaves out the last UAT item and the check must refuse it.
const LISTS = '\n## Acceptance criteria, by id\n\n- AC1: The stand-in commit is on the branch.\n\n## UAT plan items, by id\n\n- UAT1: What changed\n- UAT2: The tests\n';

test('pass: the builder answers every criterion and UAT item by id, and the reviewer checks each criterion by name', async () => {
  const r = repo();
  const b = brief(r.dir, 'round-1-builder', `Stand-in scenario: pass\n${LISTS}`);
  await standIn({ seat: 'builder', tag: 'round-1-builder', worktree: r.dir });
  const built = JSON.parse(readFileSync(b.answer, 'utf8'));
  assert.deepEqual(built.acceptance.map((a) => [a.id, a.criterion]), [['AC1', 'The stand-in commit is on the branch.']]);
  assert.deepEqual(built.uat.map((u) => u.id), ['UAT1', 'UAT2']);
  const v = brief(r.dir, 'round-1-reviewer', `Stand-in scenario: pass\n${LISTS}`);
  await standIn({ seat: 'reviewer', tag: 'round-1-reviewer', worktree: r.dir });
  const reviewed = JSON.parse(readFileSync(v.answer, 'utf8'));
  assert.deepEqual(reviewed.criteria.map((c) => [c.id, c.verdict]), [['AC1', 'met']]);
});

test('missing-evidence: the builder leaves out the last UAT item, and the acceptance check refuses exactly that', async () => {
  const r = repo();
  const b = brief(r.dir, 'round-1-builder', `Stand-in scenario: missing-evidence\n${LISTS}`);
  await standIn({ seat: 'builder', tag: 'round-1-builder', worktree: r.dir });
  const built = JSON.parse(readFileSync(b.answer, 'utf8'));
  assert.deepEqual(built.uat.map((u) => u.id), ['UAT1']);
  const v = brief(r.dir, 'round-1-reviewer', `Stand-in scenario: missing-evidence\n${LISTS}`);
  await standIn({ seat: 'reviewer', tag: 'round-1-reviewer', worktree: r.dir });
  const reviewed = JSON.parse(readFileSync(v.answer, 'utf8'));
  const description = '**Acceptance criteria:**\n\n- [ ] The stand-in commit is on the branch.\n\n## UAT plan\n\n1. **What changed:** x\n2. **The tests:** y\n';
  const { checkEvidence } = await import('./acceptance-check.mjs');
  assert.deepEqual(checkEvidence({ description, builder: built, reviewer: reviewed }).missing, ['UAT2 ("The tests"): the UAT plan promises it and the builder wrote nothing for it']);
});
