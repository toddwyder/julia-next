import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { buildScorecard, cardForThread, cardWindows, findStops, priceThreadUsage, readPings, readThreads, renderScorecard, threadEvents, tracedCost } from './scorecard.mjs';
import { stopComment } from './stop-ping.mjs';
import { checkForToddGuard } from './linear-cli.mjs';
import { appendFileSync } from 'node:fs';

const T = iso => `2026-10-26T${iso}:00.000Z`;
const ms = iso => Date.parse(T(iso));
const opus = { provider: 'anthropic.messages', modelId: 'claude-opus-5-5' };
const user = (at, text) => ({ role: 'user', type: 'v2', createdAt: T(at), content: JSON.stringify({ parts: [{ type: 'text', text }] }) });
const assistant = (at, parts, metadata = opus) => ({ role: 'assistant', type: 'v2', createdAt: T(at), content: JSON.stringify({ metadata, parts }) });
const step = at => ({ type: 'step-start', createdAt: ms(at) });
const say = (at, text) => ({ type: 'text', text, createdAt: ms(at) });

// Two cards in one thread, as JUL-272 and JUL-273 ran on 26 October.
const rows = [
  user('18:00', 'Card: JUL-272 (https://linear.app/x). Build it.'),
  assistant('18:00', [step('18:01'), say('18:02', 'Starting.'), step('18:05'),
    { type: 'tool-invocation', createdAt: ms('18:06'), updatedAt: ms('18:20'), toolInvocation: { toolName: 'ask_user', args: { question: 'Which colour?' } } }]),
  user('18:20', ''),
  assistant('18:20', [step('18:21'), say('18:30', 'PR is open.')], { mastra: {} }),
  user('18:40', 'Looks good, merged.'),
  user('19:00', 'Start JUL-273'),
  assistant('19:00', [step('19:01'), { type: 'tool-invocation', createdAt: ms('19:02'), updatedAt: ms('19:05'), toolInvocation: { toolName: 'subagent', args: { agentType: 'execute', modelId: 'openai/gpt-6.1-sol' } } }, say('19:10', 'Ready for you.')]),
];
const thread = { id: 'thread-1', title: 'JUL-273 merged', usage: { promptTokens: 1_000_000, cachedInputTokens: 900_000, cacheCreationInputTokens: 90_000, cacheCreationInputTokens1h: 90_000, completionTokens: 10_000 }, events: threadEvents(rows) };
const prices = { anthropic: { models: { 'claude-opus-5-5': { cost: { input: 4, output: 20, cache_read: 0.2, cache_write: 5 } } } } };

test('kickoff messages split one thread into card windows', () => {
  const windows = cardWindows(thread, thread.events);
  assert.deepEqual(windows.map(w => [w.card, w.start, w.end]), [['JUL-272', ms('18:00'), ms('19:00')], ['JUL-273', ms('19:00'), Infinity]]);
});

test('a thread with no kickoff falls back to the JUL id in its title', () => {
  const t = { id: 't', title: 'JUL-274 trace probe', events: threadEvents([user('10:00', 'Reply ok.')]) };
  assert.deepEqual(cardWindows(t, t.events).map(w => w.card), ['JUL-274']);
});

test('a stop lasts from the last agent activity to the reply; an ask_user answer is not agent activity, and back-to-back user messages are one stop', () => {
  const stops = findStops(thread.events);
  assert.deepEqual(stops.map(s => [s.kind, (s.resumed - s.since) / 60_000]), [['question', 14], ['turn ended', 10]]);
  assert.equal(stops[0].question, 'Which colour?');
  assert.equal(stops[1].question, 'PR is open.');
});

// JUL-272 on 26 October: the agent resumed one second after the answer, before the empty user row was written.
test('an ask_user wait ends at the answer, even when the agent resumes before the user row is written', () => {
  const at = s => Date.parse(`2026-10-26T${s}.000Z`);
  const events = threadEvents([
    { role: 'user', type: 'v2', createdAt: '2026-10-26T19:00:53.000Z', content: JSON.stringify({ parts: [{ type: 'text', text: 'continue' }] }) },
    { role: 'assistant', type: 'v2', createdAt: '2026-10-26T19:00:58.000Z', content: JSON.stringify({ metadata: opus, parts: [
      { type: 'text', text: 'PR is open.', createdAt: at('19:00:58') },
      { type: 'tool-invocation', createdAt: at('19:00:58'), updatedAt: at('19:30:18'), toolInvocation: { toolName: 'ask_user', args: { question: 'Merge it?' } } },
      { type: 'step-start', createdAt: at('19:30:19') - 400 },
    ] }) },
    { role: 'user', type: 'v2', createdAt: '2026-10-26T19:30:19.000Z', content: JSON.stringify({ parts: [{ type: 'text', text: '' }] }) },
  ]);
  const stops = findStops(events);
  assert.deepEqual(stops.map(s => [s.kind, s.question, Math.round((s.resumed - s.since) / 1000)]), [['question', 'Merge it?', 1760]]);
});

test('thread usage is split into fresh input, cache reads, cache writes and output, with 1-hour writes at 1.6x', () => {
  const priced = priceThreadUsage(thread.usage, prices.anthropic.models['claude-opus-5-5'].cost);
  assert.deepEqual(priced.tokens, { input: 10_000, cacheRead: 900_000, cacheWrite: 90_000, output: 10_000 });
  assert.equal(priced.usd.toFixed(4), (0.04 + 0.18 + 0.72 + 0.2).toFixed(4));
  assert.deepEqual(priceThreadUsage(thread.usage, undefined).parts, undefined);
});

test('traced cost sums only the two total metrics, so detail metrics are not counted twice', () => {
  const metric = (name, value, estimatedCost) => ({ entityName: 'Code Agent', provider: 'anthropic', model: 'claude-opus-5-5', name, value, estimatedCost });
  const rowsOut = tracedCost([
    metric('mastra_model_total_input_tokens', 100, 0.3), metric('mastra_model_total_output_tokens', 10, 0.2),
    metric('mastra_model_input_cache_read_tokens', 80, 0.1), metric('mastra_model_input_cache_write_tokens', 10, 0.2),
    { ...metric('mastra_model_total_input_tokens', 50, null), entityName: 'Explore Subagent', provider: 'commandcode', model: 'deepseek/deepseek-v4.1-flash' },
  ]);
  assert.equal(rowsOut[0].usd, 0.5);
  assert.deepEqual([rowsOut[1].agent, rowsOut[1].unpriced, rowsOut[1].usd], ['Explore Subagent', true, 0]);
});

test('a card scorecard prices its share of the thread, lists its subagents and judges success against Todd\'s UAT yes', () => {
  const pulls = [{ number: 358, headRefName: 'feat/jul-273-x', createdAt: T('19:20'), mergedAt: T('19:40') }];
  const s = buildScorecard({ card: 'JUL-273', threads: [thread], prices, tracing: { metrics: [], requested: [] }, pulls, pings: [], uat: { yesAt: T('19:30'), said: 'Yes.' } });
  assert.equal(s.cost[0].basis, '25% of thread total (1 of 4 model steps)');
  assert.equal(s.cost[0].usd.toFixed(4), (1.14 / 4).toFixed(4));
  assert.deepEqual(s.cost[1], { agent: 'Subagent execute x1', requested: 'openai/gpt-6.1-sol', answered: 'not recorded before tracing', tokens: {}, usd: 0, unpriced: true, basis: 'usage not recorded before tracing' });
  assert.deepEqual([s.stops.length, s.success], [0, true]);

  // JUL-272 as Todd ruled it: a stop before the yes counts, even with the PR already open.
  const card272 = uat => buildScorecard({ card: 'JUL-272', threads: [thread], prices, tracing: { metrics: [], requested: [] }, pulls: [{ ...pulls[0], headRefName: 'feat/jul-272-y', createdAt: T('18:05') }], pings: [], uat });
  const plain = card272({ yesAt: T('18:40'), said: 'Looks good, merged.' });
  assert.deepEqual(plain.stops.map(x => [x.counts, Boolean(x.isUatWait)]), [[true, false], [false, true]]);
  assert.deepEqual([plain.stopsBeforeUat, plain.success], [1, false]);
  assert.match(renderScorecard(plain, new Date(ms('20:00'))), /Success: \*\*no\*\*\. Stops before Todd's UAT yes: 1/);
  assert.match(renderScorecard(plain, new Date(ms('20:00'))), /1\. Asked at 2026-10-26 18:06:\n\n   > Which colour\?/);
  assert.equal(card272({ yesAt: T('18:40'), said: 'Yes', alsoAsked: 'for a secret' }).stopsBeforeUat, 2);
  assert.equal(card272(undefined).success, undefined);
});

test('missing run records cannot establish success or zero spend', () => {
  const s = buildScorecard({ card: 'JUL-272', threads: [], prices, tracing: { metrics: [], requested: [] }, pulls: [], pings: [], uat: { yesAt: T('18:40'), said: 'Yes' } });
  assert.equal(s.success, undefined);
  const markdown = renderScorecard(s);
  assert.match(markdown, /no matching run records/);
  assert.match(markdown, /Cost: \*\*unknown\*\*/);
  assert.doesNotMatch(markdown, /every row priced|\$0\.00/);
});

test('detailed stop replies retain their complete multiline text', () => {
  const reply = 'A long reply '.repeat(30) + '\nIMPORTANT_END_OF_REPLY';
  const events = threadEvents([user('18:00', 'Card: JUL-272'), assistant('18:01', [step('18:01'), say('18:02', 'Ready?')]), user('18:20', reply)]);
  const s = buildScorecard({ card: 'JUL-272', threads: [{ ...thread, events }], prices, tracing: { metrics: [], requested: [] }, pulls: [], pings: [] });
  assert.match(renderScorecard(s), /\n   > IMPORTANT_END_OF_REPLY/);
});

test('a stop takes only a ping recorded inside it, never one from just before', () => {
  const ping = at => ({ id: at, at: T(at), thread: 'thread-1', card: 'JUL-272', comment: `https://linear.app/${at}`, notified: true });
  const s = buildScorecard({ card: 'JUL-272', threads: [thread], prices, tracing: { metrics: [], requested: [] }, pulls: [], pings: [ping('18:03'), ping('18:31')] });
  assert.deepEqual(s.stops.map(x => x.ping?.id), [undefined, '18:31']);
});

test('mastra.db is read the way Mastra Code stores it, and a session maps to its card', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scorecard-db-'));
  try {
    const db = new DatabaseSync(join(dir, 'mastra.db'));
    db.exec('create table mastra_threads (id text, title text, metadata text); create table mastra_messages (thread_id text, role text, type text, createdAt text, content text)');
    db.prepare('insert into mastra_threads values (?, ?, ?)').run('thread-1', 'Some title', JSON.stringify({ tokenUsage: thread.usage }));
    for (const r of rows) db.prepare('insert into mastra_messages values (?, ?, ?, ?, ?)').run('thread-1', r.role, r.type, r.createdAt, r.content);
    db.close();
    assert.equal(readThreads(join(dir, 'mastra.db'))[0].events.steps.length, 4);
    assert.equal(cardForThread(join(dir, 'mastra.db'), 'thread-1'), 'JUL-273');
    assert.equal(cardForThread(join(dir, 'mastra.db'), 'other'), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stop and ping lines with one id merge into one record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scorecard-stops-'));
  try {
    const file = join(dir, 'stops.jsonl');
    appendFileSync(file, JSON.stringify({ id: 'a', at: T('18:06'), thread: 'thread-1', card: 'JUL-272', reason: 'ask_question' }) + '\n');
    appendFileSync(file, JSON.stringify({ id: 'a', comment: 'https://linear.app/c', notified: false }) + '\n');
    assert.deepEqual(readPings(file), [{ id: 'a', at: T('18:06'), thread: 'thread-1', card: 'JUL-272', reason: 'ask_question', comment: 'https://linear.app/c', notified: false }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every stop comment mentions Todd and passes the For-Todd guard', () => {
  for (const reason of ['ask_question', 'tool_approval', 'plan_approval', 'sandbox_access', 'agent_done', 'something_new']) {
    const body = stopComment({ reason, message: 'Which colour?\nRed or blue', thread: 'thread-1' });
    assert.match(body, /^https:\/\/linear\.app\/julia-next\/profiles\/toddwyder /);
    assert.match(body, /> Which colour\?\n> Red or blue/);
    assert.deepEqual(checkForToddGuard(body), { ok: true });
  }
});

// Replays the JUL-208 scorecard merged in #360: 53.6M cache-read tokens on one
// unpriced row, and the headline said "$0.00".
test('a headline never states a dollar total that unpriced rows leave out', () => {
  const row = { agent: 'Code Agent (main chat)', requested: 'anthropic.messages/claude-opus-5-5, commandcode.chat/deepseek/deepseek-v4.1-flash', answered: 'not recorded before tracing', tokens: { input: 1.04e6, cacheRead: 53.6e6, cacheWrite: 312.9e3, output: 387.4e3 }, usd: 0, unpriced: true, basis: 'thread total; no published price' };
  const base = { card: 'JUL-208', windows: 1, runs: [], stops: [], stopsBeforeUat: 0, pull: undefined, uat: undefined };
  const allUnpriced = renderScorecard({ ...base, cost: [row], usd: 0 });
  assert.doesNotMatch(allUnpriced, /Cost: \*\*\$/);
  assert.match(allUnpriced, /Cost: \*\*unknown\*\*/);
  const priced = { ...row, agent: 'Code Agent', tokens: {}, usd: 5.66, unpriced: false };
  const someUnpriced = renderScorecard({ ...base, cost: [priced, row], usd: 5.66 });
  assert.match(someUnpriced, /Cost: \*\*at least \$5\.66\*\*/);
  assert.match(renderScorecard({ ...base, cost: [priced], usd: 5.66 }), /Cost: \*\*\$5\.66\*\* at published API prices, every row priced/);
});
