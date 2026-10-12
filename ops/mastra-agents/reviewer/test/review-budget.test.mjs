import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReviewBudget } from '../src/review-budget.mjs';
import { checkedFetch } from '../src/reviewer.mjs';

test('the durable budget reserves each request before dispatch and charges validated usage', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-budget-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let now = 1_000_000;
  const path = join(directory, 'budget.json');
  const budget = await createReviewBudget({ path, startedAt: now, now: () => now });

  const reservation = await budget.beforeRequest({ model: 'fixture', messages: [{ role: 'user', content: 'review' }] });
  const pending = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(pending.pending.maximumOutputTokens, 4096);
  assert.equal(pending.pending.maximumDurationMs, 120_000);
  assert.equal(pending.pending.maximumCostUsd, reservation.maximumCostUsd);

  await budget.recordResponse({ responseId: 'response-1', estimate: { cost: 0.001 } });
  const charged = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(charged.spentUsd, 0.001);
  assert.equal(charged.pending, null);
  assert.deepEqual(charged.responses, ['response-1']);

  now = 1_000_000 + 20 * 60 * 1000 - 120_000 + 1;
  await assert.rejects(budget.beforeRequest({ messages: [] }), /pending request would cross the 20 minute limit/);
});

test('the durable budget refuses a request whose worst-case price exceeds the authorization', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-budget-cost-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const budget = await createReviewBudget({ path: join(directory, 'budget.json'), maxUsd: 0.001 });
  await assert.rejects(budget.beforeRequest({ messages: [{ role: 'user', content: 'review' }] }), /pending request would cross the \$0\.001 limit/);
});

test('provider dispatch does not occur when the durable budget refuses the pending request', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-budget-dispatch-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const budget = await createReviewBudget({ path: join(directory, 'budget.json'), maxUsd: 0.001 });
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; throw new Error('must not dispatch'); };
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(
    checkedFetch('https://provider.invalid', { body: JSON.stringify({ messages: [{ role: 'user', content: 'review' }] }) }, budget.recordResponse, null, budget.beforeRequest),
    /pending request would cross the \$0\.001 limit/,
  );
  assert.equal(requests, 0);
});

test('a restart preserves charges and refuses to retry an unresolved paid request', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-budget-restart-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'budget.json');
  const first = await createReviewBudget({ path, startedAt: 10, now: () => 10 });
  await first.beforeRequest({ messages: [] });

  const resumedPending = await createReviewBudget({ path, startedAt: 10, now: () => 11 });
  await assert.rejects(resumedPending.beforeRequest({ messages: [] }), /unresolved paid request/);
  await resumedPending.recordResponse({ responseId: 'recovered-response', estimate: { cost: 0.002 } });

  await createReviewBudget({ path, startedAt: 10, now: () => 12 });
  const state = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(state.spentUsd, 0.002);
  assert.deepEqual(state.responses, ['recovered-response']);
});

test('separate run ledgers share the cumulative card ceiling', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-budget-card-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cardPath = join(directory, 'card.json');
  const first = await createReviewBudget({ path: join(directory, 'run-1.json'), cardPath, cardMaxUsd: 0.009 });
  await first.beforeRequest({ messages: [] });
  await first.recordResponse({ responseId: 'one', estimate: { cost: 0.0045 } });
  const second = await createReviewBudget({ path: join(directory, 'run-2.json'), cardPath, cardMaxUsd: 0.009 });
  await assert.rejects(second.beforeRequest({ messages: [] }), /cumulative card limit/);
});

test('malformed saved measurements and costs above a reservation fail closed', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-budget-invalid-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'budget.json');
  await writeFile(path, JSON.stringify({ maxUsd: 0.5, totalMs: 1_200_000, stepMs: 120_000, spentUsd: null, pending: null, responses: [] }));
  await assert.rejects(createReviewBudget({ path }), /saved budget is invalid/);
  await rm(path);
  const budget = await createReviewBudget({ path });
  await budget.beforeRequest({ messages: [] });
  await assert.rejects(budget.recordResponse({ responseId: 'too-expensive', estimate: { cost: 0.5 } }), /exceeds the reserved/);
});

test('future clocks, busy card ledgers, and mismatched reservations fail closed', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-budget-race-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const future = await createReviewBudget({ path: join(directory, 'future.json'), startedAt: 10, now: () => 9 });
  await assert.rejects(future.beforeRequest({ messages: [] }), /elapsed review time is invalid/);

  const cardPath = join(directory, 'card.json');
  const budget = await createReviewBudget({ path: join(directory, 'run.json'), cardPath });
  await writeFile(`${cardPath}.lock`, 'busy');
  await assert.rejects(budget.beforeRequest({ messages: [] }), /card ledger is busy/);
  await rm(`${cardPath}.lock`);
  await budget.beforeRequest({ messages: [] });
  const card = JSON.parse(await readFile(cardPath, 'utf8'));
  await writeFile(cardPath, JSON.stringify({ ...card, pending: null }));
  await assert.rejects(budget.recordResponse({ responseId: 'wrong-reservation', estimate: { cost: 0.001 } }), /does not match.*reservation/);
});
