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

/**
 * The Monday the observability store came on (JUL-184, 2026-09-28). The first
 * note never reaches back before it, so "every card since 2026-09-28" is
 * exactly what the sequence of weekly notes covers.
 */
export const OBSERVABILITY_START = '2026-09-28T00:00:00Z';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The last completed Monday-to-Monday week before `now`, clamped so it never
 * starts before observability did. A timer may fire any time on the Monday; the
 * window it reports is the same all day, so a retry cannot split a week.
 *
 * @param {{now: string, firstWeekStart?: string}} input
 * @returns {{from: string, to: string}}
 */
export function previousWeekWindow({ now, firstWeekStart = OBSERVABILITY_START }) {
  const at = Date.parse(now);
  const start = Date.parse(firstWeekStart);
  // The Monday on or before `now`, then the Monday before that: the last week
  // that is fully in the past.
  const thisMonday = start + Math.floor((at - start) / WEEK_MS) * WEEK_MS;
  const from = thisMonday - WEEK_MS;
  if (from < start) {
    // Before the first Monday after switch-on there is no completed week. Return
    // an empty window at switch-on rather than a partial one: a partial first
    // week would overlap the first full week (`[start, firstMonday)`) and count
    // the same card in two notes.
    return { from: new Date(start).toISOString(), to: new Date(start).toISOString() };
  }
  return { from: new Date(from).toISOString(), to: new Date(thisMonday).toISOString() };
}

/** `$6.60`; two decimals, always, so a figure never reads as rounded prose. */
function usd(value) {
  return `$${value.toFixed(2)}`;
}

/** The Discussion title for a week; one title per week is the dedupe key. */
export function noteTitle(to) {
  return `Monday note — week ending ${to.slice(0, 10)}`;
}

/**
 * Every complete Monday-to-Monday week from observability switch-on up to the
 * last one before `now`, oldest first. This is what lets a weekly job backfill
 * a span of missed Mondays instead of only reporting the most recent one: each
 * entry is a full week that can be published independently, and a week already
 * published is skipped by its title.
 *
 * @param {{now: string, firstWeekStart?: string}} input
 * @returns {Array<{from: string, to: string}>}
 */
export function completedWeeks({ now, firstWeekStart = OBSERVABILITY_START }) {
  const at = Date.parse(now);
  const start = Date.parse(firstWeekStart);
  const thisMonday = start + Math.floor((at - start) / WEEK_MS) * WEEK_MS;
  const weeks = [];
  for (let to = start + WEEK_MS; to <= thisMonday; to += WEEK_MS) {
    weeks.push({ from: new Date(to - WEEK_MS).toISOString(), to: new Date(to).toISOString() });
  }
  return weeks;
}

/** `4h 12m`, `1h`, `50m` -- the elapsed time Todd asked for, not milliseconds. */
function duration(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/**
 * Cost correlation is never guessed and never turned into `$0.00`.
 *
 * A span is cost-bearing when Mastra's own record says it is a model span
 * (`normalizeTraceSpans` sets `costBearing`) or when it already carries a
 * numeric cost. Every cost-bearing span in the week must both name a card in
 * this note and carry a numeric `estimatedCost`:
 *
 *   - cost-bearing, no numeric cost  -> failed read, fail closed (never `$0.00`);
 *   - cost-bearing, no card in week  -> correlation failure, fail closed;
 *   - a span whose `costBearing` is unknown (not a normalised record) is
 *     treated as cost-bearing, so an unlabelled span can never slip through.
 *
 * Numeric zero is valid -- a real free model call is `0`, not missing. A span
 * Mastra does not bill (a tool, RAG, processor or generic span with no
 * `costContext`) is not cost-bearing and does not have to carry a cost.
 */
export function assertCostsAreCorrelated(weekTraces, weekCardNumbers) {
  for (const trace of weekTraces) {
    const cost = trace.costUsd;
    const costKnown = typeof cost === 'number' && Number.isFinite(cost);
    const correlated = trace.card !== null && trace.card !== undefined && weekCardNumbers.has(trace.card);
    // `true` is cost-bearing; `false` is provably not; anything else is
    // unknown and fails closed rather than being assumed free.
    const costBearing = trace.costBearing !== false;

    if (correlated && costBearing && !costKnown) {
      throw new Error(
        `Trace ${trace.id ?? '(no id)'} is correlated to card ${trace.card} but has no numeric estimated cost; ` +
          'refusing to report it as $0.00',
      );
    }
    if (!correlated && costBearing && !costKnown) {
      throw new Error(
        `Trace ${trace.id ?? '(no id)'} has no numeric estimated cost and is not correlated to a card in this week; ` +
          'refusing to publish a note that could hide a cost as $0.00',
      );
    }
    if (!correlated && costKnown) {
      throw new Error(
        `Trace ${trace.id ?? '(no id)'} carries a cost (${cost}) but is not correlated to a card in this week; ` +
          'refusing to publish a total that may be wrong',
      );
    }
  }
}

function failedAttemptPhrase(count) {
  if (count <= 0) return null;
  return count === 1 ? '1 failed attempt' : `${count} failed attempts`;
}

function actorName(by) {
  if (by === 'todd' || by === 'Todd') return 'Todd';
  if (by === 'factory' || by === 'Factory') return 'Factory';
  // Factory's own stage history stamps agent runs as `agent:<id>` (see
  // @mastra/factory storage/domains/work-items/base isAgentActor); a bare user
  // id is a person. `github:*`/`factory-rule-dispatcher` are the rule engine
  // syncing the upstream repo, not a person going around the product, so they
  // read as Factory here too.
  if (typeof by === 'string' && (by.startsWith('agent:') || by.startsWith('factory') || by.startsWith('github:') || by.startsWith('system'))) {
    return 'Factory';
  }
  return 'Todd';
}

function isFactoryActor(by) {
  return actorName(by) === 'Factory';
}

/** Factory's working stage names, labelled the way the note reads. */
const STAGE_LABEL = {
  triage: 'triage',
  planning: 'plan',
  execute: 'build',
  review: 'review',
};

/**
 * The card's steps in order, each with the actor who did it.
 *
 * Factory's own record is `stageHistory`: one entry per stage a card entered,
 * with `by` (who entered it) and `exitedBy` (who closed it). Older test and
 * fixture records use a flat `movements` list; both shapes normalise to the
 * same step here, so the note never depends on one hand-shaped input.
 */
function cardSteps(card) {
  if (Array.isArray(card.stageHistory) && card.stageHistory.length > 0) {
    return card.stageHistory.map((entry) => ({
      stage: STAGE_LABEL[entry.stage] ?? entry.stage,
      by: entry.exitedBy ?? entry.by,
      startedAt: entry.enteredAt ?? null,
      endedAt: entry.exitedAt ?? null,
    }));
  }
  const movements = card.movements ?? [];
  return movements.map((movement, index) => ({
    stage: movement.what ?? movement.stage ?? 'step',
    by: movement.by,
    startedAt: movement.at ?? null,
    endedAt: movements[index + 1]?.at ?? card.doneAt ?? null,
  }));
}

/**
 * A card belongs to a week when it entered the board inside `[from, to)`; a
 * trace belongs when it started in the same window. Everything else is another
 * week's note, so the same card is never counted in two weeks (CONTEXT.md
 * "Monday note": the weekly summary). The first note's window starts at
 * observability switch-on, so it covers every card since then.
 */
function within(instant, from, to) {
  if (instant === null || instant === undefined) return false;
  const at = Date.parse(instant);
  if (!Number.isFinite(at)) return false;
  return at >= Date.parse(from) && at < Date.parse(to);
}

/** The trace's own start, used to place it on exactly one step. */
function traceStartedAt(trace) {
  const at = Date.parse(trace.startedAt ?? trace.startTime);
  return Number.isFinite(at) ? at : null;
}

function stepLine(step, stepTraces) {
  const costUsd = stepTraces.reduce((sum, trace) => sum + (trace.costUsd ?? 0), 0);
  const failedAttempts = stepTraces.filter((trace) => trace.outcome === 'failed-attempt').length;
  const elapsedMs = step.startedAt && step.endedAt ? Date.parse(step.endedAt) - Date.parse(step.startedAt) : null;

  const parts = [`${step.stage} — ${actorName(step.by)} — ${usd(costUsd)}`];
  if (elapsedMs !== null && elapsedMs >= 0) parts.push(duration(elapsedMs));
  const failedPhrase = failedAttemptPhrase(failedAttempts);
  if (failedPhrase) parts.push(failedPhrase);
  return { stage: step.stage, by: step.by, costUsd, elapsedMs, failedAttempts, text: parts.join(' — ') };
}

/**
 * Attach every trace to exactly one step: the last step that started at or
 * before the trace. A trace before the first step (or on a card with no steps)
 * lands on the card itself and is reported, never dropped or double-counted.
 */
function tracesByStep(steps, cardTraces) {
  const buckets = steps.map(() => []);
  const unattached = [];
  for (const trace of cardTraces) {
    const at = traceStartedAt(trace);
    let index = -1;
    if (at !== null) {
      for (let i = 0; i < steps.length; i += 1) {
        const start = steps[i].startedAt ? Date.parse(steps[i].startedAt) : null;
        if (start !== null && start <= at) index = i;
      }
    }
    (index >= 0 ? buckets[index] : unattached).push(trace);
  }
  return { buckets, unattached };
}

function cardLine(card, cardTraces) {
  const steps = cardSteps(card);
  const { buckets, unattached } = tracesByStep(steps, cardTraces);
  const stepLines = steps.map((step, index) => stepLine(step, buckets[index]));
  const unattachedLine = stepLine(
    { stage: 'other Factory work', by: 'factory', startedAt: null, endedAt: null },
    unattached,
  );
  if (unattached.length > 0) stepLines.push(unattachedLine);

  const costUsd = cardTraces.reduce((sum, trace) => sum + (trace.costUsd ?? 0), 0);
  const failedAttempts = cardTraces.filter((trace) => trace.outcome === 'failed-attempt').length;
  const firstStep = steps[0];
  const enteredAt = card.enteredAt ?? firstStep?.startedAt ?? card.createdAt;
  const lastStep = steps.at(-1);
  const endedAt = card.doneAt ?? lastStep?.endedAt ?? lastStep?.startedAt ?? enteredAt;
  const elapsedMs = enteredAt && endedAt ? Date.parse(endedAt) - Date.parse(enteredAt) : 0;

  const byHand = steps.slice(1).find((step) => !isFactoryActor(step.by));
  const doneByFactory = byHand === undefined;
  const parts = [`#${card.number} ${card.title}`, usd(costUsd), duration(elapsedMs)];
  const failedPhrase = failedAttemptPhrase(failedAttempts);
  if (failedPhrase) parts.push(failedPhrase);
  parts.push(doneByFactory ? 'Done by Factory' : `not all by Factory: ${actorName(byHand.by)} ${byHand.stage}`);

  return {
    number: card.number,
    costUsd,
    elapsedMs,
    failedAttempts,
    doneByFactory,
    steps: stepLines,
    text: parts.join(' — '),
  };
}

/**
 * Build the note for one week from sample-or-live records.
 *
 * @param {{cards?: Array, traces?: Array, from: string, to: string}} input
 * @returns {{title: string, body: string, quiet: boolean, lines: Array,
 *            totalUsd: number, failedAttempts: number}}
 */
export function buildMondayNote({ cards = [], traces = [], from, to }) {
  // A card's week is measured from when it entered observability: the first
  // step it has, or its creation time. The first note's window starts at
  // observability switch-on, so it covers every card since then, and each later
  // week covers its own slice exactly once.
  const cardEntry = (card) => card.enteredAt ?? card.stageHistory?.[0]?.enteredAt ?? card.movements?.[0]?.at ?? card.createdAt;
  const weekCards = cards.filter((card) => within(cardEntry(card), from, to));
  const weekTraces = traces.filter((trace) => within(trace.startedAt, from, to));
  const weekNumbers = new Set(weekCards.map((card) => card.number));
  // Fail closed before building any line: a missing cost is never $0 and a
  // cost-bearing span that names no card in the week is never guessed onto one.
  assertCostsAreCorrelated(weekTraces, weekNumbers);
  const lines = weekCards.map((card) =>
    cardLine(
      card,
      weekTraces.filter((trace) => trace.card === card.number),
    ),
  );
  // Cost correlation is enforced above, so an uncorrelated span here has no
  // numeric cost: it is summed and reported (at $0.00) rather than silently
  // dropped, and it can never widen a card's total.
  const uncorrelated = weekTraces.filter((trace) => trace.card === null || !weekNumbers.has(trace.card));
  const uncorrelatedUsd = uncorrelated.reduce((sum, trace) => sum + (trace.costUsd ?? 0), 0);
  const cardUsd = lines.reduce((sum, line) => sum + line.costUsd, 0);
  const totalUsd = cardUsd + uncorrelatedUsd;
  const failedAttempts = lines.reduce((sum, line) => sum + line.failedAttempts, 0);
  const spentPhrase = failedAttemptPhrase(failedAttempts);

  // The body is what Todd reads, so every fact the note computed is written
  // here, not left in the returned metadata: the card line carries the card's
  // cost (failed attempts included) and total elapsed, and each step below it
  // carries the step's actor and, when Factory recorded one, the step's time.
  const bodyLines = [];
  if (lines.length > 0) {
    for (const line of lines) {
      bodyLines.push(line.text);
      for (const step of line.steps) bodyLines.push(`  • ${step.text}`);
    }
  } else {
    bodyLines.push('No cards were accepted this week.');
  }

  // An uncorrelated span can no longer carry an unknown cost (that fails closed
  // above), so its dollars are never printed as `$0.00`. When it does carry a
  // known numeric cost (which the assertion forbids today), show it; otherwise
  // report the count alone rather than inventing a zero.
  const uncorrelatedLine = uncorrelated.length > 0
    ? `${uncorrelated.length} trace(s) not matched to a card${
        uncorrelatedUsd > 0 ? `, totalling ${usd(uncorrelatedUsd)}` : ' (no recorded cost)'
      }.`
    : null;

  const body = [
    `Monday note — week ending ${to.slice(0, 10)}`,
    '',
    ...bodyLines,
    ...(uncorrelatedLine ? ['', uncorrelatedLine] : []),
    '',
    `Total model spend: ${usd(totalUsd)} across ${weekCards.length} cards${spentPhrase ? ` (${spentPhrase})` : ''}.`,
    '',
    "Costs are read from Mastra's traces for this Factory project and Factory's own card records. Sessions run outside Factory (Codex, GPT, or Claude sessions started by hand) are not counted and never appear here.",
  ].join('\n');

  return {
    title: noteTitle(to),
    body,
    quiet: lines.length === 0,
    lines,
    totalUsd,
    uncorrelatedUsd,
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

  const url = await postMondayNote({ note, discussions });
  await notifications.notify({ title: note.title, body: note.quiet ? 'Quiet week.' : note.lines[0].text, url });
  return { posted: true, url };
}

/**
 * Create the Discussion for a note that is known not to have one yet. Split out
 * so the backfill can publish several weeks and still tell Todd exactly once.
 */
export async function postMondayNote({ note, discussions }) {
  const discussion = await discussions.post({ category: MONDAY_NOTE_CATEGORY, title: note.title, body: note.body });
  return discussion.url;
}
