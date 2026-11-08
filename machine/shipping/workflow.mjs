// The Shipping run as a Mastra workflow. One step gathers what the card asks
// for and where the code is; the next starts a fresh Execute subagent on the
// free Beam model and lets it run the card's own commands. Neither step judges
// anything: the answer comes back as text and the machine writes it down.

import { getIssue } from '../../scripts/linear-cli.mjs';
import { bootHarness, loadMastra, stopHarness } from './harness.mjs';
import { criteriaFromCard, parseVerdict } from './determination.mjs';

export const WORKFLOW_ID = 'shipping';
export const FREE_MODEL = 'commandcode/reflection/beam:free';
export const PLAYBOOK = '.agents/skills/poteto-mode/playbooks/shipping.md';

const TRANSIENT = /(429|rate[ -]?limit|too many requests|temporarily unavailable|overloaded|ECONNRESET|socket hang up)/i;
const RETRY_WAITS_MS = [30_000, 90_000, 240_000];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const REVIEW_TIME_LIMIT_MS = 20 * 60_000;

export const reviewLimitNote = ms => {
  const minutes = Math.round(ms / 60_000);
  return `longer than ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
};

// A review that never answers used to hold the run open until a person
// noticed. The clock ends it and the caller records what it got.
export async function runWithinTimeLimit(start, { limitMs = REVIEW_TIME_LIMIT_MS, onLimit = null, log = () => {} } = {}) {
  let timer = null;
  const limit = new Promise(resolve => {
    timer = setTimeout(() => resolve({ timedOut: true }), limitMs);
    timer.unref?.();
  });
  try {
    const raced = await Promise.race([start().then(value => ({ timedOut: false, value })), limit]);
    if (!raced.timedOut) return raced;
    log(`The review ran ${reviewLimitNote(limitMs)} and was ended.`);
    if (onLimit) await onLimit();
    return { timedOut: true, value: undefined };
  } finally {
    clearTimeout(timer);
  }
}

async function askVerifier(subagent, payload, context, { log = () => {} } = {}) {
  for (let attempt = 0; ; attempt++) {
    const result = await subagent.execute(payload, context);
    const text = String(result?.content ?? '');
    const transient = TRANSIENT.test(text) && (/failed/i.test(text) || result?.isError);
    if (!transient) return { text, isError: Boolean(result?.isError) };
    if (attempt >= RETRY_WAITS_MS.length) return { text, isError: true };
    const wait = RETRY_WAITS_MS[attempt];
    log(`The model service is busy, waiting ${Math.round(wait / 1000)}s and asking the same model again.`);
    await sleep(wait);
  }
}

export function reviewTask({ pr, sha, checkout, card, criteria }) {
  return [
    `You are the Shipping agent for pull request #${pr} in this checkout.`,
    '',
    `Read ${PLAYBOOK} first and follow it. You are reviewing code you did not write, and only a verdict from an agent that runs the change itself counts. A green pipeline is not a verdict.`,
    '',
    `The code under review is already checked out here: ${checkout}`,
    `Commit under review: ${sha}`,
    '',
    `The card is ${card.identifier}, quoted between the fences. Its criteria are the only things you judge.`,
    '',
    '--- card ---',
    `# ${card.title}`,
    '',
    card.description ?? '',
    '--- end card ---',
    '',
    'For each criterion, run the command it names, exactly as written, inside this checkout. Decide from what the command printed and the exit code it gave. You may also run read-only commands to look around (cat, ls, git show, git diff, git log). Dependencies are already installed in the root and in dashboard/. Do not run npm ci, npm install, or any installer, and do not edit, commit, push, or otherwise change the checkout.',
    '',
    `The card lists ${criteria.length} ${criteria.length === 1 ? 'criterion' : 'criteria'}. Judge every one of them.`,
    '',
    'Answer in exactly this shape, with nothing before it and nothing after it:',
    '',
    'VERDICT: PASS | PASS+NOTES | FAIL',
    'CRITERION 1: PASS | FAIL — one sentence naming the command you ran and what it returned',
    'NOTES: one short paragraph on anything a reader should know',
  ].join('\n');
}

export async function runShipping({ pr, sha, checkout, card, cardRecord = null, modelId = FREE_MODEL, storage, timeLimitMs = REVIEW_TIME_LIMIT_MS, log = console.log }) {
  const { z, createWorkflow, createStep } = await loadMastra();
  const traceFile = process.env.MASTRA_OBSERVABILITY_DB_PATH ?? null;
  const { booted, session, mastra, requestContext, subagent } = await bootHarness({ cwd: checkout, storage });

  const inputSchema = z.object({ pr: z.number(), sha: z.string(), checkout: z.string(), card: z.string() });
  const contextSchema = z.object({
    pr: z.number(),
    sha: z.string(),
    checkout: z.string(),
    card: z.object({ identifier: z.string(), title: z.string(), description: z.string().nullable(), url: z.string().nullable() }),
    criteria: z.array(z.string()),
  });
  const reviewSchema = z.object({ ...contextSchema.shape, answer: z.string(), modelId: z.string() });

  const gather = createStep({
    id: 'gather',
    inputSchema,
    outputSchema: contextSchema,
    execute: async ({ inputData }) => {
      // A caller that already read the card hands it over, so the review can run
      // on a machine whose Linear key is gone. Otherwise the card is read here.
      let issue = cardRecord;
      if (!issue) {
        const apiKey = process.env.LINEAR_API_KEY;
        if (!apiKey) throw new Error('LINEAR_API_KEY is not set, so the machine cannot read the card.');
        issue = await getIssue(inputData.card, { apiKey });
      }
      if (!issue) throw new Error(`Linear returned no card for ${inputData.card}`);
      const criteria = criteriaFromCard(issue.description);
      if (criteria.length === 0) throw new Error(`${inputData.card} names no criteria, so there is nothing to judge.`);
      log(`Card ${issue.identifier} names ${criteria.length} criterion(s); the code is at ${inputData.sha}.`);
      return {
        pr: inputData.pr,
        sha: inputData.sha,
        checkout: inputData.checkout,
        card: {
          identifier: issue.identifier,
          title: issue.title,
          description: issue.description ?? '',
          url: issue.url ?? null,
        },
        criteria,
      };
    },
  });

  const review = createStep({
    id: 'review',
    inputSchema: contextSchema,
    outputSchema: reviewSchema,
    execute: async ({ inputData }) => {
      const task = reviewTask(inputData);
      log(`Starting a fresh Execute subagent on ${modelId}.`);
      const answer = await askVerifier(
        subagent,
        { agentType: 'execute', task, modelId },
        { workspace: session.getWorkspace(), requestContext, mastra },
        { log }
      );
      log(`The Shipping agent answered: ${answer.text.split(/\r?\n/)[0]}`);
      return { ...inputData, answer: answer.text, modelId };
    },
  });

  const workflow = createWorkflow({ id: WORKFLOW_ID, inputSchema, outputSchema: reviewSchema })
    .then(gather)
    .then(review)
    .commit();
  mastra.addWorkflow(workflow);

  const run = await workflow.createRun();
  log(`Mastra workflow run ${run.runId} started.`);
  const started = Date.now();
  const result = await runWithinTimeLimit(() => run.start({ inputData: { pr, sha, checkout, card } }), {
    limitMs: timeLimitMs,
    log,
    onLimit: () => stopHarness(booted),
  });
  const elapsedMs = Date.now() - started;

  if (result.timedOut) {
    return {
      runId: run.runId,
      status: 'timeout',
      elapsedMs,
      output: null,
      verdict: null,
      error: `The review ran ${reviewLimitNote(timeLimitMs)}, so it was ended without a verdict.`,
      traceFile,
      booted: null,
      timedOut: true,
    };
  }

  const output = result.value.status === 'success' ? result.value.result : null;
  return {
    runId: run.runId,
    status: result.value.status,
    elapsedMs,
    output,
    verdict: output ? parseVerdict(output.answer) : null,
    error: result.value.status === 'success' ? null : JSON.stringify(result.value.error ?? result.value.status),
    traceFile,
    booted,
    timedOut: false,
  };
}
