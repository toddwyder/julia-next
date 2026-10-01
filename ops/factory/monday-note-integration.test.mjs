// Record/replay at the pricing, reporting and GitHub Issues boundaries.
// Exact billing records captured through authenticated Mastra on 2026-10-01.
// Missing-price coverage changes only the input price dataset, never a trace.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeTraceSpans } from './mastra-traces.mjs';
import { PRICE_TABLE } from './price-table.mjs';
import { buildMondayNote, publishMondayNote } from './monday-note.mjs';
import { createIssuesClient, COST_NOTE_LABELS } from './monday-note-adapters.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/captured-records.json', import.meta.url), 'utf8'));
const { cards, spans, provenance } = fixture;
const WEEK = { from: '2026-09-28T00:00:00Z', to: '2026-10-05T00:00:00Z' };

test('captured fresh, cached, thinking and failed no-token calls reach the public Issues adapter', async () => {
  const traces = normalizeTraceSpans(spans, { cards });
  assert.equal(traces.length, 4);
  const scenario = name => traces.find(trace => trace.id === provenance.scenarios[name]);
  assert.deepEqual(scenario('fresh').tokens, { freshInput: 51497, cachedInput: 4096, output: 4162, thinking: 2276, total: 59755 });
  assert.ok(Math.abs(scenario('fresh').whatYouPayCost - .010234038) < 1e-12);
  assert.equal(scenario('cached').provider, 'openai');
  assert.equal(scenario('cached').tokens.cachedInput, 59904);
  assert.equal(scenario('cached').tokens.freshInput, 13495);
  assert.equal(scenario('cached').whatYouPayCost, 0, 'the captured connection is the approved Codex subscription');
  assert.equal(scenario('thinking').tokens.output, 475, '304 thinking tokens are already included in the 475 output tokens');
  assert.equal(scenario('thinking').tokens.thinking, 304);
  assert.deepEqual(scenario('noTokens').namedGaps, ['no_token_count']);
  assert.equal(scenario('noTokens').whatYouPayCost, null);

  const note = buildMondayNote({ cards, traces, ...WEEK });
  assert.equal(note.lines.length, 2);
  assert.match(note.body, /review .*no recorded board step/);
  assert.match(note.body, /deepseek-v4-flash \(deepseek\)/);
  assert.match(note.body, /gpt-6-sol \(openai\)/);
  assert.match(note.body, /effort:.*no token count thinking tokens/);
  assert.match(note.body, /Provider weekly totals \(what-you-pay\):/);
  assert.match(note.body, /deepseek: \$0\.01 known subtotal \+ no token count/);
  assert.match(note.body, /No token count: 1 call\(s\)/);

  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify(init.method === 'GET' ? [] : {
      number: 185, html_url: 'https://github.com/toddwyder/julia-next/issues/185',
    }), { status: init.method === 'GET' ? 200 : 201 });
  };
  const issues = createIssuesClient({ token: 'test', owner: 'toddwyder', repo: 'julia-next', fetchImpl });
  const result = await publishMondayNote({ note, issues });
  assert.equal(result.posted, true);
  assert.equal(requests.length, 2);
  const sent = JSON.parse(requests[1].init.body);
  assert.equal(sent.body, note.body);
  assert.equal(sent.title, note.title);
  assert.deepEqual(sent.labels, COST_NOTE_LABELS);
});

test('a captured model with a missing price line is a counted gap and keeps its real tokens', () => {
  const priceTable = { ...PRICE_TABLE };
  delete priceTable['openai/gpt-6-sol'];
  const span = spans.find(span => span.spanId === provenance.scenarios.priceFault);
  const traces = normalizeTraceSpans([span], { cards, priceTable });
  assert.deepEqual(traces[0].namedGaps, ['unpriced_model']);
  assert.equal(traces[0].tokens.cachedInput, 59904);
  const note = buildMondayNote({ cards: cards.filter(card => card.number === traces[0].card), traces, ...WEEK });
  assert.match(note.body, /Unpriced models: 1 call\(s\)/);
  assert.match(note.body, /unpriced model/);
  assert.doesNotMatch(note.body, /\$0\.00/);
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
