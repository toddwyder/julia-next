// Criterion 2 of JUL-310: once the change is landed, how long the card took and
// how many review rounds it ran are recorded beside the card's scorecard. The
// scorecard is generated from Mastra's own records and would overwrite anything
// appended to it, so the landing facts go in their own file next to it, and the
// same numbers are repeated in the merge comment where a person reads them.

import fs from 'node:fs';
import path from 'node:path';

const MINUTE = 60_000;

export function durationBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const minutes = Math.max(0, Math.round((end - start) / MINUTE));
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const rest = minutes % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (rest || parts.length === 0) parts.push(`${rest}m`);
  return { minutes, human: parts.join(' ') };
}

export function landingPath(root, card) {
  return path.join(root, 'docs', 'scorecards', `${card}.landing.json`);
}

export function landingRecord({
  card,
  pr,
  mergeCommit,
  startedAt,
  startedFrom,
  mergedAt,
  verdicts = [],
  model = null,
  workflowRunId = null,
  landingUrl = null,
}) {
  return {
    card,
    pullRequest: pr,
    mergeCommit,
    mergedAt,
    startedAt,
    startedFrom,
    duration: durationBetween(startedAt, mergedAt),
    reviews: { rounds: verdicts.length, verdicts },
    model,
    workflowRunId,
    landingUrl,
    recordedAt: new Date().toISOString(),
  };
}

export function landingLines(record) {
  const took = record.duration ? `**${record.duration.human}**` : 'not measurable';
  const from = record.startedFrom ? ` (from ${record.startedFrom})` : '';
  const rounds = record.reviews?.rounds ?? 0;
  const ran = record.reviews?.verdicts?.join(' → ') || 'no Shipping round recorded';
  return [
    `- Took ${took}, ${record.startedAt} to ${record.mergedAt}${from}`,
    `- ${rounds} Shipping round${rounds === 1 ? '' : 's'}: ${ran}`,
    `- Recorded beside the scorecard in \`docs/scorecards/${record.card}.landing.json\``,
  ];
}

export function writeLanding({ root, record, writeImpl = fs.writeFileSync, mkdirImpl = fs.mkdirSync }) {
  const file = landingPath(root, record.card);
  mkdirImpl(path.dirname(file), { recursive: true });
  writeImpl(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}
