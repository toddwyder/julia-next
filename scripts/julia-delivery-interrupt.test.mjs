// julia-delivery-interrupt.test.mjs -- the real-worker interruption proof for
// the delivery runner (JUL-196 step 7). Each scenario starts a real runner
// process, kills it while a real worker is active (installed Claude Code, or
// the real codex reviewer), starts a new runner on the same run files, and
// checks what the restart did.
//
// It is part of the ordinary regression run on Windows, where the delivery
// route runs. A scenario is skipped only when the platform or an installed
// worker it needs is missing, and the skip says which.
//
//   node --test --test-reporter=spec scripts/julia-delivery-interrupt.test.mjs
//
// Optional environment:
//   JUL196_PROOF_EVIDENCE_DIR    save each scenario's review-safe evidence file
//                                (real-proof-<scenario>.json) in this directory
//                                and keep the scenario's disposable directory,
//                                which the evidence names. Unset, the evidence
//                                stays in the disposable directory, and that is
//                                removed when the scenario passes.
//   JUL196_PROOF_BUILDER_MODEL   default claude-opus-5-5: the exact id Claude
//                                Code reports for the saved `opus` builder. The
//                                runner parks a builder whose observed model is
//                                not its configured one. Effort is the saved `high`.
//   JUL196_PROOF_REVIEWER_MODEL  default gpt-6.1-sol, the exact OpenAI model id.
//   JUL196_PROOF_KILL_AFTER_MS   default 1000: how long the worker has been
//                                recorded as running when its runner is killed.
//
// Everything a scenario changes is in a new directory under the system temp
// folder: a disposable git repository and its own run files. Two things are
// stand-ins, and the evidence labels both: the candidate step is a disposable
// snapshot and content check (not the JUL-122 checks), and the build and
// repair scenarios script the reviewer's verdict to drive the recovery (a
// scripted verdict is not a review). The review scenario starts the real
// codex reviewer.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { processStarted, saveJson, sha256 } from './julia-delivery-state.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const evidenceDir = process.env.JUL196_PROOF_EVIDENCE_DIR ? resolve(process.env.JUL196_PROOF_EVIDENCE_DIR) : null;
const builderModel = process.env.JUL196_PROOF_BUILDER_MODEL ?? 'claude-opus-5-5';
const reviewerModel = process.env.JUL196_PROOF_REVIEWER_MODEL ?? 'gpt-6.1-sol';
const killAfterMs = Number(process.env.JUL196_PROOF_KILL_AFTER_MS ?? 1000);
const wait = (ms) => new Promise((done) => { setTimeout(done, ms); });
const { NODE_TEST_CONTEXT: _context, ...env } = process.env;

// Why a scenario cannot run here, or false. Any command of that name on PATH
// counts as installed: a worker that is there but cannot be started is a
// failure of the scenario, never a skip.
const installed = (name) => spawnSync('where.exe', [name], { stdio: 'ignore', windowsHide: true }).status === 0;
function missing(...workers) {
  if (process.platform !== 'win32') return `the delivery route and its real workers are on Windows; this is ${process.platform}`;
  const absent = workers.filter((worker) => !installed(worker));
  return absent.length ? `not installed on this machine: ${absent.join(', ')}` : false;
}

const native = { route: 'native', provider: null, endpoint: null, protocol: null, authReference: null };
// A scenario whose verdicts are scripted does not name a real reviewer model.
const configurationFor = (realReviewer) => ({
  builder: { identity: 'anthropic-builder', model: builderModel, maker: 'Anthropic', harness: 'claude-code', thinking: 'high', connection: native },
  reviewer: { identity: 'openai-reviewer', model: realReviewer ? reviewerModel : 'scripted-stand-in', maker: 'OpenAI', harness: 'codex', thinking: null, connection: native },
});
const description = [
  'This is a disposable recovery proof, not product work. Do exactly this and nothing else:',
  'make sure the file proof.txt at the top of the worktree has `JUL-196 recovery proof` as its first line.',
  'If you were given review findings, apply exactly what they ask to proof.txt.',
  'Do not run tests, do not review, do not commit, and do not touch any other file.',
  '',
  '## Acceptance criteria',
  '',
  '- [ ] proof.txt has `JUL-196 recovery proof` as its first line.',
].join('\n');
const card = { identifier: 'JUL-196', title: 'Recovery proof (disposable)', state: { name: 'Ready', type: 'unstarted' }, description };

async function prepare(name, plan) {
  const proofDir = await mkdtemp(join(tmpdir(), `jul196-real-proof-${name}-`));
  const worktree = join(proofDir, 'worktree');
  const configuration = configurationFor(Boolean(plan.realReviewer));
  await mkdir(join(worktree, '.agents', 'skills', 'implement'), { recursive: true });
  await copyFile(resolve(here, '../.agents/skills/implement/SKILL.md'), join(worktree, '.agents', 'skills', 'implement', 'SKILL.md'));
  const git = (...args) => { const result = spawnSync('git', ['-C', worktree, ...args], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
  spawnSync('git', ['init', '-q', '-b', 'work', worktree], { encoding: 'utf8' });
  git('add', '-A'); git('-c', 'user.name=jul196-proof', '-c', 'user.email=proof@example.invalid', 'commit', '-q', '-m', 'start');
  const approvedPath = join(proofDir, 'runs', 'JUL-196-approved.json');
  await saveJson(approvedPath, { card, configuration, issueId: 'JUL-196', savedBy: 'julia-delivery-interrupt.test.mjs (no Linear read)' });
  await saveJson(join(proofDir, 'plan.json'), { issueId: 'JUL-196', worktree, configuration, checkWhen: '^JUL-196 recovery proof', ...plan });
  return { proofDir, worktree, configuration, git, statePath: join(proofDir, 'runs', 'JUL-196-state.json'), approvedHash: sha256(await readFile(approvedPath, 'utf8')), approvedPath };
}

function startRunner(proofDir) {
  const child = spawn(process.execPath, [join(here, 'julia-delivery-interrupt-runner.mjs'), proofDir], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = ''; let err = '';
  child.stdout.on('data', (chunk) => { out += chunk; }); child.stderr.on('data', (chunk) => { err += chunk; });
  const exited = new Promise((done) => { child.on('exit', (code, signal) => done({ code, signal })); });
  return { child, exited, result: () => { const line = /^RESULT (.*)$/m.exec(out)?.[1]; return line ? JSON.parse(line) : null; }, stderr: () => err.slice(-2000) };
}

const readState = async (statePath) => { try { return JSON.parse(await readFile(statePath, 'utf8')); } catch { return null; } };
// Review-safe view of the journal: no worker output, only what was done and by which process.
const journal = (state) => state.actions.map(({ key, role, attempt, status, startedAt, finishedAt, interruptedAt, handling, worker, outcome }) => ({ key, role, attempt, status, startedAt, finishedAt, interruptedAt, handling, worker, exitCode: outcome?.exitCode, observed: outcome?.observed, commit: outcome?.commit }));

// Kill the runner while the worker of `key` is active, then run a new runner to the end.
async function interruptAndResume(t, name, key, plan) {
  const proof = await prepare(name, plan);
  const runners = []; let finished = false;
  t.after(async () => {
    // Only the runner processes this scenario started itself are ever stopped here.
    for (const { child } of runners) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    // Removing the disposable directory is housekeeping: a directory that will not go is reported, and the proof's result stands.
    const removed = finished && !evidenceDir && await rm(proof.proofDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).then(() => true, () => false);
    if (!removed) t.diagnostic(`run files and worker evidence kept in ${proof.proofDir}`);
  });
  const runner = () => { const started = startRunner(proof.proofDir); runners.push(started); return started; };
  const first = runner();
  let open = null;
  const deadline = Date.now() + 10 * 60 * 1000;
  while (!open && Date.now() < deadline) {
    const state = await readState(proof.statePath);
    open = state?.actions.find((action) => action.key === key && action.status === 'started' && action.worker) ?? null;
    if (state?.result) break;
    if (!open) await wait(500);
  }
  assert.ok(open, `the run reached ${key} with a recorded worker (${first.stderr()})`);
  await wait(killAfterMs);
  const workerActiveAtKill = processStarted(open.worker.pid) === open.worker.started;
  assert.ok(workerActiveAtKill, `the real ${open.role} (process ${open.worker.pid}) was still working when its runner was killed`);
  const killedAt = new Date().toISOString();
  first.child.kill('SIGKILL');
  await first.exited;
  await wait(3000);
  const workerAfterKill = processStarted(open.worker.pid) === open.worker.started ? 'still running without a runner' : 'ended with its runner';
  const partialChanges = proof.git('status', '--porcelain').split('\n').filter(Boolean);
  const interrupted = await readState(proof.statePath);
  const second = runner();
  const exit = await second.exited;
  const state = await readState(proof.statePath);
  const result = second.result();
  const evidence = {
    scenario: name, test: 'scripts/julia-delivery-interrupt.test.mjs', interruptedAction: key, configuration: proof.configuration, killedAt, killAfterMs, workerActiveAtKill, workerAfterKill, partialChangesAtRestart: partialChanges,
    secondRunnerExit: exit, result, restarts: state?.restarts, repairsUsed: state?.repairsUsed, stage: state?.stage,
    approvedInputUnchanged: sha256(await readFile(proof.approvedPath, 'utf8')) === proof.approvedHash && state?.approved.sha256 === proof.approvedHash,
    worktree: state?.worktree, findingsBeforeRestart: interrupted?.findings ?? [], findingsAfter: state?.findings ?? [],
    actions: state ? journal(state) : null, proofTxt: await readFile(join(proof.worktree, 'proof.txt'), 'utf8').catch(() => null),
    reviewer: plan.realReviewer ? 'real codex reviewer' : 'scripted stand-in (not a review)', candidate: 'disposable snapshot and content check (not the JUL-122 checks)',
    proofDir: proof.proofDir, savedAt: new Date().toISOString(),
  };
  await saveJson(join(evidenceDir ?? proof.proofDir, `real-proof-${name}.json`), evidence);
  assert.ok(result, `the second runner reported a result (${second.stderr()})`);
  assert.deepEqual(state.result, result, 'the reported result is the one saved in the run record');
  t.diagnostic(`${name}: ${result.outcome}${result.reason ? ` (${result.reason})` : ''}; repairs used ${state.repairsUsed}; worker ${workerAfterKill}`);
  return { evidence, state, interrupted, passed: () => { finished = true; } };
}

const oneWorkerAtATime = (state) => {
  const stopped = state.actions.find((action) => action.status === 'interrupted');
  const next = state.actions[state.actions.indexOf(stopped) + 1];
  assert.match(stopped.handling, /had already exited|was stopped/, 'the old worker was proved gone');
  assert.ok(Date.parse(next.startedAt) >= Date.parse(stopped.interruptedAt), 'the next worker started only after the old one was settled');
  if (next.worker) assert.notDeepEqual(next.worker, stopped.worker, 'the next worker is a different process');
};

test('real Claude builder: the runner is killed during the initial build and a new runner finishes the run', { skip: missing('claude'), timeout: 20 * 60 * 1000 }, async (t) => {
  const { evidence, state, passed } = await interruptAndResume(t, 'build', 'build:0', { passWhen: '^JUL-196 recovery proof', finding: 'proof.txt must start with the line JUL-196 recovery proof.' });
  assert.equal(evidence.approvedInputUnchanged, true);
  assert.deepEqual([state.restarts, state.repairsUsed, state.actions[0].status], [1, 1, 'interrupted']);
  oneWorkerAtATime(state);
  assert.equal(evidence.result.outcome, 'pass', JSON.stringify(evidence.result));
  passed();
});

test('real Claude builder: the runner is killed during a repair; findings and the repair count survive', { skip: missing('claude'), timeout: 30 * 60 * 1000 }, async (t) => {
  const finding = 'Finding: proof.txt needs a second line that says exactly `repaired`.';
  const { evidence, state, interrupted, passed } = await interruptAndResume(t, 'repair', 'build:1', { passWhen: '^JUL-196 recovery proof\\r?\\nrepaired', finding });
  assert.equal(evidence.approvedInputUnchanged, true);
  assert.deepEqual(interrupted.findings.map(({ round }) => round), [0]);
  assert.deepEqual(state.findings[0], interrupted.findings[0], 'the finding saved before the restart is the one repaired after it');
  assert.equal(state.repairsUsed, 2, 'the interrupted repair was spent, and one more finished the work');
  assert.equal(state.actions.filter((action) => action.key === 'build:0').length, 1, 'the finished initial build was not run again');
  oneWorkerAtATime(state);
  assert.equal(evidence.result.outcome, 'pass', JSON.stringify(evidence.result));
  passed();
});

test('real codex reviewer: the runner is killed during review and the review is run again without rebuilding', { skip: missing('claude', 'codex'), timeout: 30 * 60 * 1000 }, async (t) => {
  const { evidence, state, passed } = await interruptAndResume(t, 'review', 'review:0', { realReviewer: true });
  assert.equal(evidence.approvedInputUnchanged, true);
  assert.equal(state.actions.filter((action) => action.kind === 'build').length, 1, 'the finished build was not run again');
  assert.deepEqual(state.actions.filter((action) => action.key === 'review:0').map(({ attempt, status }) => [attempt, status]), [[1, 'interrupted'], [2, 'done']]);
  oneWorkerAtATime(state);
  // The run's outcome is recorded and printed, not asserted: whether the real reviewer's identity and verdict are accepted is outside step 7.
  passed();
});
