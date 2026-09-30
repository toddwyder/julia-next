#!/usr/bin/env node
// monday-note-run.mjs -- issue #140, blocker 1: the production entrypoint a
// systemd timer runs. It reads Factory's card records and Mastra's trace costs,
// builds the week's note, posts it as a GitHub Discussion in the "Monday notes"
// category, and tells Todd once.
//
// Every seam is injected so `runMondayNote` is testable without a database,
// GitHub, Discord or the Factory API:
//   - `readCards`   -> ops/factory/factory-cards.mjs (read-only Factory records)
//   - `readSpans`   -> ops/factory/mastra-traces.mjs (Mastra's observability API)
//   - `discussions` -> ops/factory/monday-note-adapters.mjs (GitHub GraphQL)
//   - `notifications` -> Discord wait-alert webhook
//
// `main()` is the only place real clients and the real clock are wired, and it
// reads its configuration from the environment the timer's unit file sets. A
// failed read throws out of `runMondayNote`, `main` exits non-zero, and the
// journal records the failure -- a failed run never posts a fabricated week.
import { readFactoryCards } from './factory-cards.mjs';
import { readTraceSpans, normalizeTraceSpans } from './mastra-traces.mjs';
import { buildMondayNote, publishMondayNote, previousWeekWindow } from './monday-note.mjs';
import { createDiscussionsClient, createDiscordNotifier } from './monday-note-adapters.mjs';

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

  await runMondayNote({
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
