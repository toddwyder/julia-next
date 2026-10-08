// Restart recovery for the delivery runner (JUL-196 step 7). Every test goes
// through the public seams: runDelivery / startDelivery with real run files in
// a temporary directory, and real processes wherever a worker's identity matters.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { runDelivery, startDelivery } from './julia-delivery-runner.mjs';
import { acquireRunLock, loadText, processStarted, saveJson } from './julia-delivery-state.mjs';

const configuration = {
  builder: { identity: 'claude', model: 'claude-sonnet', maker: 'Anthropic', harness: 'claude-code', thinking: 'high', connection: { route: 'native' } },
  reviewer: { identity: 'codex', model: 'gpt-review', maker: 'OpenAI', harness: 'codex', thinking: null, connection: { route: 'native' } },
};
const authorization = { issueId: 'JUL-196', explicitStart: true, authorizedBy: 'fixture operator', spending: { builder: { mode: 'fixture', maxUsd: 0 }, reviewer: { mode: 'fixture', maxUsd: 0 } } };
const card = { identifier: 'JUL-196', title: 'A card', state: { name: 'Ready', type: 'unstarted' }, description: '## Acceptance criteria\n\n- [ ] It works.' };
const COMMIT = 'a'.repeat(40);
const builderSeen = { harness: 'claude-code', model: 'claude-sonnet', maker: 'Anthropic' };
const reviewerSeen = { harness: 'codex', model: 'gpt-review', maker: 'OpenAI' };
const run = { issueId: 'JUL-196', configuration, authorization };

async function runFiles(t) {
  const root = await mkdtemp(join(tmpdir(), 'jul196-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, runPath: join(root, 'JUL-196.json'), statePath: join(root, 'JUL-196-state.json') };
}

// A worker that died with its runner: a real process id that has already exited.
const deadWorker = () => ({ pid: spawnSync(process.execPath, ['-e', '']).pid });
const pass = { exitCode: 0, observed: reviewerSeen, text: `VERDICT: PASS\nCOMMIT: ${COMMIT}` };
const goodCandidate = async () => ({ commit: COMMIT, clean: true, checks: { pass: true } });
const savedState = async (statePath) => JSON.parse(await readFile(statePath, 'utf8'));
// A real process that keeps running until the test (or the runner) stops it.
function idleProcess(t) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(() => { child.kill(); });
  return child;
}

test('a restart after the runner dies during review parks without retrying and does not read Linear again', async (t) => {
  const { runPath } = await runFiles(t);
  const launches = []; let reads = 0;
  const adapters = (review) => ({
    readCard: async () => { reads += 1; return card; },
    candidate: async () => ({ commit: COMMIT, clean: true, checks: { pass: true } }),
    launch: async (role, request) => {
      launches.push(role);
      await request.started?.(deadWorker());
      return role === 'builder' ? { exitCode: 0, observed: builderSeen, outputPath: 'build.json' } : review();
    },
  });
  await assert.rejects(runDelivery({ ...run, runPath }, adapters(async () => { throw new Error('runner died during review'); })), /runner died during review/);
  const result = await runDelivery({ ...run, runPath }, adapters(async () => ({ exitCode: 0, observed: reviewerSeen, text: `VERDICT: PASS\nCOMMIT: ${COMMIT}` })));
  assert.equal(result.unsafe, true);
  assert.match(result.reason, /review.*interrupted.*not.*retr/i);
  assert.deepEqual(launches, ['builder', 'reviewer'], 'neither the finished build nor the ambiguous review is run again');
  assert.equal(reads, 1, 'the approved requirements are read from Linear once');
});

test('findings and the repair count survive a restart: one build, then three repairs in all, and an interrupted repair is spent', async (t) => {
  const { runPath, statePath } = await runFiles(t);
  let builds = 0; const prompts = [];
  const adapters = (dieAtBuild) => ({
    readCard: async () => card,
    candidate: async () => ({ commit: String(builds).padStart(40, 'b'), clean: true, checks: { pass: true } }),
    launch: async (role, request) => {
      await request.started?.(deadWorker());
      if (role === 'reviewer') return { exitCode: 0, observed: reviewerSeen, text: `VERDICT: FAIL\nFinding ${builds}: test missing` };
      builds += 1; prompts.push(request.prompt);
      if (builds === dieAtBuild) throw new Error('runner died during repair');
      return { exitCode: 0, observed: builderSeen };
    },
  });
  await assert.rejects(runDelivery({ ...run, runPath }, adapters(2)), /died during repair/);
  const interrupted = await savedState(statePath);
  assert.equal(interrupted.repairsUsed, 1, 'the repair was counted when it was about to start');
  assert.deepEqual(interrupted.findings.map(({ round, text }) => [round, text]), [[0, 'VERDICT: FAIL\nFinding 1: test missing']]);
  const result = await runDelivery({ ...run, runPath }, adapters(0));
  assert.equal(result.outcome, 'park');
  assert.match(result.reason, /initial build and three repairs/);
  assert.equal(builds, 5, 'one build and three repairs, with the spent repair resumed once');
  assert.match(prompts[2], /Finding 1: test missing/, 'the builder after the restart repairs the saved findings');
  assert.match(prompts[2], /previous builder for this work was interrupted/);
  const final = await savedState(statePath);
  assert.equal(final.repairsUsed, 3);
  assert.deepEqual(final.findings.map(({ round }) => round), [0, 1, 2, 3]);
  const again = await runDelivery({ ...run, runPath }, adapters(0));
  assert.deepEqual(again, result, 'a finished run answers with its saved result');
  assert.equal(builds, 5, 'and starts no further builder');
});

test('a builder left running by a dead runner is stopped before another builder starts', async (t) => {
  const { runPath, statePath } = await runFiles(t);
  const orphan = idleProcess(t);
  const base = { readCard: async () => card, candidate: goodCandidate };
  await assert.rejects(runDelivery({ ...run, runPath }, { ...base, launch: async (role, request) => { await request.started({ pid: orphan.pid }); throw new Error('runner died during build'); } }), /died during build/);
  assert.ok(processStarted(orphan.pid), 'the old builder outlived its runner');
  let oldBuilderAtRelaunch = 'not relaunched';
  const result = await runDelivery({ ...run, runPath }, { ...base, launch: async (role) => {
    if (role === 'reviewer') return pass;
    oldBuilderAtRelaunch = processStarted(orphan.pid);
    return { exitCode: 0, observed: builderSeen };
  } });
  assert.equal(oldBuilderAtRelaunch, null, 'the old builder was gone before the new one started');
  assert.equal(result.outcome, 'pass');
  const state = await savedState(statePath);
  assert.equal(state.repairsUsed, 0, 'finishing the same interrupted build does not consume a repair');
  assert.match(state.actions[0].handling, /was stopped/);
  assert.equal(state.actions[0].status, 'interrupted');
});

test('a recorded process id that now belongs to another process is never stopped', async (t) => {
  const { runPath, statePath } = await runFiles(t);
  const bystander = idleProcess(t);
  const base = { readCard: async () => card, candidate: goodCandidate };
  // The dead worker had this process id at an earlier creation time; the system has since reused the number.
  const earlier = { started: async () => '1', stop: () => { throw new Error('nothing may be stopped here'); } };
  await assert.rejects(runDelivery({ ...run, runPath }, { ...base, processes: earlier, launch: async (role, request) => { await request.started({ pid: bystander.pid }); throw new Error('runner died'); } }), /runner died/);
  const result = await runDelivery({ ...run, runPath }, { ...base, launch: async (role) => (role === 'reviewer' ? pass : { exitCode: 0, observed: builderSeen }) });
  assert.equal(result.outcome, 'pass');
  assert.ok(processStarted(bystander.pid), 'the unrelated process is still running');
  assert.match((await savedState(statePath)).actions[0].handling, /left alone/);
});

test('an interrupted worker whose process was never recorded parks the run as unsafe, durably', async (t) => {
  const { runPath, statePath } = await runFiles(t);
  let launches = 0;
  const adapters = (launch) => ({ readCard: async () => card, candidate: goodCandidate, launch: async (...args) => { launches += 1; return launch(...args); } });
  await assert.rejects(runDelivery({ ...run, runPath }, adapters(async () => { throw new Error('runner died while starting the builder'); })), /while starting/);
  const result = await runDelivery({ ...run, runPath }, adapters(async () => ({ exitCode: 0, observed: builderSeen })));
  assert.deepEqual([result.outcome, result.unsafe], ['park', true]);
  assert.match(result.reason, /never recorded, so it may still be running/);
  assert.equal(launches, 1, 'nothing is started on top of a worker that may still be running');
  assert.deepEqual((await savedState(statePath)).result, result);
  assert.deepEqual(await runDelivery({ ...run, runPath }, adapters(async () => ({ exitCode: 0, observed: builderSeen }))), result);
  assert.equal(launches, 1);
});

test('corrupt, foreign, or altered run files stop a restart without running anything or rereading Linear', async (t) => {
  const refusedWith = async (damage, expected) => {
    const { root, runPath, statePath } = await runFiles(t);
    const base = { readCard: async () => card, candidate: goodCandidate };
    await assert.rejects(runDelivery({ ...run, runPath }, { ...base, launch: async (role, request) => { await request.started(deadWorker()); throw new Error('runner died'); } }), /runner died/);
    const changed = await damage({ root, statePath });
    const before = await readFile(statePath, 'utf8');
    let touched = 0;
    const result = await runDelivery({ ...run, runPath, ...changed }, { readCard: async () => { touched += 1; return card; }, candidate: async () => { touched += 1; }, launch: async () => { touched += 1; } });
    assert.deepEqual([result.outcome, result.unsafe], ['park', true], expected.source);
    assert.match(result.reason, expected);
    assert.equal(touched, 0, `${expected.source}: nothing ran`);
    assert.match(await readFile(join(root, 'JUL-196-refusal.json'), 'utf8'), expected);
    return { before, after: await readFile(statePath, 'utf8') };
  };
  const untouched = ({ before, after }) => assert.equal(after, before, 'the damaged run record is left exactly as it was found');
  untouched(await refusedWith(async ({ statePath }) => { await writeFile(statePath, '{"schema": 1, "issueId": "JUL-196", "actions": ['); }, /saved run state is corrupt/));
  untouched(await refusedWith(async ({ statePath }) => { await writeFile(statePath, ''); }, /saved run state is corrupt/));
  untouched(await refusedWith(async () => ({ configuration: { ...configuration, builder: { ...configuration.builder, model: 'another-model' } } }), /different builder\/reviewer configuration/));
  const changedInput = JSON.stringify({ card: { ...card, description: '## Acceptance criteria\n\n- [ ] Something else.' }, configuration });
  await refusedWith(async ({ root }) => { await writeFile(join(root, 'JUL-196-approved.json'), changedInput); }, /not the one this run started with/);
  await refusedWith(async ({ root }) => { await rm(join(root, 'JUL-196-approved.json')); }, /approved input is missing; Linear is not reread/);
});

test('a second runner cannot work on a run while the first is still alive', async (t) => {
  const { runPath } = await runFiles(t);
  let release; const blocked = new Promise((done) => { release = done; });
  let launches = 0; let reached; const building = new Promise((done) => { reached = done; });
  const first = runDelivery({ ...run, runPath }, { readCard: async () => card, candidate: goodCandidate, launch: async (role) => {
    launches += 1;
    if (role === 'reviewer') return pass;
    reached(); await blocked; return { exitCode: 0, observed: builderSeen };
  } });
  await building;
  const second = await runDelivery({ ...run, runPath }, { readCard: async () => card, candidate: goodCandidate, launch: async () => { launches += 1; } });
  assert.deepEqual([second.outcome, second.unsafe], ['park', true]);
  assert.match(second.reason, /is still working on this run/);
  assert.equal(launches, 1, 'the second runner started no worker');
  release();
  assert.equal((await first).outcome, 'pass');
});

// A real runner process whose builder is a real, idle process. It prints the
// worker's process id once the runner has recorded it, then never finishes.
// The worker is detached, as runLimited's workers are on Linux: on Windows a
// worker that is not detached is ended by the system with its runner (libuv's
// kill-on-close job), and this test is about the worker that does survive.
const runnerSource = (runnerUrl) => [
  "import { spawn } from 'node:child_process';",
  `import { runDelivery } from ${JSON.stringify(runnerUrl)};`,
  'const launch = async (role, request) => {',
  "  const worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: true, windowsHide: true });",
  '  await request.started({ pid: worker.pid });',
  "  console.log('WORKER ' + worker.pid);",
  '  await new Promise(() => {});',
  '};',
  'const inputs = { authorization: JSON.parse(process.env.RUN_AUTHORIZATION), issueId: process.env.RUN_ISSUE, configuration: JSON.parse(process.env.RUN_CONFIGURATION), runPath: process.env.RUN_PATH };',
  'await runDelivery(inputs, { readCard: async () => JSON.parse(process.env.RUN_CARD), candidate: async () => null, launch });',
].join('\n');

const forceStop = (pid) => (process.platform === 'win32'
  ? spawnSync('taskkill.exe', ['/PID', String(pid), '/F'], { stdio: 'ignore', windowsHide: true })
  : spawnSync('kill', ['-9', String(pid)], { stdio: 'ignore' }));

test('a runner process killed mid-build is replaced by one that stops its orphaned worker and finishes the run', { timeout: 60000 }, async (t) => {
  const { runPath, statePath } = await runFiles(t);
  const { NODE_TEST_CONTEXT: _context, ...env } = process.env;
  const source = runnerSource(pathToFileURL(resolve('scripts/julia-delivery-runner.mjs')).href);
  const runner = spawn(process.execPath, ['--input-type=module', '-e', source], {
    env: { ...env, RUN_AUTHORIZATION: JSON.stringify(authorization), RUN_ISSUE: 'JUL-196', RUN_PATH: runPath, RUN_CONFIGURATION: JSON.stringify(configuration), RUN_CARD: JSON.stringify(card) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let workerPid = null;
  t.after(() => { runner.kill('SIGKILL'); if (workerPid) forceStop(workerPid); });
  const exited = new Promise((done) => { runner.on('exit', done); });
  workerPid = await new Promise((found, failed) => {
    let out = '';
    runner.stdout.on('data', (chunk) => { out += chunk; const pid = /WORKER (\d+)/.exec(out)?.[1]; if (pid) found(Number(pid)); });
    exited.then((code) => failed(new Error(`the runner exited (${code}) before its worker started`)));
  });
  runner.kill('SIGKILL');
  await exited;
  assert.ok(processStarted(workerPid), 'the worker outlived the killed runner');
  let reads = 0; let orphanAtRelaunch = 'not relaunched';
  const result = await runDelivery({ ...run, runPath }, { readCard: async () => { reads += 1; return card; }, candidate: goodCandidate, launch: async (role) => {
    if (role === 'reviewer') return pass;
    orphanAtRelaunch = processStarted(workerPid);
    return { exitCode: 0, observed: builderSeen };
  } });
  assert.equal(orphanAtRelaunch, null, 'old and new workers never run together');
  assert.equal(result.outcome, 'pass');
  assert.equal(reads, 0, 'the new runner works from the saved approved input');
  const state = await savedState(statePath);
  assert.deepEqual([state.restarts, state.repairsUsed, state.actions[0].status], [1, 0, 'interrupted']);
});

function gitRepo(root, name) {
  const path = join(root, name);
  const inRepo = (...args) => { const result = spawnSync('git', args, { cwd: path, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
  spawnSync('git', ['init', '-q', '-b', 'work', path], { encoding: 'utf8' });
  inRepo('-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'start');
  return { path, inRepo };
}

test('a restart continues only in its own worktree and branch, and keeps the interrupted builder\'s partial changes', { timeout: 60000 }, async (t) => {
  const { root, runPath, statePath } = await runFiles(t);
  const source = gitRepo(root, 'source'); const other = gitRepo(root, 'other');
  await import('node:fs/promises').then(async ({ mkdir }) => { await mkdir(join(source.path, '.claude/skills/implement'), { recursive: true }); });
  await writeFile(join(source.path, '.claude/skills/implement/SKILL.md'), 'fixture canonical instructions');
  source.inRepo('add', '-A'); source.inRepo('-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'instructions');
  const path = resolve(root, 'JUL-196-worktree').toLowerCase();
  const own = { path, inRepo: (...args) => { const r = spawnSync('git', ['-C', path, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); } };
  const partial = join(path, 'half-written.txt');
  const options = (worktree, launch) => ({ authorization, repoRoot: source.path, base: source.inRepo('rev-parse', 'HEAD'), runPath, worktree, readCard: async () => card, launch });
  const dying = async (role, request) => { await request.started(deadWorker()); await writeFile(partial, 'half'); throw new Error('runner died during build'); };
  await assert.rejects(startDelivery('JUL-196', configuration, options(own.path, dying)), /died during build/);
  const saved = await savedState(statePath);
  assert.deepEqual([saved.worktree.branch, saved.worktree.startCommit], ['runner/card-196', own.inRepo('rev-parse', 'HEAD')]);
  let launches = 0;
  const elsewhere = await startDelivery('JUL-196', configuration, options(other.path, async () => { launches += 1; }));
  assert.equal(elsewhere.unsafe, true);
  assert.match(elsewhere.reason, /this run belongs to worktree/);
  own.inRepo('checkout', '-q', '--detach');
  const detached = await startDelivery('JUL-196', configuration, options(own.path, async () => { launches += 1; }));
  assert.match(detached.reason, /not the run's branch runner\/card-196/);
  assert.equal(launches, 0, 'no worker starts in the wrong place');
  own.inRepo('checkout', '-q', 'runner/card-196');
  let nextBuilder = null;
  const result = await startDelivery('JUL-196', configuration, options(own.path, async (role, request) => {
    nextBuilder = { partial: existsSync(partial) ? await readFile(partial, 'utf8') : null, prompt: request.prompt };
    return { exitCode: 0, observed: builderSeen };
  }));
  assert.equal(nextBuilder.partial, 'half', 'the partial change is still in the worktree');
  assert.match(nextBuilder.prompt, /partial changes are still in the worktree/);
  // The fixture has no agreed seam tests; candidate checks refuse it after recovery.
  assert.match(result.reason, /candidate drifted or is dirty/);
});

// The last window a runner can die in: the review passed and the candidate was
// verified, but the final result never reached the run file. The worktree is a
// real git repository, so what the restarted runner measures is what is there.
test('a restart between the passed verification and the saved result measures the candidate again before it records a PASS', { timeout: 120000 }, async (t) => {
  const restartedAfter = async (change) => {
    const { root, runPath, statePath } = await runFiles(t);
    const worktree = gitRepo(root, 'worktree');
    const reviewed = worktree.inRepo('rev-parse', 'HEAD');
    let reads = 0; let launches = 0;
    const adapters = {
      readCard: async () => card,
      candidate: async () => { reads += 1; return { commit: worktree.inRepo('rev-parse', 'HEAD'), clean: !worktree.inRepo('status', '--porcelain'), checks: { pass: true } }; },
      launch: async (role, request) => {
        launches += 1;
        await request.started(deadWorker());
        return role === 'builder' ? { exitCode: 0, observed: builderSeen } : { exitCode: 0, observed: reviewerSeen, text: `VERDICT: PASS\nCOMMIT: ${reviewed}` };
      },
    };
    // Every run file is really written, except the one write that would have finished the run.
    const dyingSave = async (path, value) => { if (path === statePath && value.result) throw new Error('runner died before the result was saved'); await saveJson(path, value); };
    await assert.rejects(runDelivery({ ...run, runPath }, { ...adapters, save: dyingSave, load: loadText, lock: acquireRunLock }), /died before the result was saved/);
    const interrupted = await savedState(statePath);
    assert.deepEqual([interrupted.result, interrupted.actions.at(-1).key, interrupted.actions.at(-1).status], [null, 'verify:0', 'done'], 'the runner stopped with the verification saved and no result');
    assert.deepEqual([reads, launches], [2, 2]);
    await change(worktree);
    const result = await runDelivery({ ...run, runPath }, adapters);
    const again = await runDelivery({ ...run, runPath }, adapters);
    return { result, again, reviewed, readsAfterRestart: reads - 2, launchesAfterRestart: launches - 2, state: await savedState(statePath) };
  };
  const verifications = (state) => state.actions.filter((action) => action.key === 'verify:0').map(({ attempt, status }) => [attempt, status]);

  await t.test('the worktree moved on to another commit: the reviewed commit is not passed', async () => {
    const { result, again, state, readsAfterRestart, launchesAfterRestart } = await restartedAfter((worktree) => worktree.inRepo('-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'landed while the runner was down'));
    assert.equal(result.outcome, 'park', JSON.stringify(result));
    assert.match(result.reason, /candidate changed after review/);
    assert.equal(readsAfterRestart, 1, 'the candidate was measured again after the restart');
    assert.equal(launchesAfterRestart, 0, 'the finished build and review were not run again');
    assert.deepEqual(state.result, result, 'the refusal is the saved result');
    assert.deepEqual(again, result);
  });

  await t.test('uncommitted edits were left in the worktree: the reviewed commit is not passed', async () => {
    const { result, state, readsAfterRestart } = await restartedAfter((worktree) => writeFile(join(worktree.path, 'left-behind.txt'), 'edited while the runner was down'));
    assert.equal(result.outcome, 'park', JSON.stringify(result));
    assert.match(result.reason, /candidate changed after review/);
    assert.equal(readsAfterRestart, 1);
    assert.deepEqual(state.result, result);
  });

  await t.test('nothing changed: the PASS is recorded from a fresh measurement, and the finished run then answers from its saved result', async () => {
    const { result, again, reviewed, state, readsAfterRestart, launchesAfterRestart } = await restartedAfter(async () => {});
    assert.deepEqual([result.outcome, result.commit], ['pass', reviewed]);
    assert.equal(readsAfterRestart, 1, 'measured once by the restarted runner, and not again by the start after it finished');
    assert.equal(launchesAfterRestart, 0);
    assert.deepEqual(verifications(state), [[1, 'stale'], [2, 'done']], 'the earlier verification is kept in the journal, marked as not relied on');
    assert.deepEqual(again, result);
  });
});


test('resuming a spent repair preserves one used and two remaining without charging twice', async t => {
  const { runPath, statePath } = await runFiles(t);
  let builds = 0;
  const adapters = {
    readCard: async () => card,
    candidate: async () => ({ commit: String(builds).padStart(40, 'b'), clean: true, checks: { pass: true } }),
    launch: async (role, request) => {
      if (role === 'reviewer') return builds === 1 ? { exitCode: 0, observed: reviewerSeen, text: 'VERDICT: FAIL\nrepair this finding' } : { ...pass, text: `VERDICT: PASS\nCOMMIT: ${String(builds).padStart(40, 'b')}` };
      await request.started(deadWorker());
      builds++;
      if (builds === 2) throw new Error('repair interrupted');
      return { exitCode: 0, observed: builderSeen };
    },
  };
  await assert.rejects(runDelivery({ ...run, runPath }, adapters), /repair interrupted/);
  assert.equal((await savedState(statePath)).repairsUsed, 1);
  const result = await runDelivery({ ...run, runPath }, adapters);
  assert.equal(result.outcome, 'pass');
  const state = await savedState(statePath);
  assert.equal(state.repairsUsed, 1);
  assert.equal(3 - state.repairsUsed, 2);
  assert.equal(state.actions.filter(a => a.kind === 'build' && a.round === 1).length, 2);
});


test('a live worker without a recorded creation time cannot be replaced or mistaken for PID reuse', async t => {
  const { runPath, statePath } = await runFiles(t);
  const adapters = { readCard: async () => card, candidate: goodCandidate, processes: { started: () => null, stop: () => assert.fail('unknown owner must not be killed') }, launch: async (_role, request) => { await request.started({ pid: 12345 }); throw new Error('interrupted with unknown creation time'); } };
  await assert.rejects(runDelivery({ ...run, runPath }, adapters), /unknown creation time/);
  const result = await runDelivery({ ...run, runPath }, { ...adapters, processes: { started: () => 'live-process', stop: () => assert.fail('unknown owner must not be killed') }, launch: () => assert.fail('unknown worker must not overlap replacement') });
  assert.equal(result.unsafe, true);
  assert.match(result.reason, /creation time|identity/);
  assert.equal((await savedState(statePath)).actions[0].status, 'started');
});
