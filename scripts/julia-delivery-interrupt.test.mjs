// JUL-196 interruption regression: kill actual runner processes while an OS
// child is active, then restart on the same run files. Reviewers are ALWAYS
// deterministic process fixtures, never paid providers. Claude builder cases
// retain real integration coverage with an explicit quota-blocked skip. Native
// Codex builder coverage requires explicit operator opt-in; never a real reviewer.
//
// Deterministic cases join ordinary regression. Real builder cases require
// explicit operator opt-in; Claude also honors quota blocking.
//
//   node --test --test-reporter=spec scripts/julia-delivery-interrupt.test.mjs
//
// Optional environment:
//   JUL196_CLAUDE_REAL_PROOF=1   OPERATOR ONLY: enable real Claude integration.
//   JUL196_CODEX_REAL_PROOF=1    OPERATOR ONLY: enable the real gpt-6.1-sol / high
//                                initial-build interruption and recovery proof.
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
//   JUL196_PROOF_KILL_AFTER_MS   default 1000: how long the worker has been
//                                recorded as running when its runner is killed.
//
// Everything a scenario changes is in a new directory under the system temp
// folder: a disposable git repository and its own run files. Two things are
// stand-ins, and the evidence labels both: the candidate step is a disposable
// snapshot and content check (not the JUL-122 checks), and the build and
// repair scenarios script the reviewer's verdict to drive the recovery (a
// scripted verdict is not a review). No scenario starts a real reviewer.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { processStarted, saveJson, sha256, stopProcessTree } from './julia-delivery-state.mjs';
import { nativeBuilderEvidence } from './julia-delivery-proof-evidence.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const evidenceDir = process.env.JUL196_PROOF_EVIDENCE_DIR ? resolve(process.env.JUL196_PROOF_EVIDENCE_DIR) : null;
const builderModel = process.env.JUL196_PROOF_BUILDER_MODEL ?? 'claude-opus-5-5';
const killAfterMs = Number(process.env.JUL196_PROOF_KILL_AFTER_MS ?? 1000);
const wait = (ms) => new Promise((done) => { setTimeout(done, ms); });
const { NODE_TEST_CONTEXT: _context, ...env } = process.env;

// Why a scenario cannot run here, or false. Any command of that name on PATH
// counts as installed: a worker that is there but cannot be started is a
// failure of the scenario, never a skip.
const installed = (name) => spawnSync('where.exe', [name], { stdio: 'ignore', windowsHide: true }).status === 0;
function missing(...workers) {
  if (workers.includes('claude') && process.env.JUL196_CLAUDE_REAL_PROOF !== '1') return 'operator opt-in required: JUL196_CLAUDE_REAL_PROOF=1; no provider call in ordinary suite';
  if (process.env.JUL196_CLAUDE_QUOTA_BLOCKED === '1' && workers.includes('claude')) return 'Claude real integration quota-blocked: JUL196_CLAUDE_QUOTA_BLOCKED=1; historical results retained';
  if (process.platform !== 'win32') return `the delivery route and its real workers are on Windows; this is ${process.platform}`;
  const absent = workers.filter((worker) => !installed(worker));
  return absent.length ? `not installed on this machine: ${absent.join(', ')}` : false;
}

const native = { route: 'native', provider: null, endpoint: null, protocol: null, authReference: null };
// A scenario whose verdicts are scripted does not name a real reviewer model.
const configurationFor = (plan) => ({
  builder: plan.realCodexBuilder
    ? { identity: 'openai-builder', model: 'gpt-6.1-sol', maker: 'OpenAI', harness: 'codex', thinking: 'high', connection: { ...native, provider: 'openai' } }
    : { identity: 'anthropic-builder', model: builderModel, maker: 'Anthropic', harness: 'claude-code', thinking: 'high', connection: native },
  reviewer: { identity: 'fixture-reviewer', model: 'scripted-stand-in', maker: 'Fixture', harness: 'fixture', thinking: null, connection: native },
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
  const configuration = configurationFor(plan);
  await mkdir(join(worktree, '.agents', 'skills', 'implement'), { recursive: true });
  // The tracked skill supplies the fixture's canonical worker path. A clean
  // checkout has no machine-local .agents alias (the historical proof did).
  await copyFile(resolve(here, '../.claude/skills/implement/SKILL.md'), join(worktree, '.agents', 'skills', 'implement', 'SKILL.md'));
  const git = (...args) => { const result = spawnSync('git', ['-C', worktree, ...args], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
  spawnSync('git', ['init', '-q', '-b', 'work', worktree], { encoding: 'utf8' });
  git('add', '-A'); git('-c', 'user.name=jul196-proof', '-c', 'user.email=proof@example.invalid', 'commit', '-q', '-m', 'start');
  const approvedPath = join(proofDir, 'runs', 'JUL-196-approved.json');
  const marker = `partial ${randomUUID()}`;
  const proofCard = plan.realCodexBuilder ? { ...card, description: [
    'Disposable native Codex recovery proof. Read this SAVED approved input and the canonical .agents/skills/implement/SKILL.md using a local terminal command that prints their full contents before writing anything.',
    'These bounded instructions override the skill: do not commit, review, run tests, use network/MCP/Linear, or change any file except proof.txt.',
    `If the runner says the previous builder was interrupted: read existing proof.txt, preserve its two lines byte-for-byte, append exactly recovered on a third line, and finish. Do not sleep during recovery.`,
    `Otherwise use a local Node command to write exactly ${JSON.stringify(`JUL-196 recovery proof\n${marker}\n`)} to proof.txt, then keep that SAME command running with setTimeout(()=>{},300000). Do not finish or shorten this wait: the parent will interrupt your runner while you are working.`,
    '## Acceptance criteria',
    `- [ ] proof.txt preserves its first line JUL-196 recovery proof and second line ${marker}; recovery appends recovered on a third line.`,
  ].join('\n') } : card;
  await saveJson(approvedPath, { card: proofCard, configuration, issueId: 'JUL-196', savedBy: 'julia-delivery-interrupt.test.mjs (no Linear read)' });
  await saveJson(join(proofDir, 'plan.json'), { issueId: 'JUL-196', worktree, configuration, checkWhen: '^JUL-196 recovery proof', ...plan });
  return { proofDir, worktree, configuration, git, marker, statePath: join(proofDir, 'runs', 'JUL-196-state.json'), approvedHash: sha256(await readFile(approvedPath, 'utf8')), approvedPath };
}

function startRunner(proofDir) {
  const child = spawn(process.execPath, [join(here, 'julia-delivery-interrupt-runner.mjs'), proofDir], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = ''; let err = '';
  child.stdout.on('data', (chunk) => { out += chunk; }); child.stderr.on('data', (chunk) => { err += chunk; });
  const exited = new Promise((done) => { child.on('exit', (code, signal) => done({ code, signal })); });
  return { child, exited, fixtures: () => [...out.matchAll(/^FIXTURE (.*)$/gm)].map(match => JSON.parse(match[1])), result: () => { const line = /^RESULT (.*)$/m.exec(out)?.[1]; return line ? JSON.parse(line) : null; }, stderr: () => err.slice(-2000) };
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
    const state = await readState(proof.statePath);
    for (const action of state?.actions ?? []) {
      if (action.worker && processStarted(action.worker.pid) === action.worker.started) stopProcessTree(action.worker.pid);
    }
    // Removing the disposable directory is housekeeping: a directory that will not go is reported, and the proof's result stands.
    const removed = finished && !evidenceDir && await rm(proof.proofDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).then(() => true, () => false);
    if (!removed) t.diagnostic(`run files and worker evidence kept in ${proof.proofDir}`);
  });
  const runner = () => { const started = startRunner(proof.proofDir); runners.push(started); return started; };
  const first = runner();
  let open = null; let partialAtKill = null; let nativeAtKill = [];
  const deadline = Date.now() + (plan.processFixture ? 30000 : 10 * 60 * 1000);
  while (!open && Date.now() < deadline) {
    const state = await readState(proof.statePath);
    open = state?.actions.find((action) => action.key === key && action.status === 'started' && action.worker) ?? null;
    if (open && plan.realCodexBuilder) {
      partialAtKill = await readFile(join(proof.worktree, 'proof.txt'), 'utf8').catch(() => null);
      nativeAtKill = await nativeBuilderEvidence(proof);
      if (partialAtKill !== `JUL-196 recovery proof\n${proof.marker}\n` || !nativeAtKill.some(session => session.canonicalSavedRead && session.noLinearCalls && session.provider === 'openai' && session.models.length === 1 && session.models[0] === 'gpt-6.1-sol' && session.efforts.length === 1 && session.efforts[0] === 'high')) open = null;
    }
    if (state?.result) break;
    if (first.child.exitCode !== null || first.child.signalCode !== null) break;
    if (!open) await wait(500);
  }
  if (!open && plan.realCodexBuilder) {
    const reason = 'native Codex did not reach a live recorded worker with the exact partial file, actual canonical/saved-input reads, and OpenAI gpt-6.1-sol/high metadata; interruption was not proved and no recovery was launched';
    await saveJson(join(evidenceDir ?? proof.proofDir, `real-proof-${name}-refusal.json`), { scenario: name, reason, partialAtKill, nativeAtKill, runnerExitCode: first.child.exitCode, runnerSignal: first.child.signalCode, stderr: first.stderr(), proofDir: proof.proofDir, reviewer: 'deterministic fixture; no live reviewer' });
  }
  assert.ok(open, `${plan.realCodexBuilder ? 'native partial-work and session-evidence checkpoint was not reached; no interruption proof' : `the run reached ${key} with a recorded worker`} (${first.stderr()})`);
  await wait(plan.processFixture ? 100 : killAfterMs);
  const workerActiveAtKill = processStarted(open.worker.pid) === open.worker.started;
  assert.ok(workerActiveAtKill, `the real ${open.role} (process ${open.worker.pid}) was still working when its runner was killed`);
  const killedAt = new Date().toISOString();
  first.child.kill('SIGKILL');
  await first.exited;
  await wait(plan.processFixture ? 100 : 3000);
  const workerAfterKill = processStarted(open.worker.pid) === open.worker.started ? 'still running without a runner' : 'ended with its runner';
  const partialChanges = proof.git('status', '--porcelain').split('\n').filter(Boolean);
  const interrupted = await readState(proof.statePath);
  const second = runner();
  const exit = await second.exited;
  const state = await readState(proof.statePath);
  const result = second.result();
  const nativeAfter = plan.realCodexBuilder ? await nativeBuilderEvidence(proof) : [];
  const evidence = {
    scenario: name, test: 'scripts/julia-delivery-interrupt.test.mjs', interruptedAction: key, configuration: proof.configuration, killedAt, killAfterMs, workerActiveAtKill, workerAfterKill, partialChangesAtRestart: partialChanges,
    secondRunnerExit: exit, result, restarts: state?.restarts, repairsUsed: state?.repairsUsed, stage: state?.stage,
    approvedInputUnchanged: sha256(await readFile(proof.approvedPath, 'utf8')) === proof.approvedHash && state?.approved.sha256 === proof.approvedHash,
    worktree: state?.worktree, worktreeBeforeRestart: interrupted?.worktree, findingsBeforeRestart: interrupted?.findings ?? [], findingsAfter: state?.findings ?? [],
    resumedFixtureActions: second.fixtures(),
    partialAtKill, nativeAtKill, nativeAfter,
    actions: state ? journal(state) : null, proofTxt: await readFile(join(proof.worktree, 'proof.txt'), 'utf8').catch(() => null),
    builder: plan.processFixture ? 'deterministic OS process fixture (not provider integration)' : plan.realCodexBuilder ? 'real native Codex builder (operator opt-in)' : 'real Claude builder',
    reviewer: 'deterministic fixture / scripted verdict (not provider integration or a review)', candidate: 'disposable snapshot and content check (not the JUL-122 checks)',
    proofDir: proof.proofDir, savedAt: new Date().toISOString(),
  };
  await saveJson(join(evidenceDir ?? proof.proofDir, `${plan.processFixture ? 'process-fixture' : 'real-proof'}-${name}.json`), evidence);
  assert.ok(result, `the second runner reported a result (${second.stderr()})`);
  assert.deepEqual(state.result, result, 'the reported result is the one saved in the run record');
  assert.equal(state.worktree.path, proof.worktree);
  assert.deepEqual(state.worktree, interrupted.worktree, 'restart kept exactly the same worktree identity');
  t.diagnostic(`${name}: ${result.outcome}${result.reason ? ` (${result.reason})` : ''}; repairs used ${state.repairsUsed}; worker ${workerAfterKill}`);
  return { evidence, state, interrupted, proof, passed: () => { finished = true; } };
}

const oneWorkerAtATime = (state) => {
  const stopped = state.actions.find((action) => action.status === 'interrupted');
  const next = state.actions[state.actions.indexOf(stopped) + 1];
  assert.match(stopped.handling, /had already exited|was stopped/, 'the old worker was proved gone');
  assert.ok(Date.parse(next.startedAt) >= Date.parse(stopped.interruptedAt), 'the next worker started only after the old one was settled');
  if (next.worker) assert.notDeepEqual(next.worker, stopped.worker, 'the next worker is a different process');
  assert.notEqual(processStarted(stopped.worker.pid), stopped.worker.started, 'the old PID/start identity is gone');
};

test('deterministic build process fixture: killed runner keeps partial changes and finishes without overlapping workers', { timeout: 60000 }, async t => {
  const { evidence, state, passed } = await interruptAndResume(t, 'fixture-build', 'build:0', { processFixture: true, interruptAction: 'build:0', passWhen: '^JUL-196 recovery proof', finding: 'fixture finding' });
  assert.equal(evidence.approvedInputUnchanged, true);
  assert.deepEqual([state.restarts, state.repairsUsed], [1, 1]);
  assert.equal(evidence.result.outcome, 'pass');
  assert.equal(evidence.resumedFixtureActions[0].before, 'JUL-196 recovery proof\npartial\n');
  assert.match(evidence.proofTxt, /partial\nrepaired/);
  oneWorkerAtATime(state); passed();
});

test('deterministic repair process fixture: killed runner preserves completed build, findings and spent budget', { timeout: 60000 }, async t => {
  const finding = 'Finding: append repaired without discarding partial edits.';
  const { evidence, state, interrupted, passed } = await interruptAndResume(t, 'fixture-repair', 'build:1', { processFixture: true, interruptAction: 'build:1', passWhen: '^JUL-196 recovery proof\\r?\\npartial\\r?\\nrepaired', finding });
  assert.equal(evidence.approvedInputUnchanged, true);
  assert.equal(interrupted.repairsUsed, 1);
  assert.equal(state.repairsUsed, 2, 'the disposable interrupted repair consumes a repair; the actual code repair remains 1/3');
  assert.deepEqual(state.findings[0], interrupted.findings[0]);
  assert.equal(state.actions.filter(action => action.key === 'build:0').length, 1);
  assert.equal(evidence.resumedFixtureActions[0].before, 'JUL-196 recovery proof\npartial\nrepaired\n');
  assert.equal(evidence.result.outcome, 'pass');
  oneWorkerAtATime(state); passed();
});

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

test('deterministic review process fixture: interruption parks without another review or build', { timeout: 60000 }, async (t) => {
  const { evidence, state, passed } = await interruptAndResume(t, 'fixture-review', 'review:0', { processFixture: true, interruptAction: 'review:0', passWhen: '^JUL-196 recovery proof' });
  assert.equal(evidence.approvedInputUnchanged, true);
  assert.equal(state.actions.filter((action) => action.kind === 'build').length, 1, 'the finished build was not run again');
  assert.deepEqual(state.actions.filter((action) => action.key === 'review:0').map(({ attempt, status }) => [attempt, status]), [[1, 'uncertain']]);
  assert.equal(evidence.result.unsafe, true);
  assert.match(evidence.result.reason, /review.*interrupted.*not.*retr/i);
  assert.match(state.actions.at(-1).handling, /had already exited|was stopped/);
  assert.notEqual(processStarted(state.actions.at(-1).worker.pid), state.actions.at(-1).worker.started);
  passed();
});

test('opt-in real Codex builder: interrupted initial build recovers partial work with native OpenAI metadata and fixture review', {
  skip: process.env.JUL196_CODEX_REAL_PROOF !== '1' ? 'operator opt-in required: JUL196_CODEX_REAL_PROOF=1; no paid builder in ordinary suite' : missing('codex.exe'),
  timeout: 20 * 60 * 1000,
}, async t => {
  const { evidence, state, proof, passed } = await interruptAndResume(t, 'codex-build', 'build:0', { realCodexBuilder: true, passWhen: '^JUL-196 recovery proof\\r?\\npartial [0-9a-f-]+\\r?\\nrecovered\\r?\\n$' });
  assert.equal(evidence.approvedInputUnchanged, true);
  assert.equal(evidence.workerActiveAtKill, true);
  assert.equal(evidence.partialAtKill, `JUL-196 recovery proof\n${proof.marker}\n`);
  assert.equal(evidence.proofTxt, `${evidence.partialAtKill}recovered\n`, 'native recovery preserved the initial partial work');
  assert.deepEqual([state.restarts, state.repairsUsed, state.actions[0].status], [1, 1, 'interrupted']);
  oneWorkerAtATime(state);
  assert.equal(evidence.result.outcome, 'pass', JSON.stringify(evidence.result));
  const completed = state.actions.find(action => action.key === 'build:1' && action.status === 'done');
  assert.deepEqual(completed.outcome.observed, { harness: 'codex', model: 'gpt-6.1-sol', maker: 'OpenAI' });
  const launchEvidence = JSON.parse(await readFile(completed.outcome.outputPath, 'utf8'));
  assert.equal(launchEvidence.identityEvidence.provider, 'openai');
  assert.equal(launchEvidence.identityEvidence.effort, 'high');
  assert.equal(launchEvidence.cwd, proof.worktree);
  assert.match(launchEvidence.command, /codex\.exe$/i);
  assert.equal(launchEvidence.args[launchEvidence.args.indexOf('-s') + 1], 'workspace-write');
  assert.ok(evidence.nativeAfter.length >= 2, 'initial and recovered native sessions are distinct');
  for (const session of evidence.nativeAfter) {
    assert.equal(session.provider, 'openai');
    assert.deepEqual(session.models, ['gpt-6.1-sol']);
    assert.deepEqual(session.efforts, ['high']);
    assert.equal(session.canonicalSavedRead, true, 'actual tool output proves canonical skill and saved approved input read');
    assert.equal(session.noLinearCalls, true);
  }
  assert.equal(new Set(evidence.nativeAfter.map(session => session.thread)).size, evidence.nativeAfter.length);
  assert.equal(state.actions.filter(action => action.kind === 'review').length, 1);
  assert.match(evidence.reviewer, /fixture.*not provider integration/i);
  passed();
});
