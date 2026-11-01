// One FAIL goes back to the builder and is reviewed again; a second FAIL runs
// the Investigation playbook and stops the card. The chain is straight because
// every round is a pass-through: a step that does not apply returns the record
// it was given. The limit of two reviews lives in MAX_REVIEWS and nowhere else.

import { loadMastra } from '../shipping/harness.mjs';
import { FREE_MODEL } from '../shipping/workflow.mjs';
import { criteriaFromCard } from '../shipping/determination.mjs';
import { BUG_FIX_PLAYBOOK, INVESTIGATION_PLAYBOOK, rootCauseFrom } from './builder.mjs';

export const WORKFLOW_ID = 'remediation';
export const MAX_REVIEWS = 2;
export const BUILDER_MODEL = FREE_MODEL;

export function passed(verdict) {
  return typeof verdict === 'string' && verdict.length > 0 && verdict !== 'FAIL';
}

export function failedCriteria(verdict, criteria = []) {
  const judged = Array.isArray(verdict?.criteria) ? verdict.criteria : [];
  return judged
    .filter(item => item?.verdict === 'FAIL')
    .map(item => ({
      number: item.number,
      criterion: criteria[item.number - 1] ?? null,
      reason: item.reason ?? '',
    }));
}

export function shouldReview(record, round) {
  if (round > MAX_REVIEWS) return false;
  if (record.reviews.length !== round - 1) return false;
  if (round === 1) return true;
  return !passed(record.reviews[record.reviews.length - 1]?.verdict);
}

export function shouldRemediate(record) {
  const last = record.reviews[record.reviews.length - 1];
  return record.reviews.length > 0 && record.reviews.length < MAX_REVIEWS && !passed(last?.verdict);
}

export function shouldInvestigate(record) {
  return record.reviews.length === MAX_REVIEWS && record.reviews.every(review => !passed(review?.verdict));
}

export function stopReason(record) {
  const last = record.reviews[record.reviews.length - 1];
  const named = (last?.failed ?? []).map(item => `criterion ${item.number}: ${item.reason || 'no reason given'}`);
  const detail = named.length > 0 ? named.join('; ') : 'neither review named a failing criterion, so read the determinations on the pull request';
  return `Shipping failed ${record.card.identifier} ${MAX_REVIEWS} times in a row (${detail})`;
}

export function stopMessage(record) {
  const lines = [
    `The remediation loop stopped on ${record.card.identifier} after ${MAX_REVIEWS} FAIL determinations.`,
    `Pull request: https://github.com/toddwyder/julia-next/pull/${record.pr}`,
  ];
  for (const review of record.reviews) {
    const failed = (review.failed ?? []).map(item => `criterion ${item.number}`);
    lines.push(
      `Review ${review.round} on ${review.sha}: ${review.verdict ?? 'NO VERDICT'}${failed.length > 0 ? ` (${failed.join(', ')})` : ''}`
    );
  }
  lines.push(`Root cause: ${record.stop?.rootCause || 'the investigation session answered with nothing usable'}`);
  return lines.join('\n');
}

export function cardNoteForFreshBuilder(record, builder) {
  return [
    `The Shipping agent failed this card and the builder's own session could not be taken: it is gone from the store, or another process was still writing it. The machine started a fresh builder with the same determination.`,
    '',
    `Fresh session: ${builder?.threadId ?? 'unknown'}`,
    `Its store: ${builder?.store ?? 'unknown'}`,
    `Determination: review ${record.reviews.length} on commit ${record.head}`,
  ].join('\n');
}

export async function createRemediationWorkflow({ mastra, deps, log = console.log }) {
  const { z, createWorkflow, createStep } = await loadMastra();

  const cardSchema = z.object({
    identifier: z.string(),
    title: z.string().default(''),
    description: z.string().default(''),
    url: z.string().nullable().default(null),
  });

  const reviewSchema = z.object({
    round: z.number(),
    sha: z.string(),
    modelId: z.string(),
    verdict: z.string().nullable().default(null),
    answer: z.string().default(''),
    failed: z
      .array(z.object({ number: z.number(), criterion: z.string().nullable().default(null), reason: z.string().default('') }))
      .default([]),
    determination: z.string().nullable().default(null),
    postedUrl: z.string().nullable().default(null),
    traceFile: z.string().nullable().default(null),
  });

  const builderSchema = z.object({
    threadId: z.string().nullable().default(null),
    resumed: z.boolean().default(false),
    store: z.string().nullable().default(null),
  });

  const stopSchema = z.object({
    reason: z.string(),
    rootCause: z.string().default(''),
    threadId: z.string().nullable().default(null),
    ping: z.unknown().nullable().default(null),
  });

  const recordSchema = z.object({
    pr: z.number(),
    card: cardSchema,
    criteria: z.array(z.string()).default([]),
    checkout: z.string(),
    head: z.string(),
    reviews: z.array(reviewSchema).default([]),
    builder: builderSchema.nullable().default(null),
    stop: stopSchema.nullable().default(null),
  });

  const startSchema = z.object({
    pr: z.number(),
    card: z.string(),
    sha: z.string(),
    checkout: z.string(),
    reviews: z.array(reviewSchema).default([]),
    builder: builderSchema.nullable().default(null),
  });

  const withRecord = { inputSchema: recordSchema, outputSchema: recordSchema };

  // The runner saves the record after every step, so a crash leaves the rounds
  // that already happened on disk and a rerun picks up from there instead of
  // posting the same determination twice.
  const persist = async record => {
    if (deps.saveRecord) await deps.saveRecord(record);
    return record;
  };

  const gather = createStep({
    id: 'gather',
    inputSchema: startSchema,
    outputSchema: recordSchema,
    execute: async ({ inputData }) => {
      const issue = await deps.getIssue(inputData.card);
      if (!issue) throw new Error(`Linear returned no card for ${inputData.card}.`);
      const criteria = criteriaFromCard(issue.description ?? '');
      if (criteria.length === 0) {
        throw new Error(`${inputData.card} names no acceptance criteria, so there is nothing for Shipping to judge.`);
      }
      log(`Read ${inputData.card} from Linear: ${criteria.length} criteria.`);
      return persist({
        pr: inputData.pr,
        card: {
          identifier: issue.identifier ?? inputData.card,
          title: issue.title ?? '',
          description: issue.description ?? '',
          url: issue.url ?? null,
        },
        criteria,
        checkout: inputData.checkout,
        head: inputData.sha,
        reviews: inputData.reviews,
        builder: inputData.builder,
        stop: null,
      });
    },
  });

  const reviewStep = round =>
    createStep({
      ...withRecord,
      id: `review${round}`,
      execute: async ({ inputData }) => {
        const record = inputData;
        if (!shouldReview(record, round)) return persist(record);
        log(`Review ${round} of ${MAX_REVIEWS} on ${record.head}.`);
        const outcome = await deps.reviewRound({ record, round });
        const review = {
          round,
          sha: record.head,
          modelId: outcome.modelId,
          verdict: outcome.verdict,
          answer: outcome.answer ?? '',
          failed: outcome.failed ?? [],
          determination: outcome.determination ?? null,
          postedUrl: outcome.postedUrl ?? null,
          traceFile: outcome.traceFile ?? null,
        };
        return persist({ ...record, reviews: [...record.reviews, review] });
      },
    });

  const remediate = createStep({
    ...withRecord,
    id: 'remediate',
    execute: async ({ inputData }) => {
      const record = inputData;
      if (!shouldRemediate(record)) return persist(record);
      const last = record.reviews[record.reviews.length - 1];
      const material = {
        root: deps.root,
        card: record.card,
        pr: record.pr,
        sha: record.head,
        determination: last.answer,
        criteria: record.criteria,
        playbookText: deps.readPlaybook(BUG_FIX_PLAYBOOK),
        modelId: deps.builderModel,
        runDir: deps.runDir,
      };
      log('Handing the FAIL to the builder.');
      let builder = await deps.handToBuilder(material);
      if (!builder) {
        builder = await deps.startFreshBuilder(material);
        const note = cardNoteForFreshBuilder(record, builder);
        const posted = await deps.postCardComment({ card: record.card.identifier, body: note, runDir: deps.runDir });
        log(posted ? `Started a fresh builder and said so on ${record.card.identifier}: ${posted}` : 'Started a fresh builder.');
      }
      const head = await deps.prepareCheckout({ pr: record.pr, runDir: deps.runDir, checkout: record.checkout });
      log(`The pull request head is ${head} after the fix run.`);
      return persist({ ...record, builder, head });
    },
  });

  const investigate = createStep({
    ...withRecord,
    id: 'investigate',
    execute: async ({ inputData }) => {
      const record = inputData;
      if (record.stop || !shouldInvestigate(record)) return persist(record);
      log(`Both reviews failed, so the Investigation playbook runs before the stop.`);
      const findings = await deps.investigate({
        root: deps.root,
        card: record.card,
        pr: record.pr,
        determinations: record.reviews.map(review => ({ round: review.round, sha: review.sha, answer: review.answer })),
        playbookText: deps.readPlaybook(INVESTIGATION_PLAYBOOK),
        mayPost: deps.mayPost,
        modelId: deps.builderModel,
        runDir: deps.runDir,
        checkout: record.checkout,
      });
      const rootCause = rootCauseFrom(findings.answer);
      return persist({
        ...record,
        stop: {
          reason: stopReason(record),
          rootCause,
          threadId: findings.threadId ?? null,
          ping: null,
        },
      });
    },
  });

  const finish = createStep({
    ...withRecord,
    id: 'finish',
    execute: async ({ inputData }) => {
      const record = inputData;
      if (!record.stop) return persist(record);
      if (record.stop.ping) return persist(record);
      if (!deps.mayPost) {
        log('Left the stop unposted because the run was asked not to post.');
        return persist(record);
      }
      log(`Pinging Todd about the stop on ${record.card.identifier}.`);
      const ping = await deps.ping({ record, message: stopMessage(record) });
      return persist({ ...record, stop: { ...record.stop, ping: ping ?? null } });
    },
  });

  const workflow = createWorkflow({
    id: WORKFLOW_ID,
    inputSchema: startSchema,
    outputSchema: recordSchema,
  })
    .then(gather)
    .then(reviewStep(1))
    .then(remediate)
    .then(reviewStep(2))
    .then(investigate)
    .then(finish)
    .commit();

  mastra.addWorkflow(workflow);
  // A workflow carries a `then` method for building the graph, so an async
  // function that returned it would be awaited as a promise and never settle.
  return { workflow };
}
