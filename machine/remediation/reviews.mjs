// One review round of the loop. Shipping's own workflow judges the change; this
// adds the round's name, its own trace file and store, and the posting.

import fs from 'node:fs';
import path from 'node:path';

import { stopHarness } from '../shipping/harness.mjs';
import { runShipping, FREE_MODEL, PLAYBOOK, WORKFLOW_ID } from '../shipping/workflow.mjs';
import { commandsFromSpans, determinationComment, playbookSteps } from '../shipping/determination.mjs';
import { readSpans, workflowRun } from '../shipping/trace-record.mjs';
import { postComment, traceFileFor } from '../shipping/run-parts.mjs';
import { MAX_REVIEWS, failedCriteria } from './workflow.mjs';

// The free reviewer answers with a provider error instead of a verdict now and
// then: CommandCode wants the reasoning of every earlier assistant message back
// and a long tool run loses some. A brand-new session is a short history, so it
// usually gets through. Nothing is posted until an attempt actually judges the
// card, which is why a retry cannot post twice.
export const REVIEW_ATTEMPTS = 3;

const firstLine = text => String(text ?? '').trim().split(/\r?\n/)[0].slice(0, 300);

export async function reviewRound({ record, round, runDir, modelId = FREE_MODEL, post = true, log = console.log }) {
  let attemptUsed = null;
  for (let attempt = 1; attempt <= REVIEW_ATTEMPTS; attempt++) {
    const name = attempt === 1 ? `review-${round}` : `review-${round}-try-${attempt}`;
    const traceFile = traceFileFor(record.pr, `remediation-${name}`);
    // The harness reads this when it boots, so setting it here gives this
    // attempt its own trace file without the workflow reaching into the env.
    process.env.MASTRA_OBSERVABILITY_DB_PATH = traceFile;
    const storage = {
      backend: 'libsql',
      url: `file:${path.join(runDir, `${name}.db`)}`,
      isRemote: false,
    };

    const run = await runShipping({
      pr: record.pr,
      sha: record.head,
      checkout: record.checkout,
      card: record.card.identifier,
      modelId,
      storage,
      log,
    });
    if (run.booted) await stopHarness(run.booted);

    const verdict = run.verdict ?? null;
    attemptUsed = { run, verdict, traceFile };
    if (verdict?.verdict) break;
    if (attempt === REVIEW_ATTEMPTS) break;
    log(`The reviewer answered without a verdict: ${firstLine(verdict?.raw ?? run.error ?? 'no answer')}. Asking a new one (${attempt + 1} of ${REVIEW_ATTEMPTS}).`);
  }

  const { run, verdict, traceFile } = attemptUsed;
  const spans = await readSpans(traceFile);
  const workflowSpan = workflowRun(spans, WORKFLOW_ID);
  const { commands, otherTools } = commandsFromSpans(spans);
  let steps = [];
  try {
    steps = playbookSteps(fs.readFileSync(path.join(record.checkout, PLAYBOOK), 'utf8'));
  } catch {
    steps = [];
  }

  const failed = failedCriteria(verdict, run.output?.criteria ?? record.criteria);
  const failure = run.output ? null : `the workflow ended ${run.status}: ${run.error ?? 'no answer'}`;

  const body = determinationComment({
    pr: record.pr,
    sha: record.head,
    card: run.output?.card ?? record.card,
    model: run.output?.modelId ?? modelId,
    playbook: PLAYBOOK,
    workflowRunId: workflowSpan?.runId ?? run.runId,
    workflowId: WORKFLOW_ID,
    traceFile,
    criteria: run.output?.criteria ?? record.criteria,
    verdict,
    commands,
    otherTools,
    steps,
    failed: failure,
    review: { round, of: MAX_REVIEWS },
  });

  fs.mkdirSync(runDir, { recursive: true });
  const determination = path.join(runDir, `determination-${round}.md`);
  fs.writeFileSync(determination, body);

  let postedUrl = null;
  if (post) {
    postedUrl = postComment(record.pr, determination);
    log(`Posted review ${round} of ${MAX_REVIEWS} on pull request #${record.pr}: ${postedUrl}`);
  } else {
    log(`Left review ${round} of ${MAX_REVIEWS} unposted at ${determination}`);
  }

  return {
    modelId: run.output?.modelId ?? modelId,
    verdict: verdict?.verdict ?? null,
    answer: verdict?.raw ?? run.output?.answer ?? '',
    failed,
    determination,
    postedUrl,
    traceFile,
  };
}
