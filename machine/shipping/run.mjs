#!/usr/bin/env node
// The machine's own entry point. It fetches the pull request's head, checks the
// code out on its own, starts the Shipping workflow, then writes the
// determination from Mastra's record of that run and posts it on the pull
// request. Nothing here judges the code; the Shipping agent does that.
//
//   node scripts/julia-agents.mjs -- node machine/shipping/run.mjs --pr 401 --card JUL-305
//
// The harness reads this file's own environment first, so the trace path and
// the state database are set below before any Mastra module is loaded.

import fs from 'node:fs';
import path from 'node:path';

import { postComment, prepareCheckout, prepareDependencies, repoRoot, savedPosting, traceFileFor } from './run-parts.mjs';
import { scratchDir } from '../../scripts/scratch-dir.mjs';
import { stageModels } from '../../dashboard/lib/model-settings.js';

const USAGE = `usage: node machine/shipping/run.mjs --pr <number> --card <JUL-number> [--model <id>] [--no-post] [--force]`;

function parseArgs(argv) {
  const options = { pr: null, card: null, model: null, post: true, force: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--pr') options.pr = Number(argv[++index]);
    else if (flag === '--card') options.card = argv[++index];
    else if (flag === '--model') options.model = argv[++index];
    else if (flag === '--no-post') options.post = false;
    else if (flag === '--force') options.force = true;
    else if (flag === '--help' || flag === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else throw new Error(`unknown argument ${flag}\n${USAGE}`);
  }
  if (!Number.isInteger(options.pr) || options.pr <= 0) throw new Error(`--pr is required\n${USAGE}`);
  if (!/^[A-Z]+-\d+$/.test(String(options.card ?? ''))) throw new Error(`--card is required\n${USAGE}`);
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runDir = path.join(repoRoot, '.artifacts', 'shipping', `pr-${options.pr}`);
  const checkout = path.join(scratchDir, 'shipping', `pr-${options.pr}`, 'worktree');

  console.log(`Fetching pull request #${options.pr} and checking it out at ${checkout}.`);
  const sha = prepareCheckout(options.pr, runDir, checkout);
  console.log(`Pull request #${options.pr} is at ${sha}.`);

  console.log('Preparing the review checkout dependencies one tree at a time.');
  prepareDependencies(checkout, { log: message => console.log(message) });

  if (options.post && !options.force) {
    const saved = savedPosting(runDir, options.pr, sha, options.card);
    if (saved) {
      console.log(`Already reviewed at ${sha} and posted at ${saved.posted.url}. Nothing to do; pass --force to review it again.`);
      return;
    }
  }

  const traceFile = traceFileFor(options.pr);
  process.env.MASTRA_OBSERVABILITY_DB_PATH = traceFile;
  if (!process.env.MASTRA_DB_PATH) process.env.MASTRA_DB_PATH = path.join(runDir, 'state.db');
  console.log(`Mastra writes this run's record to ${traceFile}.`);

  const { runShipping, WORKFLOW_ID, PLAYBOOK } = await import('./workflow.mjs');
  const { stopHarness } = await import('./harness.mjs');
  const { answerModel, readSpans, workflowRun } = await import('./trace-record.mjs');
  const { commandsFromSpans, determinationComment, playbookSteps } = await import('./determination.mjs');

  // The Shipping review runs on Todd's saved Shipping pick; the machine carries no default.
  const modelId = options.model ?? stageModels().shipping;
  const run = await runShipping({
    pr: options.pr,
    sha,
    checkout,
    card: options.card,
    modelId,
    log: message => console.log(message),
  });
  await stopHarness(run.booted);

  const spans = await readSpans(traceFile);
  const workflowSpan = workflowRun(spans, WORKFLOW_ID);
  const { commands, otherTools } = commandsFromSpans(spans);
  const answeredModel = answerModel(spans);
  let steps = [];
  try {
    steps = playbookSteps(fs.readFileSync(path.join(checkout, PLAYBOOK), 'utf8'));
  } catch {
    steps = [];
  }

  const failed = run.output ? null : `the workflow ended ${run.status}: ${run.error ?? 'no answer'}`;
  const comment = determinationComment({
    pr: options.pr,
    sha,
    card: run.output?.card ?? { identifier: options.card },
    model: run.output?.modelId ?? modelId,
    answeredModel,
    playbook: PLAYBOOK,
    workflowRunId: workflowSpan?.runId ?? run.runId,
    workflowId: WORKFLOW_ID,
    traceFile,
    criteria: run.output?.criteria ?? [],
    verdict: run.verdict,
    commands,
    otherTools,
    steps,
    failed,
  });

  const recordPath = path.join(runDir, 'record.json');
  const commentPath = path.join(runDir, 'determination.md');
  fs.writeFileSync(commentPath, comment);
  const record = {
    pr: options.pr,
    sha,
    checkout,
    card: run.output?.card ?? { identifier: options.card },
    criteria: run.output?.criteria ?? [],
    modelId: run.output?.modelId ?? modelId,
    answeredModel,
    playbook: PLAYBOOK,
    workflowId: WORKFLOW_ID,
    workflowRunId: workflowSpan?.runId ?? run.runId,
    traceFile,
    status: run.status,
    error: run.error,
    elapsedMs: run.elapsedMs,
    verdict: run.verdict?.verdict ?? null,
    answer: run.verdict?.raw ?? null,
    commands,
    otherTools,
    determination: commentPath,
    posted: null,
  };

  if (options.post) {
    record.posted = { url: postComment(options.pr, commentPath) };
    console.log(`Posted the determination on pull request #${options.pr}: ${record.posted.url}`);
  } else {
    console.log(`Left the determination unposted at ${commentPath}.`);
  }

  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`Wrote the run record to ${recordPath}.`);
  console.log(`The Shipping agent said ${record.verdict ?? 'nothing usable'}; this is a result either way.`);
}

main().catch(error => {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});
