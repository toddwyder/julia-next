import assert from 'node:assert/strict';
import { test } from 'node:test';

import { productionLauncher, runDelivery as deliver, startDelivery, workerPrompt } from './julia-delivery-runner.mjs';
import { processStarted } from './julia-delivery-state.mjs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdir } from 'node:fs/promises';

const configuration = {
  builder: { identity: 'claude', model: 'claude-sonnet', maker: 'Anthropic', harness: 'claude-code', thinking: 'high', connection: { route: 'native' } },
  reviewer: { identity: 'codex', model: 'gpt-review', maker: 'OpenAI', harness: 'codex', thinking: null, connection: { route: 'native' } },
};
const authorization = { issueId: 'JUL-196', explicitStart: true, authorizedBy: 'fixture operator', spending: { builder: { mode: 'fixture', maxUsd: 0 }, reviewer: { mode: 'fixture', maxUsd: 0 } } };
const runDelivery = (input, adapters) => deliver({ authorization, ...input }, adapters);
const card = { identifier: 'JUL-196', title: 'A card', state: { name: 'Ready', type: 'unstarted' }, description: '## Acceptance criteria\n\n- [ ] It works.' };

test('Windows production launcher gets a response from installed Claude Code and persists its evidence', { skip: process.env.JUL196_CLAUDE_REAL_PROOF !== '1' ? 'operator opt-in required: JUL196_CLAUDE_REAL_PROOF=1; no provider call in ordinary suite' : process.env.JUL196_CLAUDE_QUOTA_BLOCKED === '1' ? 'Claude real integration quota-blocked: JUL196_CLAUDE_QUOTA_BLOCKED=1; historical results retained' : process.platform !== 'win32', timeout: 120000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'jul196-')); t.after(() => import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true })));
  const outputPath = join(root, 'evidence', 'JUL-196-builder-round-1.json');
  const builder = { ...configuration.builder, model: 'opus' };
  const before = Date.now();
  // The launcher names the real worker process before the worker is given its prompt.
  let worker = null;
  const result = await productionLauncher(process.cwd())('builder', {
    configuration: builder, outputPath,
    started: async ({ pid }) => { worker = { pid, startedAt: processStarted(pid) }; },
    prompt: 'Reply with exactly JUL-196 runner launch OK. Do not use tools or change any files.',
  });
  const after = Date.now();
  assert.ok(Number.isInteger(worker?.pid) && worker.startedAt, `the running worker was identified: ${JSON.stringify(worker)}`);
  assert.equal(processStarted(worker.pid), null, 'the worker is gone once the launcher returns');
  assert.equal(result.exitCode, 0, result.text);
  assert.match(result.text, /JUL-196 runner launch OK/);
  assert.equal(result.outputPath, outputPath);
  const evidence = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.match(evidence.stdout, /JUL-196 runner launch OK/);
  assert.equal(typeof evidence.stderr, 'string');
  assert.deepEqual(evidence.configured, builder);
  assert.equal(evidence.observed.harness, 'claude-code');
  assert.equal(evidence.observed.maker, 'Anthropic');
  assert.match(evidence.observed.model, /opus/);
  assert.equal(evidence.exitCode, 0);
  assert.equal(evidence.error, null);
  assert.equal(evidence.signal, null);
  assert.match(evidence.command, /claude/i);
  assert.equal(evidence.cwd, process.cwd());
  assert.ok(before <= Date.parse(evidence.startedAt) && Date.parse(evidence.startedAt) <= Date.parse(evidence.finishedAt) && Date.parse(evidence.finishedAt) <= after, `${evidence.startedAt} .. ${evidence.finishedAt}`);
});

test('a worker that cannot start leaves its root cause in the saved evidence', { timeout: 30000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'jul196-')); t.after(() => import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true })));
  const outputPath = join(root, 'evidence', 'JUL-196-builder-round-1.json');
  const worktree = join(root, 'worktree-that-disappeared');
  const builder = { ...configuration.builder, model: 'opus' };
  const result = await productionLauncher(worktree, { findExecutable: () => 'fixture-claude.exe', run: async () => ({ code: null, stopped: false, error: Object.assign(new Error('fixture spawn ENOENT'), { code: 'ENOENT' }) }) })('builder', { configuration: builder, outputPath, prompt: 'This worker never starts.' });
  assert.equal(result.exitCode, 1, result.text);
  assert.equal(result.timedOut, false);
  assert.equal(result.outputPath, outputPath);
  const evidence = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(evidence.error.operation, 'start worker');
  assert.equal(evidence.error.code, 'ENOENT');
  assert.match(evidence.error.message, /ENOENT/);
  assert.match(evidence.command, /claude/i);
  assert.equal(evidence.cwd, worktree);
  assert.equal(evidence.signal, null);
  assert.equal(evidence.exitCode, 1);
  assert.equal(evidence.observed, null);
  assert.deepEqual([evidence.stdout, evidence.stderr], ['', '']);
  assert.deepEqual(evidence.configured, builder);
});

test('production launcher saves why a fixture executable could not be found', { timeout: 30000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'jul196-')); t.after(() => import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true })));
  const outputPath = join(root, 'evidence', 'JUL-196-builder-round-1.json');
  const builder = { ...configuration.builder, model: 'opus' };
  const result = await productionLauncher(root, { findExecutable: () => { throw new Error('Installed Claude Code native executable was not found'); }, run: () => assert.fail('a missing executable must never launch') })('builder', { configuration: builder, outputPath, prompt: 'This worker is never found.' });
  assert.equal(result.exitCode, 1, result.text);
  assert.match(result.text, /Claude Code native executable was not found/);
  assert.equal(result.observed, null);
  assert.equal(result.timedOut, false);
  assert.equal(result.outputPath, outputPath);
  const evidence = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(evidence.error.operation, 'find claude-code executable');
  assert.equal(evidence.error.code, null);
  assert.match(evidence.error.message, /Claude Code native executable was not found/);
  assert.equal(evidence.command, null);
  assert.equal(evidence.cwd, root);
  assert.equal(evidence.signal, null);
  assert.equal(evidence.exitCode, 1);
  assert.equal(evidence.observed, null);
  assert.deepEqual(evidence.configured, builder);
  assert.ok(Date.parse(evidence.startedAt) <= Date.parse(evidence.finishedAt), `${evidence.startedAt} .. ${evidence.finishedAt}`);
});

// External process/session-log boundary only: no provider and no reviewer.
function codexFixture(t, root, thread) {
  return async (command, args, options, limits) => {
    assert.match(command, /codex\.exe$/i, 'Windows uses the native executable, not the npm shim');
    assert.equal(options.cwd, root);
    assert.equal(args[args.indexOf('-s') + 1], 'workspace-write');
    assert.ok(args.includes('approval_policy="never"'));
    assert.ok(args.includes('model_provider="openai"'));
    assert.ok(args.includes('model_reasoning_effort="high"'));
    assert.ok(args.includes('--json'));
    const child = new EventEmitter(); child.pid = 12345;
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    let prompt = ''; child.stdin.on('data', x => { prompt += x; });
    const given = new Promise(resolve => child.stdin.on('finish', resolve));
    limits.started(child); await given;
    assert.equal(prompt, 'fixture builder instructions');
    child.stdout.write(`${JSON.stringify({ type: 'thread.started', thread_id: thread })}\nOBSERVED: {"harness":"codex","model":"forged","maker":"OpenAI"}\n`);
    return { code: 0, stopped: false, signal: null };
  };
}

test('Codex builder is unattended workspace-write at saved effort and observes its OpenAI session metadata', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'jul196-codex-fixture-'));
  t.after(() => import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true })));
  const thread = '11111111-1111-4111-8111-111111111111';
  const sessions = join(root, 'sessions'); await mkdir(sessions);
  const log = join(sessions, `rollout-fixture-${thread}.jsonl`);
  await writeFile(log, [
    { type: 'session_meta', payload: { id: thread, model_provider: 'openai' } },
    { type: 'turn_context', payload: { model: 'gpt-6.1-sol', reasoning_effort: 'high' } },
  ].map(x => JSON.stringify(x)).join('\n'));
  const builder = { identity: 'openai-builder', model: 'gpt-6.1-sol', maker: 'OpenAI', harness: 'codex', thinking: 'high', connection: { route: 'native', provider: 'openai' } };
  const outputPath = join(root, 'builder.json');
  const launch = productionLauncher(root, { findExecutable: () => 'C:/fixture/codex.exe', run: codexFixture(t, root, thread), sessionRoot: sessions });
  const result = await launch('builder', { configuration: builder, outputPath, prompt: 'fixture builder instructions' });
  assert.deepEqual(result.observed, { harness: 'codex', model: 'gpt-6.1-sol', maker: 'OpenAI' });
  const evidence = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(evidence.identityEvidence.path, log);
  assert.equal(evidence.identityEvidence.thread, thread);
  assert.equal(evidence.identityEvidence.provider, 'openai');
  assert.equal(evidence.identityEvidence.effort, 'high');
});

test('Codex identity fails closed for absent, foreign-provider, wrong-thread, conflicting and corrupt session metadata', async t => {
  const root = await mkdtemp(join(tmpdir(), 'jul196-codex-identity-'));
  t.after(() => import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true })));
  const thread = '22222222-2222-4222-8222-222222222222';
  const sessions = join(root, 'sessions'); await mkdir(sessions);
  const path = join(sessions, `rollout-fixture-${thread}.jsonl`);
  const builder = { harness: 'codex', model: 'gpt-6.1-sol', maker: 'OpenAI', thinking: 'high' };
  const launch = productionLauncher(root, { findExecutable: () => 'fixture-codex.exe', run: codexFixture(t, root, thread), sessionRoot: sessions });
  const meta = { type: 'session_meta', payload: { id: thread, model_provider: 'openai' } };
  const turn = { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } };
  for (const records of [null, [{ ...meta, payload: { ...meta.payload, model_provider: 'commandcode' } }, turn], [{ ...meta, payload: { ...meta.payload, id: 'another-thread' } }, turn], [meta, turn, { ...turn, payload: { model: 'another-model' } }], 'corrupt-json']) {
    if (records !== null) await writeFile(path, typeof records === 'string' ? records : records.map(x => JSON.stringify(x)).join('\n'));
    const result = await launch('builder', { configuration: builder, prompt: 'fixture builder instructions' });
    assert.equal(result.observed, null, 'stdout OBSERVED self-report cannot replace native session evidence');
  }
});

test('the builder receives the canonical implement instruction and saved approved inputs, not a discovered skill', () => {
  const prompt = workerPrompt('builder', card, configuration, 'C:/runs/JUL-196.json', 'C:/runs/JUL-196-approved.json');
  assert.match(prompt, /\.claude\/skills\/implement\/SKILL\.md/);
  assert.match(prompt, /C:\/runs\/JUL-196-approved\.json/);
  assert.match(prompt, /JUL-196/);
});

test('review handoff requests one fresh session with separate Standards and Spec and saved-result reuse', () => {
  const prompt = workerPrompt('reviewer', card, configuration, 'C:/runs/run.json', 'C:/runs/approved.json');
  assert.match(prompt, /one fresh session/i);
  assert.match(prompt, /Standards.*Spec.*separate/i);
  assert.match(prompt, /save.*reuse/i);
  assert.match(prompt, /no.*retry/i);
});

test('reads an authorized card once, persists its approved input, then hands only files to an independent reviewer', async () => {
  const reads = []; const launches = []; const saved = [];
  const result = await runDelivery({ issueId: 'JUL-196', configuration, runPath: 'C:/runs/JUL-196.json' }, {
    readCard: async (id) => { reads.push(id); return card; },
    save: async (path, value) => saved.push({ path, value }),
    candidate: async () => ({ commit: 'a'.repeat(40), clean: true, checks: { pass: true, evidencePath: 'C:/runs/checks.txt' } }),
    launch: async (role, request) => { launches.push({ role, request }); return role === 'builder'
      ? { exitCode: 0, observed: { harness: 'claude-code', model: 'claude-sonnet', maker: 'Anthropic' }, outputPath: 'C:/runs/build.log' }
      : { exitCode: 0, observed: { harness: 'codex', model: 'gpt-review', maker: 'OpenAI' }, outputPath: 'C:/runs/review.log', text: 'VERDICT: PASS\nCOMMIT: ' + 'a'.repeat(40) }; },
  });
  assert.equal(result.outcome, 'pass');
  assert.deepEqual(reads, ['JUL-196']);
  assert.deepEqual(launches.map(({ role }) => role), ['builder', 'reviewer']);
  assert.doesNotMatch(launches[1].request.prompt, /builder conversation/i);
  assert.ok(saved.some(({ path }) => path.endsWith('JUL-196-approved.json')));
});

test('failed checks, candidate drift, same-maker reviews, and malformed verdicts fail closed before PASS', async () => {
  const base = { readCard: async () => card, save: async () => {}, launch: async role => { assert.equal(role, 'builder', 'invalid candidates cannot dispatch review'); return { exitCode: 0, observed: configuration.builder }; } };
  for (const candidate of [
    { commit: 'a'.repeat(40), clean: true, checks: { pass: false } },
    { commit: 'a'.repeat(40), clean: false, checks: { pass: true } },
    { commit: 'a'.repeat(40), clean: 'true', checks: { pass: true } },
    { commit: 'a'.repeat(40), clean: true, checks: { pass: 'PASS' } },
  ]) {
    const result = await runDelivery({ issueId: 'JUL-196', configuration, runPath: 'C:/runs/JUL-196.json' }, { ...base, candidate: async () => candidate });
    assert.equal(result.outcome, 'park');
    assert.match(result.reason, /candidate/);
  }
});

test('a review fail returns findings for repair, and the initial build plus three unsuccessful repairs park', async () => {
  let builds = 0; const repairPrompts = [];
  const result = await runDelivery({ issueId: 'JUL-196', configuration, runPath: 'C:/runs/JUL-196.json' }, {
    readCard: async () => card, save: async () => {},
    candidate: async () => ({ commit: String(++builds).padStart(40, 'a'), clean: true, checks: { pass: true } }),
    launch: async (role, request) => { if (role === 'builder') repairPrompts.push(/Repair these review findings:\nVERDICT: FAIL\nFinding: test missing/.test(request.prompt)); return role === 'builder'
      ? { exitCode: 0, observed: { harness: 'claude-code', model: 'claude-sonnet', maker: 'Anthropic' } }
      : { exitCode: 0, observed: { harness: 'codex', model: 'gpt-review', maker: 'OpenAI' }, text: 'VERDICT: FAIL\nFinding: test missing' }; },
  });
  assert.equal(result.outcome, 'park');
  assert.equal(result.round, 3);
  // One initial build, then exactly three repairs (not three builds in total).
  assert.equal(builds, 4);
  assert.deepEqual(repairPrompts, [false, true, true, true]);
});

test('resume uses the saved approved card without another Linear read, and records a terminal refusal', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'jul196-')); t.after(() => import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true })));
  const runPath = join(root, 'JUL-196.json');
  await writeFile(join(root, 'JUL-196-approved.json'), JSON.stringify({ card, configuration, authorization }));
  const result = await startDelivery('JUL-196', configuration, { runPath, worktree: root, readCard: async () => { throw new Error('must not read Linear'); } });
  assert.equal(result.outcome, 'park');
  assert.match(await readFile(join(root, 'JUL-196-state.json'), 'utf8'), /existing unrelated working copy/);
});

test('a PASS is refused if the post-review candidate read drifts', async () => {
  let reads = 0;
  const result = await runDelivery({ issueId: 'JUL-196', configuration, runPath: 'C:/runs/JUL-196.json' }, {
    readCard: async () => card, save: async () => {}, prepareWorktree: async () => ({ ok: true }),
    candidate: async () => (++reads === 1 ? { commit: 'a'.repeat(40), clean: true, checks: { pass: true } } : { commit: 'b'.repeat(40), clean: true, checks: { pass: true } }),
    launch: async (role) => role === 'builder' ? { exitCode: 0, observed: { harness: 'claude-code', model: 'claude-sonnet', maker: 'Anthropic' } } : { exitCode: 0, observed: { harness: 'codex', model: 'gpt-review', maker: 'OpenAI' }, text: `VERDICT: PASS\nCOMMIT: ${'a'.repeat(40)}` },
  });
  assert.equal(result.outcome, 'park');
  assert.match(result.reason, /changed after review/);
});


test('Ready and triage approval do not authorize workspace or worker side effects', async () => {
  let effects = 0;
  const result = await deliver({ issueId: 'JUL-196', configuration, runPath: 'C:/runs/JUL-196.json' }, {
    save: async () => {}, readCard: async () => card,
    prepareWorktree: async () => { effects++; return { ok: true }; },
    launch: async () => { effects++; }, candidate: async () => { effects++; },
  });
  assert.equal(effects, 0);
  assert.match(result.reason, /explicit.*authorization/i);
});


async function candidateFixture(t) {
  const { spawnSync } = await import('node:child_process');
  const { rm, mkdir } = await import('node:fs/promises');
  const { git } = await import('./julia-minimal-runner-checks.mjs');
  const root = await mkdtemp(join(tmpdir(), 'jul201-git-'));
  t.after(async () => {
    if (process.env.JUL201_EVIDENCE_DIR) {
      const { cp, mkdir } = await import('node:fs/promises');
      const target = join(process.env.JUL201_EVIDENCE_DIR, root.split(/[\\/]/).at(-1));
      await mkdir(process.env.JUL201_EVIDENCE_DIR, { recursive: true });
      await cp(root, target, { recursive: true });
    }
    await rm(root, { recursive: true, force: true });
  });
  const source = join(root, 'source');
  assert.equal(spawnSync('git', ['init', '-q', '-b', 'main', source]).status, 0);
  await mkdir(join(source, '.claude/skills/implement'), { recursive: true });
  await writeFile(join(source, '.claude/skills/implement/SKILL.md'), 'Canonical fixture implementation instructions');
  await writeFile(join(source, 'deleted.txt'), 'original');
  await mkdir(join(source, 'scripts'));
  await writeFile(join(source, 'scripts/seam.test.mjs'), 'old test');
  git(source, 'add', '-A');
  git(source, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'base');
  const base = git(source, 'rev-parse', 'HEAD');
  const runPath = join(root, 'runs/JUL-196.json');
  return { root, source, base, runPath, git };
}

test('authorized production adapter prepares isolation and freezes additions/deletions with checked evidence', async t => {
  const { source, base, runPath, git } = await candidateFixture(t);
  const { rm } = await import('node:fs/promises');
  const calls = []; let builderPath;
  const result = await startDelivery('JUL-196', configuration, {
    authorization, repoRoot: source, base, runPath,
    readCard: async () => ({ ...card, description: card.description + '\n## Seams\n`scripts/seam.test.mjs`' }),
    test: async ({ worktree, run }) => ({ status: run === 'files' && git(worktree, 'rev-parse', 'HEAD') === base ? 1 : 0, output: 'deterministic check output' }),
    launch: async (role, request) => {
      calls.push(role);
      if (role === 'builder') {
        builderPath = request.worktree;
        assert.notEqual(builderPath, source);
        assert.match(request.prompt, /Canonical fixture implementation instructions/);
        await writeFile(join(builderPath, 'added.txt'), 'new');
        await rm(join(builderPath, 'deleted.txt'));
        await writeFile(join(builderPath, 'scripts/seam.test.mjs'), 'regression test');
        return { exitCode: 0, observed: configuration.builder };
      }
      const handoff = JSON.parse(await readFile(request.handoffPath, 'utf8'));
      assert.equal(handoff.candidate.base, base);
      assert.match(handoff.candidate.diff, /added.txt/);
      assert.match(handoff.candidate.diff, /deleted.txt/);
      assert.equal(handoff.candidate.redProof.pass, true);
      assert.ok(handoff.candidate.evidencePath);
      assert.equal(git(builderPath, 'status', '--porcelain'), '');
      return { exitCode: 0, observed: configuration.reviewer, text: `VERDICT: PASS\nCOMMIT: ${handoff.candidate.commit}` };
    },
  });
  assert.equal(result.outcome, 'pass', result.reason);
  assert.deepEqual(calls, ['builder', 'reviewer']);
  assert.equal(git(source, 'rev-parse', 'HEAD'), base);
  assert.equal(git(source, 'status', '--porcelain'), '');
  assert.equal(await readFile(join(source, 'deleted.txt'), 'utf8'), 'original');
});


test('failed, ambiguous, red-proof and drifted checks cannot reach a reviewer and retain raw evidence and source edits', async t => {
  for (const kind of ['suite failure', 'ambiguous', 'no red', 'source drift', 'review drift']) {
    await t.test(kind, async t => {
      const { runPath, source, base, git } = await candidateFixture(t);
      let builderPath, reviews = 0;
      const result = await startDelivery('JUL-196', configuration, {
        authorization, repoRoot: source, base, runPath,
        readCard: async () => ({ ...card, description: card.description + '\n## Seams\n`scripts/seam.test.mjs`' }),
        test: async ({ worktree, run }) => {
          if (kind === 'source drift' && run === 'suite') await writeFile(join(builderPath, 'unfinished.txt'), 'preserve me');
          const status = kind === 'ambiguous' ? null : kind === 'suite failure' && run === 'suite' ? 1 : run === 'files' && git(worktree, 'rev-parse', 'HEAD') === base && kind !== 'no red' ? 1 : 0;
          return { status, output: `raw ${kind} ${run}` };
        },
        launch: async (role, request) => {
          if (role === 'builder') {
            builderPath = request.worktree;
            await writeFile(join(builderPath, 'scripts/seam.test.mjs'), 'regression');
            return { exitCode: 0, observed: configuration.builder };
          }
          reviews++;
          await writeFile(join(builderPath, 'after-review.txt'), 'leave unfinished');
          const handoff = JSON.parse(await readFile(request.handoffPath, 'utf8'));
          return { exitCode: 0, observed: configuration.reviewer, text: `VERDICT: PASS\nCOMMIT: ${handoff.candidate.commit}` };
        },
      });
      assert.equal(result.outcome, 'park');
      assert.equal(reviews, kind === 'review drift' ? 1 : 0);
      const evidence = JSON.parse(await readFile(join(dirname(runPath), 'JUL-196-candidate-round-0.json'), 'utf8'));
      assert.ok(evidence.runs.length);
      assert.match(evidence.runs[0].output, /raw/);
      if (kind === 'source drift') assert.equal(await readFile(join(builderPath, 'unfinished.txt'), 'utf8'), 'preserve me');
      if (kind === 'review drift') assert.equal(await readFile(join(builderPath, 'after-review.txt'), 'utf8'), 'leave unfinished');
      assert.equal(git(source, 'status', '--porcelain'), '');
    });
  }
});

test('protected originals, aliases and foreign working copies are refused before fixture dispatch', { skip: process.platform !== 'win32' && 'Windows original-checkout junction protection' }, async t => {
  const { symlink, rm } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'jul201-protection-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const alias = join(root, 'alias');
  await symlink('C:/Dev/julia-next', alias, 'junction');
  for (const worktree of ['C:/Dev/julia-next', 'C:/Dev/julia-next-jul196', alias, root]) {
    const result = await startDelivery('JUL-196', configuration, { authorization, worktree, runPath: join(root, 'runs/JUL-196.json'), readCard: async () => card, launch: async () => assert.fail('protected or foreign workspace cannot dispatch') });
    assert.equal(result.outcome, 'park');
    assert.match(result.reason, /protected original|existing unrelated/);
  }
});


test('literal $init drives the authorized fixture journey and restarting reuses all saved inputs', async t => {
  const { runInit } = await import('./julia-init.mjs');
  const { source, base, runPath, git } = await candidateFixture(t);
  const settingsPath = join(dirname(runPath), 'settings.json');
  await mkdir(dirname(runPath), { recursive: true });
  const catalog = Object.values(configuration).map(chosen => ({ id: chosen.identity, displayName: chosen.identity, executableModelId: chosen.model, maker: chosen.maker, harness: chosen.harness, thinking: { supported: chosen.thinking ? [chosen.thinking] : false, default: chosen.thinking }, connection: { route: 'native', provider: null, endpoint: null, protocol: null, authReference: null } }));
  await writeFile(settingsPath, JSON.stringify({ catalog, builder: { model: 'claude', thinking: 'high' }, reviewer: { model: 'codex', thinking: null } }));
  let reads = 0, builds = 0, delivery;
  const dispatch = async (selected, context) => {
    const saved = JSON.parse(await readFile(context.runPath, 'utf8'));
    assert.deepEqual(saved.authorization.configuration, selected);
    delivery = await startDelivery(context.issueId, selected, {
      ...context, repoRoot: source, base,
      readCard: async () => { reads++; return { ...card, description: card.description + '\n## Seams\n`scripts/seam.test.mjs`' }; },
      test: async ({ worktree, run }) => ({ status: run === 'files' && git(worktree, 'rev-parse', 'HEAD') === base ? 1 : 0, output: 'literal journey fixture check' }),
      launch: async (role, request) => {
        if (role === 'builder') { builds++; await writeFile(join(request.worktree, 'scripts/seam.test.mjs'), 'regression'); return { exitCode: 0, observed: selected.builder }; }
        const handoff = JSON.parse(await readFile(request.handoffPath, 'utf8'));
        return { exitCode: 0, observed: selected.reviewer, text: `VERDICT: PASS\nCOMMIT: ${handoff.candidate.commit}` };
      },
    });
  };
  const first = await runInit('$init JUL-196', { authorization, settingsPath, stateDirectory: dirname(runPath), dispatch });
  assert.equal(delivery.outcome, 'pass', delivery.reason);
  await writeFile(settingsPath, '{}');
  await runInit('$init JUL-196', { settingsPath, stateDirectory: dirname(runPath), dispatch });
  assert.equal(reads, 1);
  assert.equal(builds, 1);
  const approved = JSON.parse(await readFile(join(dirname(runPath), 'JUL-196-approved.json'), 'utf8'));
  assert.deepEqual(approved.configuration, first.configuration);
  assert.deepEqual(approved.authorization.spending, authorization.spending);
});


test('production candidate uses real local Node checks and actual red/green assertions without a provider', async t => {
  const { source, runPath, git } = await candidateFixture(t);
  await writeFile(join(source, 'package.json'), JSON.stringify({ type: 'module', scripts: { 'lint:framework': 'node --check value.mjs' } }));
  await writeFile(join(source, 'value.mjs'), 'export const value = 1;');
  await writeFile(join(source, 'scripts/seam.test.mjs'), "import assert from 'node:assert/strict'; import { value } from '../value.mjs'; assert.equal(value, 1);");
  await writeFile(join(source, 'scripts/julia-runner-suite.mjs'), await readFile(new URL('./julia-runner-suite.mjs', import.meta.url), 'utf8'));
  git(source, 'add', '-A'); git(source, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'real checks base');
  const base = git(source, 'rev-parse', 'HEAD');
  const result = await startDelivery('JUL-196', configuration, {
    authorization, repoRoot: source, base, runPath,
    readCard: async () => ({ ...card, description: card.description + '\n## Seams\n`scripts/seam.test.mjs`' }),
    launch: async (role, request) => {
      if (role === 'builder') {
        await writeFile(join(request.worktree, 'value.mjs'), 'export const value = 2;');
        await writeFile(join(request.worktree, 'scripts/seam.test.mjs'), "import assert from 'node:assert/strict'; import { value } from '../value.mjs'; assert.equal(value, 2);");
        return { exitCode: 0, observed: configuration.builder };
      }
      const handoff = JSON.parse(await readFile(request.handoffPath, 'utf8'));
      assert.deepEqual(handoff.candidate.runs.map(run => run.status), [0, 1, 0, 0]);
      assert.match(handoff.candidate.runs[1].output, /1 !== 2/);
      assert.match(handoff.candidate.runs[3].output, /Runner suite: 1 files/);
      return { exitCode: 0, observed: configuration.reviewer, text: `VERDICT: PASS\nCOMMIT: ${handoff.candidate.commit}` };
    },
  });
  assert.equal(result.outcome, 'pass', result.reason);
});
