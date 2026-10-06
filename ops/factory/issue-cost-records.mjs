// Durable, structured evidence for one closed Factory or laptop issue (#211).
// This is deliberately a data boundary: it receives already-read traces, card
// history and fallback marks; finalization, retros and trace deletion belong to
// later cards.

export const ISSUE_COST_RECORDS_TABLE = 'factory_issue_cost_records';

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sumKnown(values) {
  return values.some((value) => finite(value) === null) ? null : values.reduce((total, value) => total + value, 0);
}

function elapsedMs(entry) {
  const start = Date.parse(entry.enteredAt);
  const end = Date.parse(entry.exitedAt);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

function stageName(value) {
  return ({ planning: 'plan', execute: 'build', review: 'review' })[value] ?? value;
}

function aggregateTraces(traces) {
  const groups = new Map();
  const gaps = [];
  for (const trace of traces) {
    if (trace.costBearing !== false && finite(trace.costUsd) === null) gaps.push(`trace ${trace.id ?? '(no id)'}: cost unavailable`);
    if (!trace.usage) gaps.push(`trace ${trace.id ?? '(no id)'}: usage unavailable`);
    const key = [trace.phase ?? 'unknown', trace.provider ?? 'unknown', trace.model ?? 'unknown'].join('\u0000');
    const group = groups.get(key) ?? {
      stage: trace.phase ?? 'unknown', provider: trace.provider ?? 'unknown', model: trace.model ?? 'unknown',
      costUsd: 0, freshInputTokens: 0, cachedInputTokens: 0, outputTokens: 0, thinkingTokens: 0,
      unknownUsage: false, unknownCost: false,
    };
    if (finite(trace.costUsd) === null && trace.costBearing !== false) group.unknownCost = true;
    else group.costUsd += finite(trace.costUsd) ?? 0;
    if (!trace.usage) group.unknownUsage = true;
    for (const field of ['freshInputTokens', 'cachedInputTokens', 'outputTokens', 'thinkingTokens']) {
      if (finite(trace.usage?.[field]) === null) group.unknownUsage = true;
      else group[field] += trace.usage[field];
    }
    groups.set(key, group);
  }
  return {
    rows: [...groups.values()].map(({ unknownUsage, unknownCost, ...row }) => unknownUsage || unknownCost
      ? { ...row, costUsd: unknownCost ? null : row.costUsd, freshInputTokens: unknownUsage ? null : row.freshInputTokens, cachedInputTokens: unknownUsage ? null : row.cachedInputTokens, outputTokens: unknownUsage ? null : row.outputTokens, thinkingTokens: unknownUsage ? null : row.thinkingTokens }
      : row),
    gaps,
  };
}

/** Build the versioned, non-presentational record stored as JSONB. */
export function buildIssueCostRecord({ issue, kind, card = {}, pullRequest = {}, traces = [], fallbackMarks = [], reviewRounds = [], rework = [], factoryBotLogin = null }) {
  if (!Number.isSafeInteger(issue?.number) || issue.number <= 0) throw new Error('Issue cost record requires a positive issue number');
  if (!['factory', 'laptop'].includes(kind)) throw new Error('Issue cost record kind must be factory or laptop');
  const { rows, gaps } = aggregateTraces(traces);
  const stages = (kind === 'factory' ? card.stageHistory ?? [] : []).map((entry) => ({
    stage: stageName(entry.stage), actor: entry.exitedBy ?? entry.by ?? 'unknown', durationMs: elapsedMs(entry),
    effort: entry.effort ?? null, stepCount: entry.stepCount ?? null,
  }));
  const recordGaps = [...gaps];
  if (kind === 'laptop') recordGaps.push('builder: subscription, quota only');
  for (const stage of stages) if (stage.durationMs === null) recordGaps.push(`stage ${stage.stage}: duration unavailable`);
  const waits = Array.isArray(card.waits) ? card.waits : [];
  const rescues = kind === 'factory'
    ? (pullRequest.commits ?? []).flatMap((commit) => {
        const actor = commit.author?.login ?? null;
        if (!factoryBotLogin) { recordGaps.push('rescues: Factory bot identity unavailable'); return []; }
        return actor && actor !== factoryBotLogin ? [{ sha: commit.sha ?? null, actor, committedAt: commit.committedAt ?? commit.commit?.author?.date ?? null }] : [];
      })
    : null;
  const fallbackCounts = { poolExhausted: 0, persistentOutage: 0 };
  for (const reason of fallbackMarks) {
    if (reason === 'pool-exhausted') fallbackCounts.poolExhausted += 1;
    else if (reason === 'persistent-outage') fallbackCounts.persistentOutage += 1;
    else throw new Error(`Unsupported persisted pack-fallback reason: ${reason}`);
  }
  return {
    version: 1,
    identity: { issueNumber: issue.number, title: String(issue.title ?? ''), kind, outcome: issue.outcome ?? 'unknown', completedAt: issue.completedAt ?? null },
    cost: { totalUsd: sumKnown(rows.map((row) => row.costUsd)), faceValueUsd: sumKnown(rows.map((row) => row.costUsd)), byProviderModel: rows },
    stages,
    waits, rescues, reviewRounds, rework,
    fallbacks: fallbackCounts,
    gaps: [...new Set(recordGaps)],
    source: { traceCount: traces.length, pullRequestNumber: pullRequest.number ?? null },
  };
}

/** Preserve a cost-bearing review that has no recorded issue id; never infer one from PR text. */
export function buildUnmatchedReviewCostRecord(trace) {
  if (!trace?.id) throw new Error('An unmatched review cost requires its stable trace id');
  if (finite(trace.costUsd) === null) throw new Error(`Unmatched review ${trace.id} has no numeric cost`);
  const { rows, gaps } = aggregateTraces([{ ...trace, phase: 'review' }]);
  return {
    version: 1, recordKey: `unmatched-review:${trace.id}`,
    identity: { kind: 'unmatched-review', traceId: trace.id, completedAt: trace.endedAt ?? null },
    cost: { totalUsd: trace.costUsd, faceValueUsd: trace.costUsd, byProviderModel: rows },
    gaps,
  };
}

/**
 * Read the supported Factory/Mastra boundaries for one already-completed card
 * and persist its structured record. All transports are injected so the same
 * orchestration can run against a captured live card without a hand-built DB
 * reader. The structured journal lines identify the failing connection and
 * card/session context in the service journal without exposing message bodies.
 */
export async function captureIssueCostRecord({
  issue, kind, from, to, factoryBotLogin, readCards, readSpans, normalizeTraces,
  readMessages, readFallbackReasons, readPullRequest, saveRecord, log = console.info,
}) {
  let card = {};
  let pullRequest = {};
  let traces = [];
  let fallbackMarks = [];
  try {
    if (kind === 'factory') {
      log(`issue-cost-record event=read-cards issue=${issue.number}`);
      const cards = await readCards();
      card = cards.find((candidate) => candidate.number === issue.number);
      if (!card) throw new Error(`Factory card #${issue.number} was not found in the captured card read`);
      log(`issue-cost-record event=read-traces issue=${issue.number} from=${from} to=${to}`);
      const spans = await readSpans({ from, to });
      traces = normalizeTraces(spans, { cards: [card] });
      for (const session of Object.values(card.sessions ?? {})) {
        if (!session?.threadId) throw new Error(`Factory card #${issue.number} has a session without a thread id`);
        log(`issue-cost-record event=read-messages issue=${issue.number} thread=${session.threadId}`);
        fallbackMarks.push(...readFallbackReasons(await readMessages({ threadId: session.threadId, resourceId: session.resourceId })));
      }
    } else if (kind === 'laptop') {
      if (!readPullRequest) throw new Error('Laptop capture requires a pull-request reader');
      log(`issue-cost-record event=read-pull-request issue=${issue.number}`);
      pullRequest = await readPullRequest({ issueNumber: issue.number });
    } else {
      throw new Error(`Unsupported issue cost record kind: ${kind}`);
    }
    const record = buildIssueCostRecord({ issue, kind, card, pullRequest, traces, fallbackMarks, factoryBotLogin });
    const saved = await saveRecord(record);
    log(`issue-cost-record event=saved issue=${issue.number} traces=${traces.length} fallback_marks=${fallbackMarks.length}`);
    return saved;
  } catch (error) {
    log(`issue-cost-record event=failed issue=${issue?.number ?? 'unknown'} kind=${kind} error=${error.message}`);
    throw error;
  }
}

/** Save and read back the record; identical input remains unchanged, later rounds can amend it. */
export async function saveIssueCostRecord({ record, database, runPsql }) {
  const issueNumber = record?.identity?.issueNumber;
  const unmatched = record?.identity?.kind === 'unmatched-review';
  if (!unmatched && !Number.isSafeInteger(issueNumber)) throw new Error('Cannot save an issue cost record without an issue number');
  const key = unmatched ? record.recordKey : `issue:${issueNumber}`;
  if (!key) throw new Error('Cannot save an unmatched review without a stable record key');
  const statement = `INSERT INTO ${ISSUE_COST_RECORDS_TABLE} (record_key, issue_number, record) VALUES (:'record_key', NULLIF(:'issue_number', '')::bigint, :'record_json'::jsonb) ON CONFLICT (record_key) DO UPDATE SET record = EXCLUDED.record WHERE ${ISSUE_COST_RECORDS_TABLE}.record IS DISTINCT FROM EXCLUDED.record; SELECT record::text FROM ${ISSUE_COST_RECORDS_TABLE} WHERE record_key = :'record_key';`;
  const result = await runPsql({
    args: ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', `record_key=${key}`, '-v', `issue_number=${unmatched ? '' : issueNumber}`, '-v', `record_json=${JSON.stringify(record)}`, '-d', database, '-c', statement],
    env: process.env,
  });
  if ((result?.status ?? 0) !== 0) throw new Error(`Could not save issue cost record: ${(result?.stderr ?? '').trim()}`);
  const line = String(result?.stdout ?? '').trim().split(/\r?\n/).at(-1);
  try { return JSON.parse(line); } catch { throw new Error('Issue cost record save did not return a readable record'); }
}
