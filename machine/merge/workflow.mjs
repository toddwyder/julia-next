// The merge machine (JUL-310) as a stock Mastra workflow. One step reads the
// card and the pull request and decides from Shipping's published verdict
// whether the change may land. The next merges it, waits for main CI on the
// merge commit, records how long the card took beside its scorecard, runs the
// retro (with a reflection when the card failed), and sweeps what this card
// left behind. Every step saves the run record first, so a crash leaves the
// finished steps on disk and a rerun continues instead of merging twice.

import fs from 'node:fs';
import path from 'node:path';
import { loadMastra } from '../shipping/harness.mjs';
import { FREE_MODEL } from '../shipping/workflow.mjs';
import { decideLanding, gateNote, parseShippingComment } from './gate.mjs';
import { landingLines, landingPath, landingRecord, writeLanding } from './metrics.mjs';
import { assertLandable, completionComment, retroPathFor } from './land.mjs';

export const WORKFLOW_ID = 'merge';
export const MERGE_MODEL = FREE_MODEL;

export async function createMergeWorkflow({ mastra, deps, log = console.log }) {
  const { z, createWorkflow, createStep } = await loadMastra();

  const object = z.record(z.string(), z.any());

  const startSchema = z.object({
    pr: z.number(),
    card: z.string(),
    resume: object.nullable().optional().default(null),
  });

  const recordSchema = z.object({
    pr: z.number(),
    card: z.object({
      identifier: z.string(),
      title: z.string(),
      description: z.string().nullable(),
      url: z.string().nullable(),
    }),
    pull: object,
    head: z.string(),
    decision: object,
    changed: z.array(z.string()).default([]),
    checks: object.nullable().default(null),
    merge: object.nullable().default(null),
    ci: object.nullable().default(null),
    metrics: object.nullable().default(null),
    retro: object.nullable().default(null),
    publish: object.nullable().default(null),
    sweep: object.nullable().default(null),
    completion: object.nullable().default(null),
    failed: z.string().nullable().default(null),
    stop: object.nullable().default(null),
  });

  const withRecord = { inputSchema: recordSchema, outputSchema: recordSchema };

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
      const saved = inputData.resume && inputData.resume.card?.identifier === inputData.card ? inputData.resume : null;
      const pull = deps.readPull(inputData.pr);
      const decision = decideLanding({
        comments: deps.readComments(inputData.pr),
        card: inputData.card,
        pr: inputData.pr,
        head: pull.headSha,
      });
      if (!decision.pass) throw new Error(gateNote(decision));
      assertLandable({ pull, decision });
      const changed = deps.changedFiles(inputData.pr);
      log(`${gateNote(decision)} The pull request touches ${changed.length} file(s).`);
      return persist({
        pr: inputData.pr,
        card: {
          identifier: issue.identifier ?? inputData.card,
          title: issue.title ?? '',
          description: issue.description ?? '',
          url: issue.url ?? null,
        },
        pull,
        head: pull.headSha,
        decision,
        changed,
        checks: saved?.checks ?? null,
        merge: saved?.merge ?? null,
        ci: saved?.ci ?? null,
        metrics: saved?.metrics ?? null,
        retro: saved?.retro ?? null,
        publish: saved?.publish ?? null,
        sweep: saved?.sweep ?? null,
        completion: saved?.completion ?? null,
        failed: saved?.failed ?? null,
        stop: saved?.stop ?? null,
      });
    },
  });

  // Branch protection is the forge's job, and a refusal reads like a fault. The machine
  // reads the pull request's own checks first, so a failing check is a result it can name.
  const checks = createStep({
    ...withRecord,
    id: 'checks',
    execute: async ({ inputData }) => {
      const record = inputData;
      if (record.merge || record.checks?.green) return persist(record);
      const outcome = await deps.waitChecks({ pr: record.pr });
      log(outcome.reason);
      const kept = {
        green: outcome.green,
        reason: outcome.reason,
        failed: (outcome.failed ?? []).map(check => `${check.name} ${check.state}`),
      };
      if (outcome.green) return persist({ ...record, checks: kept });
      return persist({ ...record, checks: kept, failed: outcome.reason, stop: { reason: outcome.reason } });
    },
  });

  const land = createStep({
    ...withRecord,
    id: 'land',
    execute: async ({ inputData }) => {
      const record = inputData;
      if (record.stop) return persist(record);
      if (record.merge) {
        if (record.pull?.head) {
          const gone = await deps.deleteBranch({ ref: record.pull.head });
          if (gone) log(`Deleted ${record.pull.head}, which the merge left behind.`);
        }
        const checkout = deps.prepareMain({ sha: record.merge.commit });
        return persist({ ...record, merge: { ...record.merge, checkout } });
      }
      let pull = record.pull;
      if (pull.state === 'MERGED' && pull.mergeCommit) {
        log(`Pull request #${record.pr} was already merged at ${pull.mergeCommit}.`);
      } else {
        log(`Merging pull request #${record.pr} at ${record.head}.`);
        deps.merge({ pr: record.pr, head: record.head });
        pull = await deps.waitMerged({ pr: record.pr });
      }
      if (pull.base !== 'main') throw new Error(`pull request #${record.pr} merged into ${pull.base}, not main`);
      if (pull.head) {
        const gone = await deps.deleteBranch({ ref: pull.head });
        log(gone ? `Deleted ${pull.head} so repository hygiene still passes on main.` : `${pull.head} was already gone.`);
      }
      const checkout = deps.prepareMain({ sha: pull.mergeCommit });
      log(`The main line is checked out at ${pull.mergeCommit} in ${checkout}.`);
      const merge = { commit: pull.mergeCommit, mergedAt: pull.mergedAt, url: pull.url, checkout };
      return persist({ ...record, pull, merge });
    },
  });

  const ci = createStep({
    ...withRecord,
    id: 'ci',
    execute: async ({ inputData }) => {
      const record = inputData;
      if (!record.merge || record.ci) return persist(record);
      const outcome = await deps.waitCi({ sha: record.merge.commit });
      log(outcome.reason);
      const ci = { green: outcome.green, reason: outcome.reason, runs: outcome.runs };
      if (outcome.green) return persist({ ...record, ci });
      return persist({ ...record, ci, failed: outcome.reason, stop: { reason: outcome.reason } });
    },
  });

  const metrics = createStep({
    ...withRecord,
    id: 'metrics',
    execute: async ({ inputData }) => {
      const record = inputData;
      if (!record.merge) return persist(record);
      // A rerun recreates the main worktree, which drops a file an earlier run
      // wrote. The numbers are still in the record, so they are written again —
      // unless they already went to main with the record's own pull request.
      if (record.publish?.commit) return persist(record);
      if (record.metrics && fs.existsSync(record.metrics.file)) return persist(record);
      const first = deps.firstCommitAt(record.pr);
      const entry = landingRecord({
        card: record.card.identifier,
        pr: record.pr,
        mergeCommit: record.merge.commit,
        startedAt: first.at,
        startedFrom: first.from,
        mergedAt: record.merge.mergedAt,
        verdicts: record.decision.verdicts,
        model: deps.modelId,
        workflowRunId: deps.runId ?? null,
        landingUrl: null,
      });
      const file = landingPath(record.merge.checkout, record.card.identifier);
      writeLanding({ root: record.merge.checkout, record: entry });
      log(landingLines(entry).join(' '));
      return persist({ ...record, metrics: { ...entry, file } });
    },
  });

  const retro = createStep({
    ...withRecord,
    id: 'retro',
    execute: async ({ inputData }) => {
      const record = inputData;
      if (!record.merge) return persist(record);
      if (record.publish?.commit) return persist(record);
      const written = record.retro?.file && path.join(record.merge.checkout, record.retro.file);
      if (record.retro?.ok && written && fs.existsSync(written)) return persist(record);
      const retroPath = retroPathFor(record.card.identifier);
      const determinations = deps
        .readComments(record.pr)
        .map(comment => ({ ...parseShippingComment(comment), body: comment.body }))
        .filter(comment => comment.verdict);
      const outcome = await deps.retro({
        card: record.card.identifier,
        pr: record.pr,
        title: record.card.title,
        mergeCommit: record.merge.commit,
        checkout: record.merge.checkout,
        retroPath,
        determinations,
        changed: record.changed,
        failed: record.failed,
        metrics: record.metrics ? `${record.metrics.duration.human}, ${record.metrics.reviews.rounds} Shipping rounds` : null,
      });
      if (!outcome.ok) {
        return persist({
          ...record,
          retro: { ok: false, reason: outcome.reason, file: null, commit: null },
          stop: record.stop ?? { reason: outcome.reason },
        });
      }
      log(`The retro is written at ${retroPath}.`);
      return persist({ ...record, retro: { ok: true, reason: outcome.reason, file: retroPath } });
    },
  });

  // Main is protected, so the record cannot be pushed straight onto it. One
  // pull request carries the landing facts and the retro, the machine waits for
  // its checks and merges it, and the card's own branch is left to the sweep.
  const publish = createStep({
    ...withRecord,
    id: 'publish',
    execute: async ({ inputData }) => {
      const record = inputData;
      if (!record.merge || record.publish) return persist(record);
      const files = [record.metrics?.file, record.retro?.file && path.join(record.merge.checkout, record.retro.file)];
      const present = files.filter(file => file && fs.existsSync(file));
      if (!present.length) {
        log('Nothing was written about this run, so there is nothing to publish.');
        return persist({ ...record, publish: { url: null, branch: null, commit: null, files: [] } });
      }
      const branch = `docs/${String(record.card.identifier).toLowerCase()}-landing`;
      // The title carries no card id on purpose: a pull request that names a card
      // must also carry that card's scorecard, and this one records rather than ships.
      const title = `Record how the card went: ${record.metrics?.duration?.human ?? 'duration unmeasured'}, ${record.metrics?.reviews?.rounds ?? 0} Shipping rounds`;
      const body = [
        'The merge machine writes down how long a card took, how many Shipping rounds it ran, and what the retro found.',
        '',
        'No card: this is the merge machine recording a card that is already merged.',
      ].join('\n');
      const bodyPath = path.join(deps.runDir, 'publish-body.md');
      fs.writeFileSync(bodyPath, `${body}\n`);
      const done = await deps.publish({ checkout: record.merge.checkout, branch, title, body, bodyPath, files: present, git: deps.git, log });
      return persist({ ...record, publish: done });
    },
  });

  const sweep = createStep({
    ...withRecord,
    id: 'sweep',
    execute: async ({ inputData }) => {
      const record = inputData;
      if (!record.merge || record.sweep) return persist(record);
      const outcome = await deps.sweep({
        card: record.card.identifier,
        pr: record.pr,
        head: record.head,
        checkout: record.merge.checkout,
        changed: record.changed,
      });
      log(outcome.summary);
      return persist({ ...record, sweep: { ...outcome, noticed: [...(outcome.noticed ?? []), ...(record.sweep?.noticed ?? [])] } });
    },
  });

  const complete = createStep({
    ...withRecord,
    id: 'complete',
    execute: async ({ inputData }) => {
      const record = inputData;
      if (!record.merge || record.completion) return persist(record);
      if (record.stop && !record.ci?.green) {
        log(`The card stays in progress: ${record.stop.reason}`);
        return persist(record);
      }
      const comments = deps.cardComments(record.card.identifier);
      if (deps.alreadyCompleted(comments, { card: record.card.identifier, mergeCommit: record.merge.commit })) {
        log(`${record.card.identifier} already carries a merge comment for ${record.merge.commit}.`);
        return persist(record);
      }
      const comment = completionComment({
        card: record.card.identifier,
        title: record.card.title,
        pr: record.pr,
        mergeCommit: record.merge.commit,
        decision: record.decision,
        record: record.metrics,
        mergeUrl: record.merge.url,
      });
      const done = await deps.completeCard({ card: record.card.identifier, comment });
      log(`${record.card.identifier} is Complete in Linear with ${record.merge.commit} in a comment: ${done.url ?? done.state ?? 'recorded'}`);
      return persist({ ...record, completion: done });
    },
  });

  const workflow = createWorkflow({ id: WORKFLOW_ID, inputSchema: startSchema, outputSchema: recordSchema })
    .then(gather)
    .then(checks)
    .then(land)
    .then(ci)
    .then(metrics)
    .then(retro)
    .then(publish)
    .then(sweep)
    .then(complete)
    .commit();

  mastra.addWorkflow(workflow);
  return { workflow };
}
