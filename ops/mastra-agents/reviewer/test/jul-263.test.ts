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

function runningJob(items: { text: string; done: boolean; depth: number }[]) {
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
    checklist: { items, updatedAt: iso },
  });
}

test('the dashboard shows the running build checklist and its ticks move', async () => {
  let job = runningJob([
    { text: 'Read the card', done: true, depth: 0 },
    { text: 'Write the test', done: false, depth: 0 },
    { text: 'Run the test', done: false, depth: 0 },
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
    assert.equal(await checklist.locator('[data-done="true"]').count(), 1);
    assert.match(await checklist.textContent() ?? '', /1 of 3 steps finished/);

    job = runningJob([
      { text: 'Read the card', done: true, depth: 0 },
      { text: 'Write the test', done: true, depth: 0 },
      { text: 'Run the test', done: false, depth: 0 },
    ]);

    await page.waitForFunction(() => document.querySelectorAll('[data-testid="live-checklist"] [data-done="true"]').length === 2, undefined, { timeout: 10000 });
    assert.equal(await checklist.locator('[data-done="true"]').count(), 2);
    assert.match(await checklist.textContent() ?? '', /2 of 3 steps finished/);
  } finally {
    await browser.close();
    await server.close();
  }
});

test('a job checklist is validated and kept on the job record', () => {
  const parsed = BuildChecklistSchema.parse({
    items: [{ text: 'Read the card', done: true, depth: 0 }],
    updatedAt: iso,
  });
  assert.deepEqual(parsed.items, [{ text: 'Read the card', done: true, depth: 0 }]);
  assert.throws(() => BuildJobSchema.parse({ ...runningJob([]), checklist: { items: [{ text: '', done: false }] } }));
});
