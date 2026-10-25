import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { z } from 'zod/v4';

import { startControlPageServer } from '../src/mastra/control-page.ts';
import {
  createBuildRunnerClient,
  BuildJobSchema,
  BuildStartResultSchema,
  BuildResultSchema,
  type BuildJob,
} from '../src/mastra/build-client.ts';
import {
  ReadyCardSchema,
  RunSnapshotSchema,
  InitializationRolesSchema,
  InitializationResultSchema,
  ControlPageStateSchema,
  InitializationRunsStateSchema,
  InitializationActivitySchema,
  StartInitializationSchema,
} from '../src/mastra/contracts.ts';

const rawCard = {
  identifier: 'JUL-232',
  title: 'Practice',
  state: 'Ready',
  description: '## Outcome\n\nA practice build leaves the marker.\n\n## Acceptance criteria\n\n* The marker exists with the exact bytes.',
};

const rawOffer = {
  route: 'commandcode',
  modelId: 'reflection/beam:free',
  name: 'Beam',
  company: 'Reflection',
  service: 'CommandCode',
  codingCapable: true,
  supportedEfforts: ['medium'],
  wire: 'chat',
};

const controlState = ControlPageStateSchema.parse({
  cards: [{ admitted: true, card: rawCard }],
  offers: [rawOffer],
});
const card = controlState.cards[0].card;
const offer = controlState.offers[0];

const selection = {
  route: 'commandcode',
  modelId: 'reflection/beam:free',
  company: 'Reflection',
  service: 'CommandCode',
  effort: 'medium',
  wire: 'chat',
} as const;

const roles = InitializationRolesSchema.parse({
  orchestrator: selection,
  coder: selection,
});

const iso = new Date('2025-07-23T12:00:00.000Z').toISOString();

const snapshot = RunSnapshotSchema.parse({
  runId: 'jul-232-ui-test',
  card,
  roles,
  state: 'ready-for-build',
  initializedAt: iso,
});

const initResult = InitializationResultSchema.parse({
  runId: snapshot.runId,
  state: 'ready-for-build',
  snapshot,
  resumed: false,
});

let job = BuildJobSchema.parse({
  runId: snapshot.runId,
  snapshot,
  runnerPid: 123,
  workerPid: 124,
  worktree: '/tmp/practice',
  baseCommit: 'a'.repeat(40),
  state: 'running',
  result: null,
  error: null,
});

const candidateCommit = 'b'.repeat(40);

const savedResult = BuildResultSchema.parse({
  state: 'ready-for-review',
  card,
  roles,
  actualModels: {
    orchestrator: 'commandcode-free/reflection/beam:free',
    coder: 'commandcode-free/reflection/beam:free',
  },
  threadId: 'thread-test',
  worktree: '/tmp/practice',
  baseCommit: 'a'.repeat(40),
  candidateCommit,
  account: { spentNano: 0, heldNano: 0, stopped: false },
  internalReview: { verified: true },
  downstreamReviewStarted: false,
  completedAt: iso,
});

const activity = InitializationActivitySchema.parse({
  roleDispatches: { builder: 0, reviewer: 0, crashFixer: 0, crashReviewer: 0 },
  llmInferenceCalls: 0,
  linearQueries: 0,
  linearMutations: 0,
});

const clientJob = BuildJobSchema.parse({
  runId: snapshot.runId,
  snapshot,
  runnerPid: 123,
  workerPid: 124,
  worktree: '/tmp/practice',
  baseCommit: 'a'.repeat(40),
  state: 'running',
  result: null,
  error: null,
});

test('control page shows running then saved review result', async () => {
  let buildJobs: BuildJob[] = [];
  let startCount = 0;

  const startInitialization = async (input: z.infer<typeof StartInitializationSchema>) => {
    assert.deepEqual(input, { card, roles });
    startCount += 1;
    buildJobs = [job];
    return BuildStartResultSchema.parse({ ...initResult, build: job });
  };

  const server = await startControlPageServer({
    port: 0,
    getState: async () =>
      ControlPageStateSchema.parse({
        cards: [{ admitted: true, card }],
        offers: [offer],
      }),
    startInitialization,
    getRuns: async () =>
      InitializationRunsStateSchema.parse({ runs: [], totalRuns: 0 }),
    getActivity: () => activity,
    getBuildJobs: async () => buildJobs,
  });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(server.url);

    const cardSelect = page.locator('select[name="card"]');
    await cardSelect.selectOption('0');

    for (const legendText of ['Orchestrator', 'Coder']) {
      const fieldset = page.locator('fieldset', {
        has: page.locator('legend', { hasText: legendText }),
      });
      await fieldset.locator('select').first().selectOption({ index: 0 });
    }

    await page.getByRole('button', { name: /Start/i }).click();
    await page.getByRole('heading', { name: 'JUL-232 · running', exact: true }).waitFor({
      state: 'visible',
      timeout: 10000,
    });

    job = BuildJobSchema.parse({ ...job, state: 'ready-for-review', result: savedResult });
    buildJobs = [job];

    const resultPre = page.locator('pre[data-testid="saved-build-result"]');
    await resultPre.waitFor({ state: 'visible', timeout: 10000 });
    const firstText = await resultPre.textContent();
    assert.ok(firstText?.includes(candidateCommit));

    await page.reload();
    const reloadedPre = page.locator('pre[data-testid="saved-build-result"]');
    await reloadedPre.waitFor({ state: 'visible', timeout: 10000 });
    const reloadedText = await reloadedPre.textContent();
    assert.equal(reloadedText, firstText);
    await page.getByRole('heading', { name: 'JUL-232 · ready-for-review', exact: true }).waitFor({ state: 'visible', timeout: 10000 });
    await page.getByText('Downstream Review has not started').waitFor({
      state: 'visible',
      timeout: 10000,
    });

    assert.equal(startCount, 1);
  } finally {
    await browser.close();
    await server.close();
  }
});

test('build runner client captures init and validates jobs', async () => {
  const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];

  const fetchImpl: typeof fetch = async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    calls.push({ input, init });
    if (init?.method === 'POST') {
      return new Response(JSON.stringify(clientJob), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify([clientJob]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const client = createBuildRunnerClient('http://runner.test', fetchImpl);
  const returned = await client.start(initResult);

  const postCall = calls[0];
  assert.ok(postCall);
  assert.deepEqual(JSON.parse(String(postCall.init?.body)), initResult);
  assert.deepEqual(returned, clientJob);

  const listed = await client.list();
  assert.deepEqual(listed, [clientJob]);

  const invalidFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify([{ ...clientJob, state: 'ready-for-review', result: null }]),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );

  const invalidClient = createBuildRunnerClient('http://runner.test', invalidFetch);
  await assert.rejects(async () => {
    await invalidClient.list();
  });

  assert.throws(() =>
    BuildJobSchema.parse({ ...clientJob, state: 'ready-for-review', result: null }),
  );
});
