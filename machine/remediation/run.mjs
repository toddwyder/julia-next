// The remediation runner. It owns the two-harness order: the review harness on
// the pull request checkout with its own store, the builder harness on the
// project's own store so a FAIL lands in the thread that made the change. Only
// one harness is alive at a time, because Mastra's observability database takes
// a process-wide lock.

import fs from 'node:fs';
import path from 'node:path';

import { getIssue, postComment as postCardComment } from '../../scripts/linear-cli.mjs';
import { scratchDir } from '../../scripts/scratch-dir.mjs';
import { loadMastra } from '../shipping/harness.mjs';
import { prepareCheckout, repoRoot, traceFileFor } from '../shipping/run-parts.mjs';
import { stageModels } from '../../dashboard/lib/model-settings.js';
import { reviewRound } from './reviews.mjs';
import { alreadyFinished, readRecord, seedFrom, writeRecord } from './record.mjs';
import { readCardFile } from './card-file.mjs';
import { handToBuilder, investigate, readPlaybook, startFreshBuilder } from './builder.mjs';
import { createRemediationWorkflow } from './workflow.mjs';

const USAGE = `Usage: node machine/remediation/run.mjs --pr <n> --card <JUL-n> [options]

  --pr <n>            pull request to review and remediate
  --card <JUL-n>      card the pull request names, read from Linear
  --model <id>        model for the Shipping reviews (default: the saved Shipping pick)
  --builder-model <id> model for a fresh builder or the investigation (default: the saved Remediation pick)
  --no-post           write the determinations and the stop in the run folder, post nothing
  --force             ignore a saved record and start the loop again
  --card-file <path>  read the card from this JSON file instead of Linear, for practice runs
  --review-timeout-min <n> end a review that has not answered after this many minutes (default 20)
`;

function parseArgs(argv) {
  const options = { pr: null, card: null, model: null, builderModel: null, post: true, force: false, cardFile: null, reviewTimeoutMin: 20 };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--pr') options.pr = Number(argv[++index]);
    else if (arg === '--card') options.card = argv[++index];
    else if (arg === '--card-file') options.cardFile = argv[++index];
    else if (arg === '--model') options.model = argv[++index];
    else if (arg === '--builder-model') options.builderModel = argv[++index];
    else if (arg === '--review-timeout-min') options.reviewTimeoutMin = Number(argv[++index]);
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
  if (!options.cardFile && !process.env.LINEAR_API_KEY) {
    throw new Error('LINEAR_API_KEY is required, because the criteria come from the card.');
  }

  const root = repoRoot;
  const runDir = path.join(root, '.artifacts', 'remediation', `pr-${options.pr}`);
  const checkout = path.join(scratchDir, 'remediation', `pr-${options.pr}`, 'worktree');
  // Every stage reads Todd's saved pick; a missing pick stops here and names the stage.
  const stages = stageModels();
  const modelId = options.model ?? stages.shipping;
  const builderModel = options.builderModel ?? stages.remediation;

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
    getIssue: async identifier => {
      if (!options.cardFile) return getIssue(identifier, { apiKey: process.env.LINEAR_API_KEY });
      const card = readCardFile(options.cardFile);
      if (card.identifier !== identifier) {
        throw new Error(`${options.cardFile} holds ${card.identifier}, but the run is for ${identifier}.`);
      }
      return card;
    },
    readPlaybook,
    reviewRound: args =>
      reviewRound({
        ...args,
        runDir,
        modelId,
        post,
        timeLimitMs: Math.round(options.reviewTimeoutMin * 60_000),
        log: console.log,
      }),
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
      // A card note that Linear refuses must not take the loop down with it: the
      // note is the evidence for the step that just ran, so it is kept on disk.
      const keep = why => {
        const kept = path.join(runDir, 'card-note.md');
        fs.mkdirSync(runDir, { recursive: true });
        fs.writeFileSync(kept, body);
        console.log(`${why} It is kept at ${kept}`);
        return null;
      };
      if (!post) return keep('Left the card note unposted.');
      let comment;
      try {
        comment = await postCardComment(card, body, { apiKey: process.env.LINEAR_API_KEY });
      } catch (error) {
        return keep(`Could not post the note on ${card}: ${error.message}.`);
      }
      return comment.url;
    },
    // The stop ping was removed on 7 Nov 2026 (ADR 0024). A stop is still written to the run
    // record; nothing posts to Linear.
    ping: async () => ({ posted: false, error: 'stop ping removed' }),
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
