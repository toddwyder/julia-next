import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

  await budget.recordResponse({ responseId: 'response-1', estimate: { cost: 0.01 } });
  const charged = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(charged.spentUsd, 0.01);
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
  await resumedPending.recordResponse({ responseId: 'recovered-response', estimate: { cost: 0.02 } });

  await createReviewBudget({ path, startedAt: 10, now: () => 12 });
  const state = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(state.spentUsd, 0.02);
  assert.deepEqual(state.responses, ['recovered-response']);
});
