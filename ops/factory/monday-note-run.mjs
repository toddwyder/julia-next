#!/usr/bin/env node
// monday-note-run.mjs -- issue #140: the production entrypoint a systemd timer
// runs. It reads Factory's card records and Mastra's trace costs and posts the
// "Monday notes" Discussions, backfilling every missed full week and telling
// Todd once per run.
//
// Every seam is injected so `runMondayNoteBackfill` (and the single-week
// `runMondayNote`) are testable without a database, GitHub, Discord or the
// Factory API:
//   - `readCards`   -> ops/factory/factory-cards.mjs (read-only Factory records)
//   - `readSpans`   -> ops/factory/mastra-traces.mjs (Mastra's observability API)
//   - `discussions` -> ops/factory/monday-note-adapters.mjs (GitHub GraphQL)
//   - `notifications` -> Discord wait-alert webhook
//
// `main()` is the only place real clients and the real clock are wired, and it
// reads its configuration from the environment the timer's unit file sets. A
// failed read throws out of the run, `main` exits non-zero, and the journal
// records the failure -- a failed run never posts a fabricated week. The timer
// entrypoint runs the backfill, so a multi-week outage produces all the missing
// notes, bounded per invocation.
import { readFactoryCards } from './factory-cards.mjs';
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
import { createDiscussionsClient, createDiscordNotifier } from './monday-note-adapters.mjs';

/**
 * How many missed weeks one invocation publishes before stopping. A long outage
 * (or first install) is a backlog, not a reason to hold one process open for
 * hours; the next timer fire continues from the first week still missing. The
 * Discussion lookup by title is the cursor, so this bound never skips a week.
 */
export const DEFAULT_MAX_BACKFILL_WEEKS = 8;

/**
 * Run one Monday note for the week before `now`.
 *
 * A read failure propagates and nothing is posted. When the week already has
 * its Discussion, `publishMondayNote` posts and notifies nothing.
 */
export async function runMondayNote({ now, readCards, readSpans, discussions, notifications }) {
  const window = previousWeekWindow({ now });

  // Before the first Monday after observability switch-on there is no completed
  // week. Posting a "quiet week" then would create a Discussion that the first
  // real note cannot replace, so the run is a no-op.
  if (window.from === window.to) {
    console.log(`monday-note week=${window.from}..${window.to} skipped=no-completed-week`);
    return { posted: false, reason: 'no completed week', url: null, window };
  }

  // Read both sources before publishing anything: a partial week must not be
  // posted. If either read throws, the caller sees the failure and stops.
  const cards = await readCards();
  const spans = await readSpans({ from: window.from, to: window.to });
  const traces = normalizeTraceSpans(spans, { cards });

  const note = buildMondayNote({ cards, traces, from: window.from, to: window.to });
  const result = await publishMondayNote({ note, discussions, notifications });

  // The one line that stays in the journal, so the weekly record is auditable
  // even when the Discussion read fails later.
  console.log(
    `monday-note week=${window.from}..${window.to} cards=${note.lines.length} ` +
      `spend_usd=${note.totalUsd.toFixed(2)} posted=${result.posted} url=${result.url ?? ''}`,
  );
  return { ...result, note, window };
}

/**
 * Backfill every missed complete Monday-to-Monday week, oldest first.
 *
 * The dedupe cursor is GitHub Discussions itself: a week is missing when no
 * Discussion carries its title. That makes the run idempotent and safe across a
 * multi-week outage -- every week from observability switch-on to the last
 * completed week is produced exactly once, however many Mondays were missed.
 * The batch is bounded so one invocation never runs unbounded; the next fire
 * finds the same missing weeks and continues, because a published week now has
 * its Discussion and is skipped.
 *
 * Todd is told once per invocation, not once per backfilled week: a backlog is
 * one event. A re-run that finds nothing missing notifies nothing, so the note
 * is never sent twice.
 */
export async function runMondayNoteBackfill({
  now,
  readCards,
  readSpans,
  discussions,
  notifications,
  maxWeeksPerRun = DEFAULT_MAX_BACKFILL_WEEKS,
  log = console.log,
}) {
  const weeks = completedWeeks({ now });
  if (weeks.length === 0) {
    log(`monday-note skipped=no-completed-week`);
    return { posted: false, published: [], reason: 'no completed week' };
  }

  // Read the cards once: the same snapshot is spliced into every week's note.
  const cards = await readCards();

  // The lookup is the cursor. Check every week, oldest first, so the batch is
  // the oldest missing weeks and no week is ever skipped past its turn.
  const missing = [];
  for (const week of weeks) {
    const title = noteTitle(week.to);
    const existing = await discussions.find({ category: MONDAY_NOTE_CATEGORY, title });
    if (!existing) missing.push(week);
  }

  const batch = missing.slice(0, maxWeeksPerRun);
  const published = [];
  for (const week of batch) {
    const spans = await readSpans({ from: week.from, to: week.to });
    const traces = normalizeTraceSpans(spans, { cards });
    const note = buildMondayNote({ cards, traces, ...week });
    const url = await postMondayNote({ note, discussions });
    published.push({ from: week.from, to: week.to, title: note.title, url, quiet: note.quiet, cards: note.lines.length, totalUsd: note.totalUsd });
    log(
      `monday-note week=${week.from}..${week.to} cards=${note.lines.length} ` +
        `spend_usd=${note.totalUsd.toFixed(2)} posted=true url=${url}`,
    );
  }

  // One notification for the whole invocation. The newest note is the one Todd
  // wants to open; the count tells him a backlog was drained. If nothing was
  // missing, nothing is sent -- a repeated fire cannot notify twice.
  if (published.length > 0) {
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
 * The real wiring. GitHub token, repository and Discord webhook come from the
 * environment the timer unit sets from the root-owned config, never from argv.
 */
async function main() {
  const owner = requiredEnv('MONDAY_NOTE_GITHUB_OWNER');
  const repo = requiredEnv('MONDAY_NOTE_GITHUB_REPO');
  const token = requiredEnv('MONDAY_NOTE_GITHUB_TOKEN');
  const webhookUrl = requiredEnv('MONDAY_NOTE_DISCORD_WEBHOOK');
  const factoryUrl = requiredEnv('MONDAY_NOTE_FACTORY_URL');

  const discussions = createDiscussionsClient({ token, owner, repo });
  const notifications = createDiscordNotifier({ webhookUrl });

  const { runPsql } = await import('./run-psql.mjs');
  const config = {
    database: process.env.MONDAY_NOTE_DATABASE ?? 'julia_factory_trial',
    project_id: requiredEnv('MONDAY_NOTE_PROJECT_ID'),
  };

  // `--dry-run` reads both sources and prints the note without posting or
  // notifying, so an operator can check a week before the timer ever fires.
  if (process.argv.includes('--dry-run')) {
    const window = previousWeekWindow({ now: new Date().toISOString() });
    const cards = await readFactoryCards({ config, runPsql });
    const spans = await readTraceSpans({ factoryUrl, from: window.from, to: window.to });
    const note = buildMondayNote({ cards, traces: normalizeTraceSpans(spans, { cards }), ...window });
    console.log(note.body);
    return;
  }

  await runMondayNoteBackfill({
    now: new Date().toISOString(),
    readCards: () => readFactoryCards({ config, runPsql }),
    readSpans: ({ from, to }) => readTraceSpans({ factoryUrl, from, to }),
    discussions,
    notifications,
  });
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`monday-note: failed: ${error.message}`);
    process.exit(1);
  });
}
