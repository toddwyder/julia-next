// monday-note-integration.test.mjs -- issue #180 acceptance test:
// End-to-end integration test driving 5 captured real trace span shapes and Factory card records:
//   1. Fresh call
//   2. Cached call
//   3. Thinking-heavy call
//   4. Unpriced model call
//   5. Call with no token count
//
// Verifies normalization, pricing, note generation, provider totals, named gaps, issue publishing,
// and that issues labeled `factory:machine` stay out of Factory intake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { normalizeTraceSpans } from './mastra-traces.mjs';
import { buildMondayNote, publishMondayNote } from './monday-note.mjs';
import { createIssuesClient, COST_NOTE_LABELS } from './monday-note-adapters.mjs';

const fixturePath = resolve(import.meta.dirname, 'fixtures/captured-records.json');
const { cards: integrationCards, spans: integrationSpans } = JSON.parse(readFileSync(fixturePath, 'utf8'));

const WEEK = { from: '2026-09-28T00:00:00.000Z', to: '2026-10-05T00:00:00.000Z' };

test('integration: end-to-end flow handles fresh, cached, thinking, unpriced and no-token calls into a published GitHub issue', async () => {
  // Step 1: Normalize captured real trace spans
  const traces = normalizeTraceSpans(integrationSpans, { cards: integrationCards });

  assert.equal(traces.length, 5);
  // Verify span 1 (fresh call)
  assert.equal(traces[0].tokens.freshInput, 10000);
  assert.equal(traces[0].tokens.cachedInput, 0);
  assert.equal(traces[0].tokens.output, 1000);
  assert.equal(traces[0].provider, 'deepseek');

  // Verify span 2 (cached call)
  assert.equal(traces[1].tokens.freshInput, 5000);
  assert.equal(traces[1].tokens.cachedInput, 45000);
  assert.equal(traces[1].tokens.output, 2000);

  // Verify span 3 (thinking-heavy call)
  assert.equal(traces[2].tokens.freshInput, 20000);
  assert.equal(traces[2].tokens.cachedInput, 80000);
  assert.equal(traces[2].tokens.output, 10000);
  assert.equal(traces[2].tokens.thinking, 6000);

  // Verify span 4 (unpriced model)
  assert.ok(traces[3].namedGaps.some((g) => g.startsWith('unpriced_model')));

  // Verify span 5 (no token count)
  assert.ok(traces[4].namedGaps.includes('no_token_count'));

  // Step 2: Build the Monday note
  const note = buildMondayNote({
    cards: integrationCards,
    traces,
    ...WEEK,
  });

  // Check card line and body assertions
  assert.equal(note.lines.length, 1);
  assert.equal(note.lines[0].number, 180);
  assert.equal(note.lines[0].waitsOnTodd, 0);

  // Step details assertions
  assert.match(note.body, /plan — Factory/);
  assert.match(note.body, /build — Factory/);
  assert.match(note.body, /review — Factory/);

  // Thinking tokens displayed beside effort
  assert.match(note.body, /effort: no recorded effort \(6\.0k thinking tokens\)/);

  // Model breakdown lines
  assert.match(note.body, /deepseek\/deepseek-chat \(deepseek\):/);
  assert.match(note.body, /deepseek\/deepseek-reasoner \(deepseek\):/);
  assert.match(note.body, /custom\/experimental-v1 \(custom-ai\):/);
  assert.match(note.body, /openai\/gpt-4o \(openai\):/);

  // Drivers line includes cached percentage and step counts
  assert.match(note.body, /Drivers: 4 steps/);
  assert.match(note.body, /cached input/);
  assert.match(note.body, /1 review round/);
  assert.match(note.body, /0 waits on Todd outside UAT/);

  // Provider totals section
  assert.match(note.body, /Provider weekly totals \(what-you-pay\):/);
  assert.match(note.body, /• deepseek:/);

  // Named gaps section includes counts for both unpriced model and missing tokens
  assert.match(note.body, /Named gaps:/);
  assert.match(note.body, /• No recorded effort: 3 step\(s\)/);
  assert.match(note.body, /• Unpriced models: 1 call\(s\)/);
  assert.match(note.body, /• No token count: 1 call\(s\)/);

  // Step 3: Publish note through real GitHub Issues adapter with mock fetch
  const requests = [];
  const mockFetch = async (url, opts) => {
    requests.push({ url, opts, body: opts.body ? JSON.parse(opts.body) : null });
    if (opts.method === 'GET') {
      return { ok: true, status: 200, json: async () => [] };
    }
    return {
      ok: true,
      status: 201,
      json: async () => ({ id: 777, number: 181, html_url: 'https://github.com/toddwyder/julia-next/issues/181', title: note.title }),
    };
  };

  const issuesClient = createIssuesClient({
    fetchImpl: mockFetch,
    token: 'test-token',
    owner: 'toddwyder',
    repo: 'julia-next',
  });

  const publishResult = await publishMondayNote({ note, issues: issuesClient });

  assert.equal(publishResult.posted, true);
  assert.equal(publishResult.url, 'https://github.com/toddwyder/julia-next/issues/181');
  assert.equal(requests.length, 2);
  const postReq = requests.find((r) => r.opts.method === 'POST');
  assert.ok(postReq);
  assert.equal(postReq.body.title, 'Monday note — week ending 2026-10-05');
  assert.equal(postReq.body.body, note.body);
  assert.deepEqual(postReq.body.labels, COST_NOTE_LABELS);
});

test('intake rule: GitHub issue with factory:machine label is ignored by Factory intake', async () => {
  const defaultRule = (ctx) => ({ type: 'upsertLinkedWorkItem', stage: 'intake', issue: ctx.issue });
  // Execute the existing rule from the app entry; there is no copied rule or
  // new production filter module. This seam avoids booting Factory in CI.
  const source = readFileSync(new URL('./app/src/mastra/index.ts', import.meta.url), 'utf8');
  const machineIssues = source.match(/const machineIssues = .*;/)?.[0];
  const body = source.match(/issueOpened: .*=> \{([\s\S]*?)\n  \},\n  pullRequestOpened:/)?.[1];
  assert.ok(machineIssues && body, 'the app Intake rule must be available');
  const issueOpened = new Function('defaultGithubRules', `${machineIssues}\nreturn context => {${body}};`)({ issueOpened: defaultRule });

  const costNoteCtx = { issue: { number: 185, labels: ['factory:machine', 'cost-note'], title: 'Monday note' } };
  const humanCtx = { issue: { number: 186, labels: ['feature'], title: 'Add feature' } };

  assert.equal(issueOpened(costNoteCtx), undefined, 'cost note issue with factory:machine must be ignored by intake');
  assert.deepEqual(issueOpened(humanCtx), { type: 'upsertLinkedWorkItem', stage: 'intake', issue: humanCtx.issue }, 'regular issue enters intake');
});
