import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { recoverDeliveryCrash } from './julia-delivery-recovery.mjs';

test('a Codex recovery fix is independently reviewed by unpinned Gemini, verified, and preserves the Julia candidate', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'delivery-real-recovery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const crashPath = join(directory, 'crash.json');
  await writeFile(crashPath, `${JSON.stringify({
    incidentId: 'incident-1', step: 'reviewer-launch', candidateCommit: 'candidate-1',
    providerAcceptance: 'not-accepted', costUsd: 0, reason: 'fault injection',
  })}\n`);
  const calls = [];
  let sourceCommit = 'source-before';
  let sourceDirty = false;
  const result = await recoverDeliveryCrash({
    crashPath, runDirectory: directory, repoRoot: 'C:\\delivery-source',
    candidate: { path: 'C:\\julia-candidate', commit: 'candidate-1' },
    configuration: {
      builder: { identity: 'openai-codex-builder', harness: 'codex', model: null, maker: 'OpenAI', thinking: 'high' },
      recoveryReviewer: { identity: 'google-gemini-recovery-reviewer', harness: 'agy', model: null, maker: 'Google', thinking: 'medium' },
    },
    authorizedUsd: 1,
  }, {
    git: (cwd, ...args) => {
      if (cwd === 'C:\\julia-candidate' && args.join(' ') === 'rev-parse HEAD') return 'candidate-1';
      if (cwd === 'C:\\julia-candidate' && args.join(' ') === 'status --porcelain') return '';
      if (cwd === 'C:\\delivery-source' && args.join(' ') === 'rev-parse HEAD') return sourceCommit;
      if (cwd === 'C:\\delivery-source' && args.join(' ') === 'status --porcelain') return sourceDirty ? ' M scripts/fault.mjs' : '';
      if (cwd === 'C:\\delivery-source' && args.join(' ') === 'add -A') return '';
      if (cwd === 'C:\\delivery-source' && args.at(-2) === '-m') { sourceCommit = 'source-after'; sourceDirty = false; return ''; }
      if (cwd === 'C:\\delivery-source' && args[0] === 'diff') return 'diff --git a/fault b/fault\n-fixed\n+working';
      throw new Error(`unexpected git: ${cwd} ${args.join(' ')}`);
    },
    fix: async request => {
      calls.push(['fix', request]);
      assert.equal(request.configuration.model, null);
      assert.match(request.prompt, /diagnosing-bugs\/SKILL\.md/);
      assert.match(request.prompt, /Do not run the complete runner suite/);
      assert.match(request.prompt, /Do not put TEMP or TMP inside the repository/);
      sourceDirty = true;
      return {
        exitCode: 0,
        observed: { maker: 'OpenAI', model: 'gpt-current', cliVersion: 'codex-cli current' },
        text: `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'The reviewer launcher referenced a nonexistent entry point; restored reviewer.mjs.' } })}\n`,
      };
    },
    review: async request => {
      calls.push(['review', request]);
      assert.equal(request.configuration.model, null);
      return { exitCode: 0, text: 'VERDICT: PASS', observed: { maker: 'Google', model: 'gemini-current', cliVersion: 'agy current' }, usage: { inputTokens: 10, outputTokens: 2 } };
    },
    verify: async () => { calls.push(['verify']); return { status: 0, output: 'all runner tests passed' }; },
  });

  assert.equal(result.status, 'RESUME');
  assert.equal(result.recoveryCommit, 'source-after');
  assert.equal(result.rootCause, 'The reviewer launcher referenced a nonexistent entry point; restored reviewer.mjs.');
  assert.deepEqual(result.fixer, { identity: 'openai-codex-builder', maker: 'OpenAI', model: 'gpt-current', cliVersion: 'codex-cli current' });
  assert.deepEqual(result.reviewer, { identity: 'google-gemini-recovery-reviewer', maker: 'Google', model: 'gemini-current', cliVersion: 'agy current' });
  assert.equal(result.reviewBypassedFailedStep, true);
  assert.equal(result.verificationResult, 'PASS');
  assert.deepEqual(calls.map(([kind]) => kind), ['fix', 'review', 'verify']);
  assert.deepEqual(JSON.parse(await readFile(result.evidencePath, 'utf8')), result);
});

test('a recovery fix without a durable Codex diagnosis parks before independent review', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'delivery-recovery-missing-diagnosis-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const crashPath = join(directory, 'crash.json');
  await writeFile(crashPath, `${JSON.stringify({
    incidentId: 'incident-missing-diagnosis', step: 'reviewer-launch', candidateCommit: 'candidate-1',
    providerAcceptance: 'not-accepted', costUsd: 0,
  })}\n`);
  let sourceCommit = 'before';
  let sourceDirty = false;
  let reviewed = false;
  const result = await recoverDeliveryCrash({
    crashPath, runDirectory: directory, repoRoot: 'source', candidate: { path: 'candidate', commit: 'candidate-1' },
    configuration: {
      builder: { identity: 'codex', harness: 'codex', maker: 'OpenAI', model: null },
      recoveryReviewer: { identity: 'gemini', harness: 'agy', maker: 'Google', model: null },
    }, authorizedUsd: 0,
  }, {
    git: (cwd, ...args) => {
      if (cwd === 'candidate' && args.join(' ') === 'rev-parse HEAD') return 'candidate-1';
      if (cwd === 'candidate' && args.join(' ') === 'status --porcelain') return '';
      if (cwd === 'source' && args.join(' ') === 'rev-parse HEAD') return sourceCommit;
      if (cwd === 'source' && args.join(' ') === 'status --porcelain') return sourceDirty ? ' M fault.mjs' : '';
      if (cwd === 'source' && args.join(' ') === 'add -A') return '';
      if (cwd === 'source' && args.at(-2) === '-m') { sourceCommit = 'after'; sourceDirty = false; return ''; }
      throw new Error(`unexpected git: ${cwd} ${args.join(' ')}`);
    },
    fix: async () => {
      sourceDirty = true;
      return { exitCode: 0, observed: { maker: 'OpenAI', model: 'gpt-current' }, text: '{"type":"turn.completed"}\n' };
    },
    review: async () => { reviewed = true; return { exitCode: 0, text: 'VERDICT: PASS', observed: { maker: 'Google', model: 'gemini-current' } }; },
  });

  assert.equal(result.status, 'PARK');
  assert.match(result.reason, /durable root-cause diagnosis/);
  assert.equal(reviewed, false);
  assert.deepEqual(JSON.parse(await readFile(result.evidencePath, 'utf8')), result);
});

test('same-maker recovery review parks before verification', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'delivery-recovery-maker-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const crashPath = join(directory, 'crash.json');
  await writeFile(crashPath, `${JSON.stringify({ incidentId: 'incident-2', step: 'reviewer-launch', candidateCommit: 'candidate-1', providerAcceptance: 'not-accepted', costUsd: 0 })}\n`);
  let sourceCommit = 'before';
  let verified = false;
  const git = (cwd, ...args) => {
    if (args.join(' ') === 'status --porcelain') return '';
    if (cwd === 'candidate') return 'candidate-1';
    if (args.join(' ') === 'rev-parse HEAD') return sourceCommit;
    if (args[0] === 'diff') return 'a diff';
    throw new Error('unexpected git');
  };
  const result = await recoverDeliveryCrash({
    crashPath, runDirectory: directory, repoRoot: 'source', candidate: { path: 'candidate', commit: 'candidate-1' },
    configuration: { builder: { identity: 'codex', harness: 'codex', maker: 'OpenAI', model: null }, recoveryReviewer: { identity: 'bad', harness: 'agy', maker: 'OpenAI', model: null } }, authorizedUsd: 1,
  }, {
    git,
    fix: async () => { sourceCommit = 'after'; return { exitCode: 0, observed: { maker: 'OpenAI', model: 'gpt-current' } }; },
    review: async () => ({ exitCode: 0, text: 'VERDICT: PASS', observed: { maker: 'OpenAI', model: 'another' } }),
    verify: async () => { verified = true; return { status: 0, output: '' }; },
  });
  assert.equal(result.status, 'PARK');
  assert.match(result.reason, /same maker/);
  assert.equal(verified, false);
});

test('a failed Gemini recovery review retains its diagnostic text and artifact paths', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'delivery-recovery-review-failure-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const crashPath = join(directory, 'crash.json');
  await writeFile(crashPath, `${JSON.stringify({ incidentId: 'incident-3', step: 'reviewer-launch', candidateCommit: 'candidate-1', providerAcceptance: 'not-accepted', costUsd: 0 })}\n`);
  let sourceCommit = 'before';
  let sourceDirty = false;
  let verified = false;
  const result = await recoverDeliveryCrash({
    crashPath, runDirectory: directory, repoRoot: 'source', candidate: { path: 'candidate', commit: 'candidate-1' },
    configuration: {
      builder: { identity: 'codex', harness: 'codex', maker: 'OpenAI', model: null },
      recoveryReviewer: { identity: 'gemini', harness: 'agy', maker: 'Google', model: null },
    }, authorizedUsd: 0,
  }, {
    git: (cwd, ...args) => {
      if (cwd === 'candidate' && args.join(' ') === 'rev-parse HEAD') return 'candidate-1';
      if (cwd === 'candidate' && args.join(' ') === 'status --porcelain') return '';
      if (cwd === 'source' && args.join(' ') === 'rev-parse HEAD') return sourceCommit;
      if (cwd === 'source' && args.join(' ') === 'status --porcelain') return sourceDirty ? ' M fault.mjs' : '';
      if (cwd === 'source' && args.join(' ') === 'add -A') return '';
      if (cwd === 'source' && args.at(-2) === '-m') { sourceCommit = 'after'; sourceDirty = false; return ''; }
      if (cwd === 'source' && args[0] === 'diff') return 'a recovery diff';
      throw new Error(`unexpected git: ${cwd} ${args.join(' ')}`);
    },
    fix: async () => {
      sourceDirty = true;
      return {
        exitCode: 0,
        observed: { maker: 'OpenAI', model: 'gpt-current' },
        text: `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'The injected launcher fault caused the crash; corrected that launcher boundary.' } })}\n`,
      };
    },
    review: async () => ({
      exitCode: 1, text: 'agy delivery turn did not finish', observed: null,
      outputPath: join(directory, 'review.stdout.jsonl'), stderrPath: join(directory, 'review.stderr.txt'), logPath: join(directory, 'review.agy.log'),
    }),
    verify: async () => { verified = true; return { status: 0, output: '' }; },
  });
  assert.equal(result.status, 'PARK');
  assert.deepEqual(result.reviewEvidence, {
    text: 'agy delivery turn did not finish',
    outputPath: join(directory, 'review.stdout.jsonl'),
    stderrPath: join(directory, 'review.stderr.txt'),
    logPath: join(directory, 'review.agy.log'),
  });
  assert.equal(verified, false);
  assert.deepEqual(JSON.parse(await readFile(result.evidencePath, 'utf8')), result);
});
