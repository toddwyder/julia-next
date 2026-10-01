// monday-note-integration.test.mjs -- issue #180 acceptance test:
// End-to-end integration test driving 5 realistic trace span shapes and Factory card records:
//   1. Fresh call
//   2. Cached call
//   3. Thinking-heavy call
//   4. Unpriced model call
//   5. Call with no token count
//
// Verifies normalization, pricing, note generation, provider totals, named gaps, and issue publishing.
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTraceSpans } from './mastra-traces.mjs';
import { buildMondayNote, publishMondayNote } from './monday-note.mjs';

const WEEK = { from: '2026-09-28T00:00:00.000Z', to: '2026-10-05T00:00:00.000Z' };

const integrationCards = [
  {
    number: 180,
    title: 'Weekly cost note',
    stages: ['done'],
    createdAt: '2026-09-28T09:00:00Z',
    acceptedAt: '2026-09-28T09:00:00Z',
    stageHistory: [
      { stage: 'planning', enteredAt: '2026-09-28T09:00:00Z', exitedAt: '2026-09-28T09:30:00Z', by: 'agent:r1', exitedBy: 'agent:r1' },
      { stage: 'execute', enteredAt: '2026-09-28T09:30:00Z', exitedAt: '2026-09-28T12:00:00Z', by: 'agent:r2', exitedBy: 'agent:r2' },
      { stage: 'review', enteredAt: '2026-09-28T12:00:00Z', exitedAt: '2026-09-28T12:45:00Z', by: 'agent:r3', exitedBy: 'agent:r3' },
      { stage: 'done', enteredAt: '2026-09-28T13:00:00Z', by: 'agent:r3' },
    ],
    sessions: { 'session-180': { sessionId: 'session-180', threadId: 't180' } },
  },
];

// 5 realistic Mastra trace span records matching the 5 required cases:
const integrationSpans = [
  // 1. Fresh call: deepseek/deepseek-chat (10,000 fresh in, 0 cached in, 1,000 out)
  // Rate: $0.27/M fresh, $1.10/M out -> 10k * $0.27/M = $0.0027 + 1k * $1.10/M = $0.0011 -> $0.0038 ($0.00)
  {
    id: 'span-fresh',
    sessionId: 'session-180',
    name: 'generate_plan',
    spanType: 'model_generation',
    status: 'ok',
    startedAt: '2026-09-28T09:05:00Z',
    endedAt: '2026-09-28T09:20:00Z',
    attributes: {
      model: 'deepseek/deepseek-chat',
      provider: 'deepseek',
      usage: {
        inputTokens: 10000,
        outputTokens: 1000,
        totalTokens: 11000,
      },
    },
  },
  // 2. Cached call: deepseek/deepseek-chat (5,000 fresh in, 45,000 cached in, 2,000 out)
  // Rate: $0.07/M cached, $0.27/M fresh, $1.10/M out -> 45k*$0.07/M = $0.00315 + 5k*$0.27/M = $0.00135 + 2k*$1.10/M = $0.0022 -> $0.0067 ($0.01)
  {
    id: 'span-cached',
    sessionId: 'session-180',
    name: 'execute_build_cached',
    spanType: 'model_generation',
    status: 'ok',
    startedAt: '2026-09-28T09:35:00Z',
    endedAt: '2026-09-28T10:15:00Z',
    attributes: {
      model: 'deepseek/deepseek-chat',
      provider: 'deepseek',
      usage: {
        inputTokens: 50000,
        outputTokens: 2000,
        totalTokens: 52000,
        inputDetails: {
          cacheRead: 45000,
        },
      },
    },
  },
  // 3. Thinking-heavy call: deepseek/deepseek-reasoner (20,000 fresh in, 80,000 cached in, 10,000 out with 6,000 thinking)
  // Rate: $0.14/M cached, $0.55/M fresh, $2.19/M out -> 80k*$0.14/M = $0.0112 + 20k*$0.55/M = $0.011 + 10k*$2.19/M = $0.0219 -> $0.0441 ($0.04)
  {
    id: 'span-thinking',
    sessionId: 'session-180',
    name: 'execute_build_reasoning',
    spanType: 'model_generation',
    status: 'ok',
    startedAt: '2026-09-28T10:20:00Z',
    endedAt: '2026-09-28T11:45:00Z',
    attributes: {
      model: 'deepseek/deepseek-reasoner',
      provider: 'deepseek',
      usage: {
        inputTokens: 100000,
        outputTokens: 10000,
        totalTokens: 110000,
        inputDetails: {
          cacheRead: 80000,
        },
        outputDetails: {
          reasoning: 6000,
        },
      },
    },
  },
  // 4. Unpriced model call: custom/experimental-v1
  {
    id: 'span-unpriced',
    sessionId: 'session-180',
    name: 'review_experimental',
    spanType: 'model_generation',
    status: 'ok',
    startedAt: '2026-09-28T12:05:00Z',
    endedAt: '2026-09-28T12:20:00Z',
    attributes: {
      model: 'custom/experimental-v1',
      provider: 'custom-ai',
      usage: {
        inputTokens: 15000,
        outputTokens: 1500,
        totalTokens: 16500,
      },
    },
  },
  // 5. Call with no token count: openai/gpt-4o with no usage recorded
  {
    id: 'span-no-tokens',
    sessionId: 'session-180',
    name: 'review_final',
    spanType: 'model_generation',
    status: 'ok',
    startedAt: '2026-09-28T12:25:00Z',
    endedAt: '2026-09-28T12:40:00Z',
    attributes: {
      model: 'openai/gpt-4o',
      provider: 'openai',
      // No usage object present
    },
  },
];

test('integration: end-to-end flow handles fresh, cached, thinking, unpriced and no-token calls into a published GitHub issue', async () => {
  // Step 1: Normalize trace spans
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

  // Step 3: Publish note through GitHub Issues adapter
  const publishedIssues = [];
  const fakeIssues = {
    find: async () => null,
    post: async ({ title, body, labels }) => {
      publishedIssues.push({ title, body, labels });
      return { id: 777, number: 181, url: 'https://github.com/toddwyder/julia-next/issues/181' };
    },
  };

  const publishResult = await publishMondayNote({ note, issues: fakeIssues });

  assert.equal(publishResult.posted, true);
  assert.equal(publishResult.url, 'https://github.com/toddwyder/julia-next/issues/181');
  assert.equal(publishedIssues.length, 1);
  assert.equal(publishedIssues[0].title, 'Monday note — week ending 2026-10-05');
  assert.deepEqual(publishedIssues[0].body, note.body);
});
