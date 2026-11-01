// What a rerun reads before it decides to do anything: the record of the last
// attempt and the rounds that already happened. A crash between two reviews
// must not make the machine post the first determination twice.

import fs from 'node:fs';
import path from 'node:path';

export function recordPath(runDir) {
  return path.join(runDir, 'record.json');
}

export function readRecord(runDir) {
  try {
    return JSON.parse(fs.readFileSync(recordPath(runDir), 'utf8'));
  } catch {
    return null;
  }
}

export function writeRecord(runDir, record) {
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(recordPath(runDir), `${JSON.stringify(record, null, 2)}\n`);
  return recordPath(runDir);
}

export function sameCard(saved, { pr, card }) {
  return Boolean(saved) && saved.pr === pr && saved.card?.identifier === card;
}

export function seedFrom(saved, { pr, card }) {
  if (!sameCard(saved, { pr, card })) return { reviews: [], builder: null };
  return {
    reviews: Array.isArray(saved.reviews) ? saved.reviews : [],
    builder: saved.builder ?? null,
  };
}

export function alreadyFinished(saved, { pr, card }) {
  return sameCard(saved, { pr, card }) && Boolean(saved.stop);
}
