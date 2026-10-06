// factory-cards.mjs -- issue #140, blocker 1/2: read Factory's own card records.
//
// Factory's board is backed by a `work_items` table, and each card carries a
// server-appended `stage_history` list with the actor that entered and exited
// each stage (`@mastra/factory` storage/domains/work-items/base: WorkItemRow,
// WorkItemStageEntry). The established, approved deployment mechanism to read
// Factory's records is the read-only PostgreSQL route the wait watcher uses:
// one peer role with SELECT only, `PGOPTIONS=-c default_transaction_read_only=on`,
// created by ops/factory/install-wait-alerts.sh. The supported HTTP board route
// (`GET /web/factory/projects/:id/work-items`) sits behind the host sign-in
// gate, which a timer has no session for, so the card reader follows the
// watcher's proven route.
//
// Tests inject `runPsql`, so no test reaches a database. A non-zero exit or an
// unparseable line fails closed; the caller must never turn a failed read into
// a quiet week.

import { readFileSync } from 'node:fs';

function psqlArgs(config) {
  return {
    args: [
      '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
      '-v', `project_id=${config.project_id}`,
      '-d', config.database,
      '-f', config.sqlPath ?? new URL('./factory-cards.sql', import.meta.url).pathname,
    ],
    env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on' },
  };
}

/**
 * One read-only snapshot of the Factory work items for a project, as JSON,
 * including the stage history and session map the note needs. Shipped as
 * `factory-cards.sql`, kept in step with the board's own columns; the query
 * never writes.
 */
export const FACTORY_CARDS_SQL = readFileSync(new URL('./factory-cards.sql', import.meta.url), 'utf8');

/** Match a numeric GitHub issue to Factory's SQL-derived card reference. */
export function isFactoryCardForIssue(card, issueNumber) {
  return Number(card?.number) === issueNumber;
}

/**
 * Map the database snapshot to the card shape `buildMondayNote` reads. A row
 * with no GitHub issue number cannot be named in the note, so it is skipped
 * rather than listed as an anonymous card.
 */
export function normalizeWorkItemRows(rows = []) {
  const cards = [];
  for (const row of rows) {
    const number = typeof row.number === 'number' ? row.number : String(row.number ?? '');
    if ((typeof number === 'number' && (!Number.isSafeInteger(number) || number <= 0)) || !number) {
      throw new Error('Factory card has no usable reference; refusing an incomplete cost report');
    }
    const stageHistory = Array.isArray(row.stage_history) ? row.stage_history : [];
    cards.push({
      number,
      title: row.title,
      board: row.board ?? 'work',
      stages: Array.isArray(row.stages) ? row.stages : [],
      stageHistory,
      sessions: row.sessions ?? {},
      acceptedAt: row.accepted_at ?? null,
      createdAt: row.created_at ?? null,
      enteredAt: row.accepted_at ?? stageHistory[0]?.enteredAt ?? row.created_at ?? null,
    });
  }
  return cards;
}

/**
 * Read the cards through the same read-only psql route the wait watcher uses.
 *
 * @param {{config: object, runPsql: Function}} input
 */
export async function readFactoryCards({ config, runPsql }) {
  const { args, env } = psqlArgs(config);
  const result = await runPsql({ args, env, stdin: undefined });
  const status = result?.status ?? 0;
  if (status !== 0) {
    throw new Error(`Could not read Factory cards: psql exited ${status}: ${(result.stderr ?? '').trim()}`);
  }

  const rows = [];
  for (const line of String(result.stdout ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      throw new Error(`Could not read Factory cards: unexpected row: ${trimmed.slice(0, 120)}`);
    }
  }
  return normalizeWorkItemRows(rows);
}
