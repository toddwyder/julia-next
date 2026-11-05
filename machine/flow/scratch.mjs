// The stand-in work lives only here. A run gets one scratch folder, and every
// file the path writes is either an artifact in that folder or a record the
// runner keeps beside it. Nothing outside the folder is touched.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FOLDERS = ['build', 'landing', 'retro', 'reports'];

// A machine card's Shipping stand-in reads no queue, but a product card's does,
// and a run started from Studio brings no file of its own. One answer each is
// enough for a stand-in to keep the path moving.
export const DEFAULT_VERDICTS = { review: ['PASS'], smoke: ['PASS'] };

export function openScratch(dir) {
  for (const folder of FOLDERS) mkdirSync(join(dir, folder), { recursive: true });
  return dir;
}

// Each card gets its own folder inside the run's folder, so two cards started
// from Studio keep separate artifacts and separate verdict queues.
export function openRun(dir, card) {
  const runDir = join(dir, card);
  openScratch(runDir);
  const verdicts = join(runDir, 'verdicts.json');
  if (!existsSync(verdicts)) writeJson(verdicts, DEFAULT_VERDICTS);
  const cursors = join(runDir, 'cursors.json');
  if (!existsSync(cursors)) writeJson(cursors, {});
  return runDir;
}

export function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeArtifact(dir, card, text) {
  const path = join(dir, 'build', `${card}.md`);
  writeFileSync(path, `# ${card} build\n\n${text.trim()}\n`);
  return path;
}

export function readArtifact(dir, card) {
  const path = join(dir, 'build', `${card}.md`);
  if (!existsSync(path)) throw new Error(`No stand-in artifact at ${path}`);
  return readFileSync(path, 'utf8');
}

export function writeLanding(dir, card, text) {
  const path = join(dir, 'landing', `${card}.md`);
  writeFileSync(path, `# ${card} landed\n\n${text.trim()}\n`);
  return path;
}

export function writeRetro(dir, card, text) {
  const path = join(dir, 'retro', `${card}.md`);
  writeFileSync(path, `# ${card} retro\n\n${text.trim()}\n`);
  return path;
}

export function writeReport(dir, card, text) {
  const path = join(dir, 'reports', `${card}.md`);
  writeFileSync(path, `${text.trim()}\n`);
  return path;
}

// The verdict is a fixed rule, not a model's opinion. A run is handed a queue
// of answers in verdicts.json, so a test and a proof can make Shipping pass or
// fail on purpose without asking the free model to be unreliable on cue.
export function nextVerdict(dir, queue) {
  const plan = readJson(join(dir, 'verdicts.json'), {});
  const answers = plan[queue];
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new Error(`verdicts.json names no ${queue} answer, so the path cannot decide that stage.`);
  }
  const cursors = readJson(join(dir, 'cursors.json'), {});
  const used = cursors[queue] ?? 0;
  const answer = answers[Math.min(used, answers.length - 1)];
  if (answer !== 'PASS' && answer !== 'FAIL') {
    throw new Error(`verdicts.json ${queue}[${used}] is "${answer}", not PASS or FAIL.`);
  }
  cursors[queue] = used + 1;
  writeJson(join(dir, 'cursors.json'), cursors);
  return answer;
}

export function sweepBuild(dir) {
  rmSync(join(dir, 'build'), { recursive: true, force: true });
}
