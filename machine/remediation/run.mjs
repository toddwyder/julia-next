// The remediation runner. It owns the two-harness order: the review harness on
// the pull request checkout with its own store, the builder harness on the
// project's own store so a FAIL lands in the thread that made the change. Only
// one harness is alive at a time, because Mastra's observability database takes
// a process-wide lock.

import fs from 'node:fs';
import path from 'node:path';

import { getIssue, postComment as postCardComment } from '../../scripts/linear-cli.mjs';
import { handleStop, bindThreadCard, threadCardsFile } from '../../scripts/stop-ping.mjs';
import { loadMastra } from '../shipping/harness.mjs';
import { FREE_MODEL } from '../shipping/workflow.mjs';
import { prepareCheckout, repoRoot, traceFileFor } from '../shipping/run-parts.mjs';
import { reviewRound } from './reviews.mjs';
import { alreadyFinished, readRecord, seedFrom, writeRecord } from './record.mjs';
import { handToBuilder, investigate, readPlaybook, startFreshBuilder } from './builder.mjs';
import { BUILDER_MODEL, createRemediationWorkflow } from './workflow.mjs';

const USAGE = `Usage: node machine/remediation/run.mjs --pr <n> --card <JUL-n> [options]

  --pr <n>            pull request to review and remediate
  --card <JUL-n>      card the pull request names, read from Linear
  --model <id>        model for the Shipping reviews (default ${FREE_MODEL})
  --builder-model <id> model for a fresh builder or the investigation (default ${BUILDER_MODEL})
  --no-post           write the determinations and the stop in the run folder, post nothing
  --force             ignore a saved record and start the loop again
`;

function parseArgs(argv) {
  const options = { pr: null, card: null, model: null, builderModel: null, post: true, force: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--pr') options.pr = Number(argv[++index]);
    else if (arg === '--card') options.card = argv[++index];
    else if (arg === '--model') options.model = argv[++index];
    else if (arg === '--builder-model') options.builderModel = argv[++index];
    else if (arg === '--no-post') options.post = false;
    else if (arg === '--force') options.force = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!Number.isInteger(options.pr) || options.pr <= 0 || !options.card) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  if (!process.env.LINEAR_API_KEY) {
    throw new Error('LINEAR_API_KEY is required, because the criteria come from the card.');
  }

  const root = repoRoot;
  const runDir = path.join(root, '.artifacts', 'remediation', `pr-${options.pr}`);
  const checkout = path.join(runDir, 'worktree');
  const modelId = options.model ?? FREE_MODEL;
  const builderModel = options.builderModel ?? BUILDER_MODEL;

  const saved = readRecord(runDir);
  if (!options.force && alreadyFinished(saved, { pr: options.pr, card: options.card })) {
    console.log(`This loop already stopped on ${options.card}; the stop is in ${path.join(runDir, 'record.json')}. Pass --force to run it again.`);
    return;
  }
  const seed = options.force ? { reviews: [], builder: null } : seedFrom(saved, { pr: options.pr, card: options.card });

  const sha = prepareCheckout(options.pr, runDir, checkout);
  console.log(`Checked out pull request #${options.pr} at ${sha} in ${checkout}.`);
  if (seed.reviews.length > 0) {
    console.log(`Picking up after ${seed.reviews.length} saved review${seed.reviews.length === 1 ? '' : 's'}.`);
  }

  const { Mastra, LibSQLStore } = await loadMastra();
  const mastra = new Mastra({
    storage: new LibSQLStore({
      id: `remediation-pr-${options.pr}`,
      url: `file:${path.join(runDir, 'state.db')}`,
    }),
    logger: false,
  });

  const traceFor = label => traceFileFor(options.pr, label);
  const post = options.post;

  const deps = {
    root,
    runDir,
    mayPost: post,
    builderModel,
    getIssue: identifier => getIssue(identifier, { apiKey: process.env.LINEAR_API_KEY }),
    readPlaybook,
    reviewRound: args => reviewRound({ ...args, runDir, modelId, post, log: console.log }),
    handToBuilder: async material => {
      process.env.MASTRA_OBSERVABILITY_DB_PATH = traceFor('remediation-builder');
      return handToBuilder({ ...material, log: console.log });
    },
    startFreshBuilder: async material => {
      process.env.MASTRA_OBSERVABILITY_DB_PATH = traceFor('remediation-fresh-builder');
      return startFreshBuilder({ ...material, modelId: builderModel, log: console.log });
    },
    investigate: async material => {
      process.env.MASTRA_OBSERVABILITY_DB_PATH = traceFor('remediation-investigation');
      return investigate({ ...material, modelId: builderModel, log: console.log });
    },
    prepareCheckout: ({ pr, runDir: dir, checkout: tree }) => prepareCheckout(pr, dir, tree),
    postCardComment: async ({ card, body }) => {
      if (!post) {
        const kept = path.join(runDir, 'card-note.md');
        fs.mkdirSync(runDir, { recursive: true });
        fs.writeFileSync(kept, body);
        console.log(`Left the card note unposted at ${kept}`);
        return null;
      }
      const comment = await postCardComment(card, body, { apiKey: process.env.LINEAR_API_KEY });
      return comment.url;
    },
    ping: async ({ record, message }) => {
      const thread = record.stop?.threadId ?? record.builder?.threadId ?? null;
      if (!thread) return { posted: false, error: 'no session thread to hang the stop on' };
      // The stop is filed against the investigation session, so the ping reaches
      // Todd from the card this loop was working on rather than from whatever
      // session happens to be newest.
      bindThreadCard(threadCardsFile(process.env), thread, record.card.identifier, 'remediation runner');
      return handleStop({ session_id: thread, cwd: root, reason: 'agent_done', message }, process.env);
    },
    saveRecord: record => writeRecord(runDir, { ...record, pr: options.pr, runDir }),
  };

  const { workflow } = await createRemediationWorkflow({ mastra, deps, log: console.log });
  const run = await workflow.createRun();
  const started = await run.start({
    inputData: {
      pr: options.pr,
      card: options.card,
      sha,
      checkout,
      reviews: seed.reviews,
      builder: seed.builder,
    },
  });

  if (started.status !== 'success') {
    console.error(`The loop ended ${started.status}: ${started.error ?? 'no result'}`);
    process.exitCode = 1;
    return;
  }

  const record = {
    ...started.result,
    runId: run.runId ?? null,
    status: started.status,
    modelId,
    builderModel,
    startedAt: new Date().toISOString(),
  };
  const recordFile = writeRecord(runDir, record);
  console.log(`Wrote the run record to ${recordFile}.`);

  if (record.stop) {
    console.log(`Stopped: ${record.stop.reason}`);
    console.log(`Root cause: ${record.stop.rootCause || 'the investigation answered with nothing usable'}`);
    console.log(record.stop.ping?.posted ? `Pinged Todd: ${record.stop.ping.comment}` : 'The stop is recorded but nothing was posted.');
    return;
  }

  const last = record.reviews[record.reviews.length - 1];
  console.log(`The last review said ${last?.verdict ?? 'nothing usable'}; the loop is done.`);
}

main().catch(error => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
