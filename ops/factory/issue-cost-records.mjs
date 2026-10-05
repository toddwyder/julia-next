// Durable, structured evidence for one closed Factory or laptop issue (#211).
// This is deliberately a data boundary: it receives already-read traces, card
// history and fallback marks; finalization, retros and trace deletion belong to
// later cards.

export const ISSUE_COST_RECORDS_TABLE = 'factory_issue_cost_records';

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sum(values) {
  return values.reduce((total, value) => total + (finite(value) ?? 0), 0);
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
      unknownUsage: false,
    };
    group.costUsd += finite(trace.costUsd) ?? 0;
    if (!trace.usage) group.unknownUsage = true;
    for (const field of ['freshInputTokens', 'cachedInputTokens', 'outputTokens', 'thinkingTokens']) {
      if (finite(trace.usage?.[field]) === null) group.unknownUsage = true;
      else group[field] += trace.usage[field];
    }
    groups.set(key, group);
  }
  return {
    rows: [...groups.values()].map(({ unknownUsage, ...row }) => unknownUsage
      ? { ...row, freshInputTokens: null, cachedInputTokens: null, outputTokens: null, thinkingTokens: null }
      : row),
    gaps,
  };
}

/** Build the versioned, non-presentational record stored as JSONB. */
export function buildIssueCostRecord({ issue, kind, card = {}, pullRequest = {}, traces = [], fallbackMarks = [] }) {
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
  const fallbackCounts = { poolExhausted: 0, persistentOutage: 0 };
  for (const reason of fallbackMarks) {
    if (reason === 'pool-exhausted') fallbackCounts.poolExhausted += 1;
    else if (reason === 'persistent-outage') fallbackCounts.persistentOutage += 1;
    else throw new Error(`Unsupported persisted pack-fallback reason: ${reason}`);
  }
  return {
    version: 1,
    identity: { issueNumber: issue.number, title: String(issue.title ?? ''), kind, outcome: issue.outcome ?? 'unknown', completedAt: issue.completedAt ?? null },
    cost: { totalUsd: sum(rows.map((row) => row.costUsd)), faceValueUsd: sum(rows.map((row) => row.costUsd)), byProviderModel: rows },
    stages,
    waits: [], rescues: kind === 'factory' ? [] : null, reviewRounds: [], rework: [],
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

/** Insert once, then return exactly the database value; replay never overwrites it. */
export async function saveIssueCostRecord({ record, database, runPsql }) {
  const issueNumber = record?.identity?.issueNumber;
  const unmatched = record?.identity?.kind === 'unmatched-review';
  if (!unmatched && !Number.isSafeInteger(issueNumber)) throw new Error('Cannot save an issue cost record without an issue number');
  const key = unmatched ? record.recordKey : `issue:${issueNumber}`;
  if (!key) throw new Error('Cannot save an unmatched review without a stable record key');
  const statement = `INSERT INTO ${ISSUE_COST_RECORDS_TABLE} (record_key, issue_number, record) VALUES (:'record_key', NULLIF(:'issue_number', '')::bigint, :'record_json'::jsonb) ON CONFLICT (record_key) DO NOTHING; SELECT record::text FROM ${ISSUE_COST_RECORDS_TABLE} WHERE record_key = :'record_key';`;
  const result = await runPsql({
    args: ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', `record_key=${key}`, '-v', `issue_number=${unmatched ? '' : issueNumber}`, '-v', `record_json=${JSON.stringify(record)}`, '-d', database, '-c', statement],
    env: process.env,
  });
  if ((result?.status ?? 0) !== 0) throw new Error(`Could not save issue cost record: ${(result?.stderr ?? '').trim()}`);
  const line = String(result?.stdout ?? '').trim().split(/\r?\n/).at(-1);
  try { return JSON.parse(line); } catch { throw new Error('Issue cost record save did not return a readable record'); }
}
