import assert from 'node:assert/strict';
import { test } from 'node:test';

import { productionLauncher, runDelivery, startDelivery, workerPrompt } from './julia-delivery-runner.mjs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const configuration = {
  builder: { identity: 'claude', model: 'claude-sonnet', maker: 'Anthropic', harness: 'claude-code', thinking: 'high', connection: { route: 'native' } },
  reviewer: { identity: 'codex', model: 'gpt-review', maker: 'OpenAI', harness: 'codex', thinking: null, connection: { route: 'native' } },
};
const card = { identifier: 'JUL-196', title: 'A card', state: { name: 'Ready', type: 'unstarted' }, description: '## Acceptance criteria\n\n- [ ] It works.' };

test('Windows production launcher gets a response from installed Claude Code and persists its evidence', { skip: process.platform !== 'win32', timeout: 120000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'jul196-')); t.after(() => import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true })));
  const outputPath = join(root, 'evidence', 'JUL-196-builder-round-1.json');
  const builder = { ...configuration.builder, model: 'opus' };
  const before = Date.now();
  const result = await productionLauncher(process.cwd())('builder', {
    configuration: builder, outputPath,
    prompt: 'Reply with exactly JUL-196 runner launch OK. Do not use tools or change any files.',
  });
  const after = Date.now();
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
  const result = await productionLauncher(worktree)('builder', { configuration: builder, outputPath, prompt: 'This worker never starts.' });
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

test('Windows production launcher saves why installed Claude Code could not be found', { skip: process.platform !== 'win32', timeout: 30000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'jul196-')); t.after(() => import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true })));
  const outputPath = join(root, 'evidence', 'JUL-196-builder-round-1.json');
  const builder = { ...configuration.builder, model: 'opus' };
  // where.exe still runs from System32, but no Claude installation is on this PATH.
  const path = process.env.PATH; t.after(() => { process.env.PATH = path; });
  process.env.PATH = join(process.env.SystemRoot, 'System32');
  const result = await productionLauncher(root)('builder', { configuration: builder, outputPath, prompt: 'This worker is never found.' });
  process.env.PATH = path;
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

test('the builder receives the canonical implement instruction and saved approved inputs, not a discovered skill', () => {
  const prompt = workerPrompt('builder', card, configuration, 'C:/runs/JUL-196.json', 'C:/runs/JUL-196-approved.json');
  assert.match(prompt, /\.agents\/skills\/implement\/SKILL\.md/);
  assert.match(prompt, /C:\/runs\/JUL-196-approved\.json/);
  assert.match(prompt, /JUL-196/);
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
  const base = { readCard: async () => card, save: async () => {}, launch: async () => ({ exitCode: 0, observed: { harness: 'claude-code', model: 'x', maker: 'Anthropic' } }) };
  for (const candidate of [
    { commit: 'a'.repeat(40), clean: true, checks: { pass: false } },
    { commit: 'a'.repeat(40), clean: false, checks: { pass: true } },
  ]) {
    const result = await runDelivery({ issueId: 'JUL-196', configuration, runPath: 'C:/runs/JUL-196.json' }, { ...base, candidate: async () => candidate });
    assert.equal(result.outcome, 'park');
  }
});

test('a review fail returns findings for repair and three unsuccessful rounds park', async () => {
  let builds = 0;
  const result = await runDelivery({ issueId: 'JUL-196', configuration, runPath: 'C:/runs/JUL-196.json' }, {
    readCard: async () => card, save: async () => {},
    candidate: async () => ({ commit: String(++builds).padStart(40, 'a'), clean: true, checks: { pass: true } }),
    launch: async (role) => role === 'builder'
      ? { exitCode: 0, observed: { harness: 'claude-code', model: 'claude-sonnet', maker: 'Anthropic' } }
      : { exitCode: 0, observed: { harness: 'codex', model: 'gpt-review', maker: 'OpenAI' }, text: 'VERDICT: FAIL\nFinding: test missing' },
  });
  assert.equal(result.outcome, 'park');
  assert.equal(builds, 3);
});

test('resume uses the saved approved card without another Linear read, and records a terminal refusal', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'jul196-')); t.after(() => import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true })));
  const runPath = join(root, 'JUL-196.json');
  await writeFile(join(root, 'JUL-196-approved.json'), JSON.stringify({ card, configuration }));
  const result = await startDelivery('JUL-196', configuration, { runPath, worktree: root, readCard: async () => { throw new Error('must not read Linear'); } });
  assert.equal(result.outcome, 'park');
  assert.match(await readFile(join(root, 'JUL-196-state.json'), 'utf8'), /worker launcher|checks failed|worktree/);
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
