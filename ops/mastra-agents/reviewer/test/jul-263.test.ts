import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { z } from 'zod/v4';

import { startControlPageServer } from '../src/mastra/control-page.ts';
import { BuildJobSchema, BuildChecklistSchema } from '../src/mastra/build-client.ts';
import {
  ControlPageStateSchema,
  InitializationActivitySchema,
  InitializationRunsStateSchema,
  ReadyCardSchema,
  RunSnapshotSchema,
  InitializationRolesSchema,
  InitializationResultSchema,
  StartInitializationSchema,
} from '../src/mastra/contracts.ts';

const card = ReadyCardSchema.parse({
  identifier: 'JUL-263',
  title: 'Live view',
  state: 'Ready',
  description: '## Outcome\n\nDashboard checklist\n\n## Requirements\n\nLive ticks\n\n## Contracts\n\nRunner job record\n\n## Acceptance criteria\n\n* Shows the checklist\n\n## Proof\n\nBeam practice build',
});

const selection = {
  route: 'commandcode',
  modelId: 'reflection/beam:free',
  company: 'Reflection',
  service: 'CommandCode',
  effort: 'medium',
  wire: 'chat',
} as const;

const roles = InitializationRolesSchema.parse({ orchestrator: selection, coder: selection });
const offer = {
  route: 'commandcode',
  modelId: 'reflection/beam:free',
  name: 'Beam',
  company: 'Reflection',
  service: 'CommandCode',
  codingCapable: true as const,
  supportedEfforts: ['medium' as const],
  wire: 'chat' as const,
};

const iso = new Date('2026-10-24T12:00:00.000Z').toISOString();
const snapshot = RunSnapshotSchema.parse({
  runId: 'jul-263-live-test',
  card,
  roles,
  state: 'ready-for-build',
  initializedAt: iso,
});

const activity = InitializationActivitySchema.parse({
  roleDispatches: { builder: 0, reviewer: 0, crashFixer: 0, crashReviewer: 0 },
  llmInferenceCalls: 0,
  linearQueries: 0,
  linearMutations: 0,
});

type ChecklistStatus = 'finished' | 'skipped' | 'pending';

function checklist(items: { text: string; status: ChecklistStatus; depth: number }[]) {
  const summary = { finished: 0, skipped: 0, pending: 0 };
  for (const item of items) summary[item.status] += 1;
  return { items, summary, updatedAt: iso };
}

function runningJob(items: { text: string; status: ChecklistStatus; depth: number }[]) {
  return BuildJobSchema.parse({
    runId: snapshot.runId,
    snapshot,
    runnerPid: 123,
    workerPid: 124,
    worktree: '/tmp/practice',
    baseCommit: 'a'.repeat(40),
    state: 'running',
    result: null,
    error: null,
    checklist: checklist(items),
  });
}

test('the dashboard shows the running build checklist and its ticks move', async () => {
  let job = runningJob([
    { text: 'Read the card', status: 'finished', depth: 0 },
    { text: 'Write the test', status: 'pending', depth: 0 },
    { text: 'Run the test', status: 'pending', depth: 0 },
  ]);

  const server = await startControlPageServer({
    port: 0,
    getState: async () => ControlPageStateSchema.parse({ cards: [{ admitted: true, card }], offers: [offer] }),
    startInitialization: async (input: z.infer<typeof StartInitializationSchema>) => {
      assert.deepEqual(input, { card, roles });
      return InitializationResultSchema.parse({ runId: snapshot.runId, state: 'ready-for-build', snapshot, resumed: false });
    },
    getRuns: async () => InitializationRunsStateSchema.parse({ runs: [], totalRuns: 0 }),
    getActivity: () => activity,
    getBuildJobs: async () => [job],
  });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(server.url);

    const checklist = page.locator('.dashboard [data-testid="live-checklist"]');
    await checklist.waitFor({ state: 'visible', timeout: 10000 });
    await page.getByRole('heading', { name: 'JUL-263 · running', exact: true }).waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await checklist.locator('[data-testid="live-checklist-item"]').count(), 3);
    assert.equal(await checklist.locator('[data-status="finished"]').count(), 1);
    assert.match(await checklist.textContent() ?? '', /1 finished, 0 skipped, 2 pending/);

    job = runningJob([
      { text: 'Read the card', status: 'finished', depth: 0 },
      { text: 'Write the test', status: 'finished', depth: 0 },
      { text: 'Run the test', status: 'pending', depth: 0 },
    ]);

    await page.waitForFunction(() => document.querySelectorAll('[data-testid="live-checklist"] [data-status="finished"]').length === 2, undefined, { timeout: 10000 });
    assert.equal(await checklist.locator('[data-status="finished"]').count(), 2);
    assert.match(await checklist.textContent() ?? '', /2 finished, 0 skipped, 1 pending/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test('skipped steps show as skipped, distinct from pending, with their own count', async () => {
  const job = runningJob([
    { text: 'Read the subsystem', status: 'skipped', depth: 0 },
    { text: 'Explore the design', status: 'skipped', depth: 0 },
    { text: 'Write the checkpoint', status: 'skipped', depth: 0 },
    { text: 'Delegate the code', status: 'finished', depth: 0 },
    { text: 'Verify the bytes', status: 'finished', depth: 0 },
    { text: 'Make one commit', status: 'finished', depth: 0 },
    { text: 'Interrogate the design', status: 'skipped', depth: 0 },
    { text: 'Open a pull request', status: 'skipped', depth: 0 },
  ]);

  const server = await startControlPageServer({
    port: 0,
    getState: async () => ControlPageStateSchema.parse({ cards: [{ admitted: true, card }], offers: [offer] }),
    startInitialization: async (input: z.infer<typeof StartInitializationSchema>) => {
      assert.deepEqual(input, { card, roles });
      return InitializationResultSchema.parse({ runId: snapshot.runId, state: 'ready-for-build', snapshot, resumed: false });
    },
    getRuns: async () => InitializationRunsStateSchema.parse({ runs: [], totalRuns: 0 }),
    getActivity: () => activity,
    getBuildJobs: async () => [job],
  });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(server.url);
    const checklist = page.locator('.dashboard [data-testid="live-checklist"]');
    await checklist.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await checklist.locator('[data-status="skipped"]').count(), 5);
    assert.equal(await checklist.locator('[data-status="finished"]').count(), 3);
    assert.equal(await checklist.locator('[data-status="pending"]').count(), 0);
    assert.equal(await checklist.locator('.checklist-badge').count(), 5);
    assert.match(await checklist.textContent() ?? '', /3 finished, 5 skipped/);
    assert.doesNotMatch(await checklist.textContent() ?? '', /pending/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test('a job checklist is validated and kept on the job record', () => {
  const parsed = BuildChecklistSchema.parse({
    items: [{ text: 'Read the card', status: 'finished', depth: 0 }],
    summary: { finished: 1, skipped: 0, pending: 0 },
    updatedAt: iso,
  });
  assert.deepEqual(parsed.items, [{ text: 'Read the card', status: 'finished', depth: 0 }]);
  assert.deepEqual(parsed.summary, { finished: 1, skipped: 0, pending: 0 });
  assert.throws(() => BuildJobSchema.parse({ ...runningJob([]), checklist: { items: [{ text: '', status: 'pending' }], summary: { finished: 0, skipped: 0, pending: 1 } } }));
  assert.throws(() => BuildJobSchema.parse({ ...runningJob([]), checklist: { items: [], summary: { finished: 0, skipped: 0, pending: 1 } } }));
});
