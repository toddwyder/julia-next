#!/usr/bin/env node
// monday-note-run.mjs -- issue #180: the weekly systemd entrypoint.
// Reads Factory cards and authenticated Mastra billing spans, then publishes
// public GitHub Issues for missed completed weeks. Database, trace reads and
// publishing are injected at the external boundaries for verification.
//
// `main()` is the only place real clients and the real clock are wired, and it
// reads its configuration from the environment the timer's unit file sets. A
// failed read throws out of the run, `main` exits non-zero, and the journal
// records the failure -- a failed run never posts a fabricated week. The timer
// entrypoint runs the backfill, so a multi-week outage produces all the missing
// notes, bounded per invocation.
import { readFactoryCards } from './factory-cards.mjs';
import { pathToFileURL } from 'node:url';
import { readTraceSpans, normalizeTraceSpans } from './mastra-traces.mjs';
import {
  MONDAY_NOTE_CATEGORY,
  buildMondayNote,
  completedWeeks,
  noteTitle,
  postMondayNote,
  publishMondayNote,
  previousWeekWindow,
} from './monday-note.mjs';
import { createIssuesClient, createPublisherIssuesClient } from './monday-note-adapters.mjs';

/**
 * How many missed weeks one invocation publishes before stopping. A long outage
 * (or first install) is a backlog, not a reason to hold one process open for
 * hours; the next timer fire continues from the first week still missing. The
 * lookup by title is the cursor, so this bound never skips a week.
 */
export const DEFAULT_MAX_BACKFILL_WEEKS = 8;
export const TRACE_RETENTION_DAYS = 14;

/**
 * Run one Monday note for the week before `now`.
 *
 * A read failure propagates and nothing is posted. When the week already has
 * its published issue/discussion, `publishMondayNote` posts nothing.
 */
export async function runMondayNote({ now, readCards, readSpans, issues, discussions, notifications, projectId }) {
  const window = previousWeekWindow({ now });

  // Before the first Monday after observability switch-on there is no completed
  // week. Posting a "quiet week" then would create an issue that the first
  // real note cannot replace, so the run is a no-op.
  if (window.from === window.to) {
    console.log(`monday-note week=${window.from}..${window.to} skipped=no-completed-week`);
    return { posted: false, reason: 'no completed week', url: null, window };
  }

  // Read both sources before publishing anything: a partial week must not be
  // posted. If either read throws, the caller sees the failure and stops.
  const cards = await readCards();
  const spans = await readSpans({ from: window.from, to: window.to });
  const traces = normalizeTraceSpans(spans, { cards, projectId });

  const note = buildMondayNote({ cards, traces, from: window.from, to: window.to });
  const result = await publishMondayNote({ note, issues, discussions, notifications });

  // The one line that stays in the journal, so the weekly record is auditable.
  console.log(
    `monday-note week=${window.from}..${window.to} cards=${note.lines.length} ` +
      `known_spend_usd=${note.totalUsd.toFixed(6)} token_gaps=${note.namedGaps.noTokenCount} unpriced_calls=${note.namedGaps.unpricedModels} posted=${result.posted} url=${result.url ?? ''}`,
  );
  return { ...result, note, window };
}

/**
 * Backfill every missed complete Monday-to-Monday week, oldest first.
 *
 * The dedupe cursor is GitHub Issues itself: a week is missing when no
 * issue carries its title. That makes the run idempotent and safe across a
 * multi-week outage -- every week from observability switch-on to the last
 * completed week is produced exactly once, however many Mondays were missed.
 * The batch is bounded so one invocation never runs unbounded; the next fire
 * finds the same missing weeks and continues, because a published week now has
 * its issue and is skipped.
 */
export async function runMondayNoteBackfill({
  now,
  readCards,
  readSpans,
  issues,
  discussions,
  notifications,
  projectId,
  maxWeeksPerRun = DEFAULT_MAX_BACKFILL_WEEKS,
  traceRetentionDays = TRACE_RETENTION_DAYS,
  log = console.log,
}) {
  const weeks = completedWeeks({ now });
  if (weeks.length === 0) {
    log(`monday-note skipped=no-completed-week`);
    return { posted: false, published: [], reason: 'no completed week' };
  }

  const publisher = issues ?? discussions;
  if (!publisher) throw new Error('runMondayNoteBackfill requires an issues or discussions client');

  // Read the cards once: the same snapshot is spliced into every week's note.
  const cards = await readCards();

  // The lookup is the cursor. Check every week, oldest first, so the batch is
  // the oldest missing weeks and no week is ever skipped past its turn.
  const missing = [];
  for (const week of weeks) {
    const title = noteTitle(week.to);
    const query = (publisher === discussions) ? { category: MONDAY_NOTE_CATEGORY, title } : { title };
    const existing = await publisher.find(query);
    if (!existing) missing.push(week);
  }

  const batch = missing.slice(0, maxWeeksPerRun);
  // The DuckDB store prunes spans by age. An empty read of an expired week
  // cannot distinguish a quiet week from erased measurements.
  const oldestRetained = Date.parse(now) - traceRetentionDays * 24 * 60 * 60 * 1000;
  if (batch.some(week => Date.parse(week.from) <= oldestRetained)) {
    throw new Error('Monday note cannot backfill an expired week: trace retention may have erased its costs');
  }
  const published = [];
  for (const week of batch) {
    const spans = await readSpans({ from: week.from, to: week.to });
    const traces = normalizeTraceSpans(spans, { cards, projectId });
    const note = buildMondayNote({ cards, traces, ...week });
    const url = await postMondayNote({ note, issues, discussions, publisher });
    published.push({ from: week.from, to: week.to, title: note.title, url, quiet: note.quiet, cards: note.lines.length, totalUsd: note.totalUsd });
    log(
      `monday-note week=${week.from}..${week.to} cards=${note.lines.length} ` +
        `known_spend_usd=${note.totalUsd.toFixed(6)} token_gaps=${note.namedGaps.noTokenCount} unpriced_calls=${note.namedGaps.unpricedModels} posted=true url=${url}`,
    );
  }

  // One notification if a notifier is provided (legacy support).
  if (published.length > 0 && notifications?.notify) {
    const newest = published.at(-1);
    const body = published.length === 1
      ? (newest.quiet ? 'Quiet week.' : `${newest.cards} card(s), ${newest.totalUsd.toFixed(2)} USD`)
      : `${published.length} missed weeks backfilled (${published[0].title.slice(0, 10)} to ${newest.title.slice(0, 10)}).`;
    await notifications.notify({ title: newest.title, body, url: newest.url });
  }

  if (missing.length > batch.length) {
    log(`monday-note backfill: ${missing.length - batch.length} older week(s) still missing; the next run continues`);
  }

  return {
    posted: published.length > 0,
    published,
    remaining: missing.length - batch.length,
    reason: published.length > 0 ? 'backfilled' : 'already published',
  };
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the Monday note`);
  return value;
}

/**
 * The real wiring. GitHub token and repository come from the
 * environment the timer unit sets from the root-owned config, never from argv.
 */
async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  const { runPsql } = await import('./run-psql.mjs');
  const config = {
    database: process.env.MONDAY_NOTE_DATABASE ?? 'julia_factory_trial',
    project_id: requiredEnv('MONDAY_NOTE_PROJECT_ID'),
  };

  const factoryUrl = process.env.MONDAY_NOTE_FACTORY_URL?.trim() || (isDryRun ? 'http://127.0.0.1:4111' : requiredEnv('MONDAY_NOTE_FACTORY_URL'));
  const token = requiredEnv('MONDAY_NOTE_TRACE_TOKEN');

  // `--dry-run` reads both sources and prints the note without posting,
  // so an operator can check a week before the timer ever fires.
  if (isDryRun) {
    // An operator may preview the current partial week; scheduled publication
    // continues to use completed weeks only.
    const fromArg = process.argv.indexOf('--from');
    const toArg = process.argv.indexOf('--to');
    const window = fromArg >= 0 && toArg >= 0
      ? { from: process.argv[fromArg + 1], to: process.argv[toArg + 1] }
      : previousWeekWindow({ now: new Date().toISOString() });
    if (!Number.isFinite(Date.parse(window.from)) || !Number.isFinite(Date.parse(window.to)) || Date.parse(window.from) > Date.parse(window.to)) throw new Error('Invalid dry-run window');
    const cards = await readFactoryCards({ config, runPsql });
    const spans = await readTraceSpans({ factoryUrl, token, from: window.from, to: window.to, log: console.error });
    const note = buildMondayNote({ cards, traces: normalizeTraceSpans(spans, { cards, projectId: config.project_id }), ...window });
    console.log(note.body);
    return;
  }

  const owner = requiredEnv('MONDAY_NOTE_GITHUB_OWNER');
  const repo = requiredEnv('MONDAY_NOTE_GITHUB_REPO');
  const issues = process.env.MONDAY_NOTE_USE_PUBLISHER_APP === '1'
    ? await createPublisherIssuesClient()
    : createIssuesClient({ token: requiredEnv('MONDAY_NOTE_GITHUB_TOKEN'), owner, repo });

  await runMondayNoteBackfill({
    now: new Date().toISOString(),
    readCards: () => readFactoryCards({ config, runPsql }),
    readSpans: ({ from, to }) => readTraceSpans({ factoryUrl, token, from, to, log: console.log }),
    issues,
    projectId: config.project_id,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`monday-note: failed: ${error.message}`);
    process.exit(1);
  });
}
