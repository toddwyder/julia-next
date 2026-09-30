// monday-note.mjs -- issue #140, seam 1: the weekly Monday note.
//
// One program, two inputs, one text. The inputs are Factory's own card records
// (the card moves and who made them) and Mastra's trace cost data; the output
// is the plain summary Todd reads, posted as a GitHub Discussion in the
// "Monday notes" category so it never lands in Factory's Intake.
//
// Pure generation only: no network, no storage, no schedule. The publisher and
// the notification live in `publishMondayNote` over injected adapters, and the
// schedule belongs to a systemd timer, exactly like the wait watcher.
//
// Costs are never agent-reported: they are summed from the trace records the
// observability exporter wrote, failed attempts included (CONTEXT.md "Monday
// note").

/** The GitHub Discussions category the note is published in. */
export const MONDAY_NOTE_CATEGORY = 'Monday notes';

/** `$6.60`; two decimals, always, so a figure never reads as rounded prose. */
function usd(value) {
  return `$${value.toFixed(2)}`;
}

/** `4h 12m`, `1h`, `50m` -- the elapsed time Todd asked for, not milliseconds. */
function duration(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

function failedAttemptPhrase(count) {
  if (count <= 0) return null;
  return count === 1 ? '1 failed attempt' : `${count} failed attempts`;
}

function actorName(by) {
  if (by === 'todd') return 'Todd';
  if (by === 'factory') return 'Factory';
  return by;
}

/**
 * The one human action Factory's route expects is Todd's Intake tap. Every
 * movement after it belongs to Factory; anything else is how he tells that
 * someone went around the product (CONTEXT.md "Done by Factory").
 */
function firstStepByHand(movements) {
  return (movements ?? []).slice(1).find((movement) => movement.by !== 'factory');
}

/**
 * A card belongs to a week when it entered the board inside `[from, to)`; a
 * trace belongs when it started in the same window. Everything else is another
 * week's note, so the same card is never counted in two weeks (CONTEXT.md
 * "Monday note": the weekly summary).
 */
function within(instant, from, to) {
  const at = Date.parse(instant);
  return at >= Date.parse(from) && at < Date.parse(to);
}

function cardLine(card, cardTraces) {
  const costUsd = cardTraces.reduce((sum, trace) => sum + (trace.costUsd ?? 0), 0);
  const failedAttempts = cardTraces.filter((trace) => trace.outcome === 'failed-attempt').length;
  const lastMovement = (card.movements ?? []).at(-1);
  const endedAt = card.doneAt ?? lastMovement?.at ?? card.enteredAt;
  const elapsedMs = Date.parse(endedAt) - Date.parse(card.enteredAt);

  const byHand = firstStepByHand(card.movements);
  const doneByFactory = byHand === undefined;
  const parts = [`#${card.number} ${card.title}`, usd(costUsd), duration(elapsedMs)];
  const failedPhrase = failedAttemptPhrase(failedAttempts);
  if (failedPhrase) parts.push(failedPhrase);
  parts.push(doneByFactory ? 'Done by Factory' : `not all by Factory: ${actorName(byHand.by)} ${byHand.what}`);

  return { number: card.number, costUsd, elapsedMs, failedAttempts, doneByFactory, text: parts.join(' — ') };
}

/**
 * Build the note for one week from sample-or-live records.
 *
 * @param {{cards?: Array, traces?: Array, from: string, to: string}} input
 * @returns {{title: string, body: string, quiet: boolean, lines: Array,
 *            totalUsd: number, failedAttempts: number}}
 */
export function buildMondayNote({ cards = [], traces = [], from, to }) {
  const weekCards = cards.filter((card) => within(card.enteredAt, from, to));
  const weekTraces = traces.filter((trace) => within(trace.startedAt, from, to));
  const lines = weekCards.map((card) =>
    cardLine(
      card,
      weekTraces.filter((trace) => trace.card === card.number),
    ),
  );
  const totalUsd = lines.reduce((sum, line) => sum + line.costUsd, 0);
  const failedAttempts = lines.reduce((sum, line) => sum + line.failedAttempts, 0);
  const spentPhrase = failedAttemptPhrase(failedAttempts);

  const body = [
    `Monday note — week ending ${to.slice(0, 10)}`,
    '',
    ...(lines.length > 0 ? lines.map((line) => line.text) : ['No cards were accepted this week.']),
    '',
    `Total model spend: ${usd(totalUsd)} across ${weekCards.length} cards${spentPhrase ? ` (${spentPhrase})` : ''}.`,
    '',
    "Costs are read from Mastra's traces for this Factory project and Factory's own card records. Sessions run outside Factory (Codex, GPT, or Claude sessions started by hand) are not counted and never appear here.",
  ].join('\n');

  return {
    title: `Monday note — week ending ${to.slice(0, 10)}`,
    body,
    quiet: lines.length === 0,
    lines,
    totalUsd,
    failedAttempts,
    from,
    to,
  };
}

/**
 * Publish the note and tell Todd, through whatever adapters the caller passes.
 *
 * `discussions` is GitHub's own Discussion publisher and `notifications` is the
 * phone notification; both are the only places the outside world is touched, so
 * tests drive them with fakes. A run for a week that already has its Discussion
 * posts and notifies nothing: the weekly timer may fire twice, and Todd must
 * never get the same note twice.
 */
export async function publishMondayNote({ note, discussions, notifications }) {
  const existing = await discussions.find({ category: MONDAY_NOTE_CATEGORY, title: note.title });
  if (existing) return { posted: false, reason: 'already published', url: existing.url };

  const discussion = await discussions.post({ category: MONDAY_NOTE_CATEGORY, title: note.title, body: note.body });
  await notifications.notify({ title: note.title, body: note.quiet ? 'Quiet week.' : note.lines[0].text, url: discussion.url });
  return { posted: true, url: discussion.url };
}
