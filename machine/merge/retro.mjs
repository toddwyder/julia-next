// Criterion 3 of JUL-310: the retro runs on the card, and when the card failed
// the machine reflects on why. The retro is an agent because a retro is
// reading, not formatting. It gets the card, the change, and every Shipping
// determination, writes one doc in the same shape as the retros already in
// docs/retros, and the machine checks the file exists and says what it must
// before anything is committed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scratchDir } from '../../scripts/scratch-dir.mjs';

import { bootHarness, loadMastra, stopHarness } from '../shipping/harness.mjs';
import { FREE_MODEL, reviewLimitNote, runWithinTimeLimit } from '../shipping/workflow.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../..');
export const RETRO_SKILL = '.agents/skills/correct/SKILL.md';
export const REFLECT_SKILL = '.agents/skills/reflect/SKILL.md';
export const RETRO_TIME_LIMIT_MS = 20 * 60_000;

const TRANSIENT = /(429|rate[ -]?limit|too many requests|temporarily unavailable|overloaded|ECONNRESET|socket hang up)/i;
const RETRY_WAITS_MS = [30_000, 90_000];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function retroPathFor(card) {
  return `docs/retros/${String(card).toLowerCase()}.md`;
}

export function retroTask({ card, pr, title, mergeCommit, checkout, retroPath, determinations = [], changed = [], failed = null, metrics = null }) {
  const verdicts = determinations.map((item, index) => [
    `Determination ${index + 1}: ${item.verdict ?? 'NO VERDICT'} on ${item.sha ?? 'an unknown commit'}`,
    item.body ? `--- begins ---\n${truncate(item.body, 3000)}\n--- ends ---` : '',
  ].filter(Boolean).join('\n')).join('\n\n');

  const lines = [
    `You are the retro agent for ${card} in this checkout. The change has landed on main.`,
    '',
    `Read ${path.join(repoRoot, RETRO_SKILL)} first and follow it. Read ${path.join(repoRoot, retroPathFor('jul-301'))} for the shape this repository's retros already use.`,
    '',
    `The card is ${card}: ${title}. Its change is ${mergeCommit} on main, squash of pull request #${pr}.`,
    '',
    changed.length ? `Files the change touched:\n${changed.map(file => `- ${file}`).join('\n')}` : 'The change touched no file the machine could list.',
    '',
    metrics ? `How long it took and how many review rounds it ran: ${metrics}` : '',
    '',
    'Every Shipping determination on the pull request, quoted:',
    '',
    verdicts || 'No determination was recorded.',
    '',
    `Write exactly one file: ${retroPath}. Nothing else. Do not commit, do not push, do not edit the card, and do not move, rename or delete any other file.`,
    '',
    'The doc must hold, in this order:',
    '1. A title naming the card and what shipped, and a paragraph naming the commit and the pull request.',
    '2. Numbered findings. Each one names its severity, what actually happened with the evidence you can see, the check that would catch it, and whether it is built or still open. Only write a finding you can point at evidence for; a thin retro that says so is worth more than an invented one.',
    failed
      ? '3. A section headed exactly `## Reflection: why the card failed`, quoting the failing criteria from the determinations below and naming the cause you can defend from that evidence. This card failed at least one Shipping round, so this section is required.'
      : '3. A short closing paragraph on what the machine should keep doing.',
    '',
    'The last line of your answer must be exactly `RETRO: written <path>` or `RETRO: blocked <one sentence why>`.',
  ];
  return lines.filter(line => line !== '').join('\n');
}

function truncate(text, limit) {
  const value = String(text);
  return value.length > limit ? `${value.slice(0, limit)}\n[cut at ${limit} characters]` : value;
}

async function ask(subagent, payload, context, { log = () => {} } = {}) {
  for (let attempt = 0; ; attempt++) {
    const result = await subagent.execute(payload, context);
    const text = String(result?.content ?? '');
    const transient = TRANSIENT.test(text) && (/failed/i.test(text) || result?.isError);
    if (!transient) return { text, isError: Boolean(result?.isError) };
    if (attempt >= RETRY_WAITS_MS.length) return { text, isError: true };
    log(`The model service is busy; waiting ${Math.round(RETRY_WAITS_MS[attempt] / 1000)}s and asking again.`);
    await sleep(RETRY_WAITS_MS[attempt]);
  }
}

export function retroOutcome({ text, isError, file, failed }) {
  const answer = String(text ?? '').trim();
  const said = answer.split(/\r?\n/).filter(Boolean).at(-1) ?? '';
  if (isError && !said.startsWith('RETRO:')) return { ok: false, reason: `the retro agent failed: ${answer.slice(0, 400)}`, answer, file: null };
  const blocked = /^RETRO: blocked\b/i.test(said);
  if (blocked) return { ok: false, reason: said.replace(/^RETRO: blocked\s*/i, '') || 'the retro agent blocked', answer, file: null };
  if (!fs.existsSync(file)) return { ok: false, reason: `the retro agent wrote no file at ${file}`, answer, file: null };
  const body = fs.readFileSync(file, 'utf8');
  if (body.trim().length < 200) return { ok: false, reason: `the retro doc at ${file} is too thin to be a retro`, answer, file: null };
  if (!/^##\s+/m.test(body)) return { ok: false, reason: `the retro doc at ${file} has no sections`, answer, file: null };
  if (failed && !/^##\s+Reflection: why the card failed\s*$/m.test(body)) {
    return { ok: false, reason: `the card failed but ${file} has no "## Reflection: why the card failed" section`, answer, file: null };
  }
  return { ok: true, reason: said, answer, file, body };
}

export async function runRetro({
  card,
  pr,
  title,
  mergeCommit,
  checkout,
  retroPath,
  determinations = [],
  changed = [],
  failed = null,
  metrics = null,
  modelId = FREE_MODEL,
  timeLimitMs = RETRO_TIME_LIMIT_MS,
  storageName = `merge-retro-${pr}`,
  root = repoRoot,
  log = console.log,
}) {
  const { LibSQLStore } = await loadMastra();
  const file = path.join(checkout, retroPath);
  const storage = new LibSQLStore({ id: storageName, url: `file:${path.join(scratchDir, 'artifacts', 'merge', `pr-${pr}`, `${storageName}.db`)}` });
  const { booted, session, mastra, requestContext, subagent } = await bootHarness({ cwd: checkout, storage });
  try {
    const task = retroTask({ card, pr, title, mergeCommit, checkout, retroPath, determinations, changed, failed, metrics });
    log(`Starting a fresh Execute subagent on ${modelId} for the retro on ${card}.`);
    const answer = await runWithinTimeLimit(
      () => ask(subagent, { agentType: 'execute', task, modelId }, { workspace: session.getWorkspace(), requestContext, mastra }, { log }),
      { limitMs: timeLimitMs, log, onLimit: () => stopHarness(booted) }
    );
    if (answer.timedOut) {
      return { ok: false, reason: `the retro ran ${reviewLimitNote(timeLimitMs)} and was ended`, answer: null, file: null };
    }
    const outcome = retroOutcome({ ...answer.value, file, failed });
    log(outcome.ok ? `The retro doc is at ${file}.` : `The retro did not finish: ${outcome.reason}`);
    return { ...outcome, threadId: null, modelId };
  } finally {
    try {
      await stopHarness(booted);
    } catch {
      // The harness is already down after a timeout; there is nothing to stop.
    }
  }
}

export function listChangedFiles({ git, from, to }) {
  const output = git(['diff', '--name-only', `${from}..${to}`]);
  return output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}
