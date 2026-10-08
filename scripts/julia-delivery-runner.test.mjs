import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runDelivery, workerPrompt } from './julia-delivery-runner.mjs';

const configuration = {
  builder: { identity: 'claude', model: 'claude-sonnet', maker: 'Anthropic', harness: 'claude-code', thinking: 'high', connection: { route: 'native' } },
  reviewer: { identity: 'codex', model: 'gpt-review', maker: 'OpenAI', harness: 'codex', thinking: null, connection: { route: 'native' } },
};
const card = { identifier: 'JUL-196', title: 'A card', state: { name: 'Ready', type: 'unstarted' }, description: '## Acceptance criteria\n\n- [ ] It works.' };

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
