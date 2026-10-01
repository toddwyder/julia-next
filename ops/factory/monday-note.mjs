// monday-note.mjs -- issue #140, seam 1: the weekly Monday note.
//
// One program, two inputs, one text. The inputs are Factory's own card records
// (the card moves and who made them) and Mastra's trace cost data; the output
// is the plain summary Todd reads, posted as a public GitHub Issue with
// factory:machine and cost-note labels so it stays outside Factory Intake.
//
// Pure generation only: no network, no storage, no schedule. The publisher and
// the notification live in `publishMondayNote` over injected adapters, and the
// schedule belongs to a systemd timer, exactly like the wait watcher.
//
// Costs are never agent-reported: they are summed from the trace records the
// observability exporter wrote, failed attempts included (CONTEXT.md "Monday
// note").

/** Legacy adapter category; production publishes GitHub Issues. */
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

function costDisplay(traces, knownCost) {
  const calls = traces.filter(trace => trace.costBearing !== false);
  if (calls.length === 0) return 'no recorded model calls';
  const gaps = [...new Set(calls.flatMap(trace => trace.namedGaps ?? []).filter(gap => gap !== 'no_recorded_effort'))];
  if (gaps.length === 0) return usd(knownCost);
  const names = gaps.map(gap => gap.replaceAll('_', ' ')).join(', ');
  return calls.some(trace => Number.isFinite(trace.whatYouPayCost ?? trace.costUsd) && !(trace.namedGaps ?? []).some(gap => gap !== 'no_recorded_effort'))
    ? `${usd(knownCost)} known subtotal + ${names}` : names;
}

/** The Issue title for a week; one title per week is the dedupe key. */
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

/** `1.2M`, `45.2k`, `500`, `0` -- human-readable token counts. */
export function formatTokens(n) {
  if (n === null || n === undefined || !Number.isFinite(n) || n === 0) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

/**
 * Cost correlation is never guessed and never turned into `$0.00`.
 *
 * A span is cost-bearing when Mastra's own record says it is a model span
 * (`normalizeTraceSpans` sets `costBearing`) or when it already carries a
 * numeric cost. Every cost-bearing span in the week must both name a card in
 * this note and carry a numeric `estimatedCost` or a named gap.
 */
export function assertCostsAreCorrelated(weekTraces, weekCardNumbers) {
  for (const trace of weekTraces) {
    const cost = trace.whatYouPayCost ?? trace.costUsd;
    const costKnown = typeof cost === 'number' && Number.isFinite(cost);
    const hasNamedGaps = Array.isArray(trace.namedGaps) && trace.namedGaps.length > 0;
    const correlated = trace.card !== null && trace.card !== undefined && weekCardNumbers.has(trace.card);
    // `true` is cost-bearing; `false` is provably not; anything else is
    // unknown and fails closed rather than being assumed free.
    const costBearing = trace.costBearing !== false;

    if (!correlated && costBearing && !trace.projectOverhead) {
      throw new Error(
        `Trace ${trace.id ?? '(no id)'} is cost-bearing but is not correlated to a card in this week; ` +
          'refusing to publish a total that may be wrong',
      );
    }
    if ((correlated || trace.projectOverhead) && costBearing && !costKnown && !hasNamedGaps) {
      throw new Error(
        `Trace ${trace.id ?? '(no id)'} is correlated to card ${trace.card} but has no numeric estimated cost; ` +
          'refusing to report it as $0.00',
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
    return card.stageHistory.map((entry, index) => ({
      stage: STAGE_LABEL[entry.stage] ?? entry.stage,
      by: entry.exitedBy ?? entry.by,
      enteredBy: entry.by,
      exitedBy: entry.exitedBy,
      startedAt: entry.enteredAt ?? null,
      endedAt: entry.exitedAt ?? null,
      // The first entry's `by` is the actor who moved the card out of Intake
      // (Factory's `acceptedAt` gesture), i.e. the genuine initial Intake. It
      // is retained separately because `by` above may name the later actor who
      // closed the stage; a hand move on that step is still a hand move.
      intakeBy: index === 0 ? entry.by : null,
      boardStep: true,
      phaseSnapshots: (card.phaseSnapshots ?? []).filter(snapshot =>
        Date.parse(snapshot.at) >= Date.parse(entry.enteredAt) &&
        (!entry.exitedAt || Date.parse(snapshot.at) < Date.parse(entry.exitedAt))),
    }));
  }
  const movements = card.movements ?? [];
  return movements.map((movement, index) => ({
    stage: movement.what ?? movement.stage ?? 'step',
    by: movement.by,
    enteredBy: movement.by,
    exitedBy: movements[index + 1]?.by ?? null,
    startedAt: movement.at ?? null,
    endedAt: movements[index + 1]?.at ?? card.doneAt ?? null,
    // The first movement is Todd's Intake tap that starts the card.
    intakeBy: index === 0 ? movement.by : null,
  }));
}

/**
 * Count times the card waited on Todd outside UAT (CONTEXT.md).
 *
 * The initial intake tap is the start gesture, and testing in `done` is live UAT.
 * Any non-Factory actor on any step between intake and done is a wait on Todd outside UAT.
 */
function countWaitsOnTodd(allSteps) {
  let count = 0;
  for (let i = 0; i < allSteps.length; i += 1) {
    const step = allSteps[i];
    if (step.stage === 'done') continue;
    if (i === 0) {
      if (step.exitedBy && !isFactoryActor(step.exitedBy) && step.exitedBy !== step.intakeBy) {
        count += 1;
      }
      continue;
    }
    if (!isFactoryActor(step.enteredBy) || !isFactoryActor(step.by) || (step.exitedBy && !isFactoryActor(step.exitedBy))) {
      count += 1;
    }
  }
  return count;
}

/**
 * Whether every step after the genuine initial Intake was done by Factory.
 *
 * The classification is about the card's own steps, not the slice a note shows
 * for one week: a card accepted earlier can carry a hand move from an earlier
 * week, and a week's filtered steps can start with a hand move, so reading only
 * the filtered list both misses hand moves and mis-slices the first step. The
 * genuine initial Intake is the card's first step -- Todd's tap that starts it --
 * and only that actor on that step is exempt; every other non-Factory actor on
 * any step is a hand move.
 */
function doneByFactoryFor(allSteps) {
  const intake = allSteps[0];
  const byHand = allSteps.find((step) => {
    if (isFactoryActor(step.by)) return false;
    return !(step === intake && step.by === intake.intakeBy);
  });
  return { byHand, doneByFactory: byHand === undefined };
}

/**
 * A card belongs to a week when it entered the board inside `[from, to)` OR when
 * its work (a trace) ran in the same window; a trace belongs when it started in
 * the window. A card is named at most once per note, and each trace lands in
 * exactly one week, so no cost or failed attempt is counted twice (CONTEXT.md
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
  const costUsd = stepTraces.reduce((sum, trace) => sum + (trace.whatYouPayCost ?? trace.costUsd ?? 0), 0);
  const faceCostUsd = stepTraces.reduce((sum, trace) => sum + (trace.faceCost ?? trace.whatYouPayCost ?? trace.costUsd ?? 0), 0);
  const failedAttempts = stepTraces.filter((trace) => trace.outcome === 'failed-attempt').length;
  const elapsedMs = step.startedAt && step.endedAt ? Date.parse(step.endedAt) - Date.parse(step.startedAt) : null;
  const thinkingTokens = stepTraces.reduce((sum, trace) => sum + (trace.tokens?.thinking ?? 0), 0);
  const recordedEffort = [...new Set([...stepTraces.map(trace => trace.effortLevel ?? trace.effort),
    ...(step.phaseSnapshots ?? []).map(snapshot => snapshot.effort), step.effort].filter(Boolean))];
  const effort = recordedEffort.length ? recordedEffort.join(', ') : 'no recorded effort';

  // Group models used in this step
  const modelMap = new Map();
  for (const trace of stepTraces) {
    if (trace.costBearing === false) continue;
    const key = `${trace.model}|${trace.provider ?? ''}`;
    if (!modelMap.has(key)) {
      modelMap.set(key, {
        model: trace.model ?? 'no recorded model',
        provider: trace.provider ?? 'unknown',
        whatYouPayCost: 0,
        faceCost: 0,
        freshInput: 0,
        cachedInput: 0,
        output: 0,
        thinking: 0,
        total: 0,
        hasKnownCost: false,
        unpriced: false,
        noTokenCount: false,
        traces: [],
      });
    }
    const entry = modelMap.get(key);
    entry.traces.push(trace);
    const knownCost = trace.whatYouPayCost ?? trace.costUsd;
    if (knownCost !== null && knownCost !== undefined) {
      entry.whatYouPayCost += knownCost;
      entry.hasKnownCost = true;
    } else {
      if (trace.namedGaps?.some((g) => g.startsWith('unpriced_model'))) {
        entry.unpriced = true;
      }
      if (trace.namedGaps?.some(gap => ['no_token_count', 'invalid_token_count'].includes(gap))) {
        entry.noTokenCount = true;
      }
    }
    if (trace.faceCost !== null && trace.faceCost !== undefined) {
      entry.faceCost += trace.faceCost;
    }
    entry.freshInput += trace.tokens?.freshInput ?? 0;
    entry.cachedInput += trace.tokens?.cachedInput ?? 0;
    entry.output += trace.tokens?.output ?? 0;
    entry.thinking += trace.tokens?.thinking ?? 0;
    entry.total += trace.tokens?.total ?? 0;
    if (!trace.tokens) entry.noTokenCount = true;
  }

  const modelLines = [];
  for (const m of modelMap.values()) {
    const inTotal = m.freshInput + m.cachedInput;
    const cachedShare = inTotal > 0 ? Math.round((m.cachedInput / inTotal) * 100) : 0;
    const display = costDisplay(m.traces, m.whatYouPayCost);
    modelLines.push(
      `    - ${m.model} (${m.provider}): ${display} (${m.noTokenCount ? 'no token count' : `${formatTokens(m.freshInput)} fresh, ${formatTokens(m.cachedInput)} cached [${cachedShare}% cached], ${formatTokens(m.output)} out [${formatTokens(m.thinking)} thinking]`})`
    );
  }

  const parts = [`${step.stage} — ${actorName(step.by)} — ${costDisplay(stepTraces, costUsd)}`];
  if (elapsedMs !== null && elapsedMs >= 0) parts.push(duration(elapsedMs));
  const failedPhrase = failedAttemptPhrase(failedAttempts);
  if (failedPhrase) parts.push(failedPhrase);
  const tokensComplete = stepTraces.some(trace => trace.costBearing !== false) &&
    !stepTraces.some(trace => trace.costBearing !== false && (!trace.tokens || trace.namedGaps?.includes('no_token_count') || trace.namedGaps?.includes('invalid_token_count')));
  parts.push(`effort: ${effort} (${tokensComplete ? formatTokens(thinkingTokens) : 'no token count'} thinking tokens)`);
  if (modelMap.size === 0) {
    const models = [...new Set((step.phaseSnapshots ?? []).map(snapshot => snapshot.model).filter(Boolean))];
    modelLines.push(...(models.length ? models.map(model => `    - ${model}: no recorded model calls (no token count)`) : ['    - model: no recorded model calls']));
  }

  return {
    stage: step.stage,
    by: step.by,
    costUsd,
    faceCostUsd,
    elapsedMs,
    failedAttempts,
    effort,
    thinkingTokens,
    models: Array.from(modelMap.values()),
    modelLines,
    text: parts.join(' — '),
  };
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
    if (index >= 0 && steps[index].boardStep &&
      ((steps[index].endedAt && Date.parse(steps[index].endedAt) <= at) ||
       (trace.costBearing !== false && trace.phase && steps[index].stage !== trace.phase))) index = -1;
    (index >= 0 ? buckets[index] : unattached).push(trace);
  }
  return { buckets, unattached };
}

function cardLine(card, cardTraces, { acceptedInWeek = true, from, to } = {}) {
  // A backfilled week must be rendered as it stood then. Later board moves
  // cannot change an earlier report's actor or elapsed time.
  const allSteps = cardSteps(card)
    .filter((step) => !step.startedAt || Date.parse(step.startedAt) < Date.parse(to))
    .map((step) => step.endedAt && Date.parse(step.endedAt) >= Date.parse(to)
      ? { ...step, by: step.enteredBy ?? step.by, endedAt: null }
      : step);
  // Which of the card's steps own a trace in this week (a trace lands on the
  // last step that started at or before it). Used to keep a continued card's
  // in-week steps and drop its earlier ones.
  const stepHasWeekTrace = new Set(
    tracesByStep(allSteps, cardTraces)
      .buckets.map((bucket, index) => (bucket.length > 0 ? index : -1))
      .filter((index) => index >= 0),
  );
  // A card accepted before this week is only here for this week's activity, so
  // its earlier steps are not shown again: keep the steps that started in the
  // week, or that a trace in the week was attributed to. A card accepted in the
  // week keeps its full step history.
  const steps = acceptedInWeek
    ? allSteps
    : allSteps.filter(
        (step, index) => within(step.startedAt, from, to) || within(step.endedAt, from, to) || stepHasWeekTrace.has(index),
      );
  const boundedSteps = steps.map((step) => ({
    ...step,
    phaseSnapshots: [
      ...(step.phaseSnapshots ?? []).filter(snapshot => Date.parse(snapshot.at) < Date.parse(from))
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-1),
      ...(step.phaseSnapshots ?? []).filter(snapshot => within(snapshot.at, from, to)),
    ],
    startedAt: step.startedAt && Date.parse(step.startedAt) < Date.parse(from) ? from : step.startedAt,
    endedAt: step.endedAt && Date.parse(step.endedAt) > Date.parse(to) ? to : step.endedAt,
  }));
  const { buckets, unattached } = tracesByStep(steps, cardTraces);
  const stepLines = boundedSteps.map((step, index) => stepLine(step, buckets[index]));
  const unattachedLine = stepLine(
    { stage: 'other Factory work', by: 'factory', startedAt: null, endedAt: null },
    unattached,
  );
  if (unattached.length > 0) {
    const phases = [...new Set(unattached.map(trace => trace.phase ?? 'other Factory work'))];
    for (const phase of phases) stepLines.push(stepLine({ stage: `${phase} (no recorded board step)`, by: 'factory' },
      unattached.filter(trace => (trace.phase ?? 'other Factory work') === phase)));
  }

  const costUsd = cardTraces.reduce((sum, trace) => sum + (trace.whatYouPayCost ?? trace.costUsd ?? 0), 0);
  const faceCostUsd = cardTraces.reduce((sum, trace) => sum + (trace.faceCost ?? trace.whatYouPayCost ?? trace.costUsd ?? 0), 0);
  const failedAttempts = cardTraces.filter((trace) => trace.outcome === 'failed-attempt').length;
  const enteredAt = card.enteredAt ?? allSteps[0]?.startedAt ?? card.createdAt;
  const lastStep = steps.at(-1);
  const doneAsOfWeek = card.doneAt && Date.parse(card.doneAt) < Date.parse(to) ? card.doneAt : null;
  const rawEnd = doneAsOfWeek ?? lastStep?.endedAt ?? (['done', 'canceled'].includes(lastStep?.stage) ? lastStep.startedAt : lastStep ? to : enteredAt);
  const endedAt = rawEnd && Date.parse(rawEnd) > Date.parse(to) ? to : rawEnd;
  let elapsedMs;
  if (acceptedInWeek) {
    elapsedMs = enteredAt && endedAt ? Date.parse(endedAt) - Date.parse(enteredAt) : 0;
  } else {
    // A continued card's elapsed is this week's activity window, never its
    // whole lifetime: the same card must not report the same weeks-long
    // duration in every note it appears in. Measure from the earliest in-week
    // activity (step start or trace start) to the latest in-week activity
    // (step end, trace end, or the card's done time), clamped to the week.
    const windowStart = Date.parse(from);
    const windowEnd = Date.parse(to);
    let activityStart = null;
    let activityEnd = null;
    const consider = (value) => {
      const at = value === null || value === undefined ? NaN : Date.parse(value);
      if (!Number.isFinite(at)) return;
      const clamped = Math.min(Math.max(at, windowStart), windowEnd);
      activityStart = activityStart === null ? clamped : Math.min(activityStart, clamped);
      activityEnd = activityEnd === null ? clamped : Math.max(activityEnd, clamped);
    };
    for (const step of steps) {
      consider(step.startedAt);
      consider(step.endedAt);
    }
    for (const trace of cardTraces) {
      consider(trace.startedAt);
      consider(trace.endedAt);
    }
    if (within(endedAt, from, to)) consider(endedAt);
    elapsedMs = activityStart !== null && activityEnd !== null && activityEnd > activityStart
      ? activityEnd - activityStart
      : 0;
  }

  const { byHand, doneByFactory } = doneByFactoryFor(allSteps);
  const reference = String(card.number).startsWith('PR-') ? `PR #${String(card.number).slice(3)}`
    : String(card.number).startsWith('Factory-') ? `Factory card ${String(card.number).slice(8)}` : `#${card.number}`;
  const parts = [`${reference} ${card.title}`, costDisplay(cardTraces, costUsd), card.recordMissing ? 'no recorded card elapsed time' : duration(elapsedMs)];
  const failedPhrase = failedAttemptPhrase(failedAttempts);
  if (failedPhrase) parts.push(failedPhrase);
  parts.push(doneByFactory ? (doneAsOfWeek || allSteps.at(-1)?.stage === 'done' ? 'Done by Factory' : 'Factory work') : `not all by Factory: ${actorName(byHand.by)} ${byHand.stage}`);

  // Drivers calculation
  const totalStepsCount = steps.length;
  const totalFreshInput = cardTraces.reduce((sum, trace) => sum + (trace.tokens?.freshInput ?? 0), 0);
  const totalCachedInput = cardTraces.reduce((sum, trace) => sum + (trace.tokens?.cachedInput ?? 0), 0);
  const totalInputTokens = totalFreshInput + totalCachedInput;
  const avgTokensPerStep = totalStepsCount > 0 ? Math.round(totalInputTokens / totalStepsCount) : 0;
  const cachedShare = totalInputTokens > 0 ? Math.round((totalCachedInput / totalInputTokens) * 100) : 0;
  const reviewRounds = steps.filter((step) => step.stage === 'review').length;
  const waitsOnTodd = countWaitsOnTodd(allSteps);

  const tokensKnown = cardTraces.some(trace => trace.costBearing !== false) && !cardTraces.some(trace => trace.costBearing !== false && (!trace.tokens || trace.namedGaps?.includes('no_token_count') || trace.namedGaps?.includes('invalid_token_count')));
  const tokenDrivers = tokensKnown ? `${totalStepsCount ? formatTokens(avgTokensPerStep) + ' avg input tokens/board step' : 'tokens/board step: no recorded board step count'}, ${cachedShare}% cached input` : 'tokens/step: no token count, cached input: no token count';
  const reviewDriver = card.recordMissing || unattached.some(trace => trace.phase === 'review' && trace.costBearing !== false)
    ? 'review rounds: no recorded review round count' : `${reviewRounds} review round${reviewRounds === 1 ? '' : 's'}`;
  const modelSteps = cardTraces.filter(trace => trace.modelStep && trace.runId);
  const runs = new Set(cardTraces.filter(trace => trace.costBearing && trace.runId).map(trace => trace.runId));
  const runDrivers = modelSteps.length && runs.size
    ? `${(modelSteps.length / runs.size).toFixed(1)} model steps/run (${modelSteps.length} steps, ${runs.size} runs), ${tokensKnown ? formatTokens(Math.round(totalInputTokens / modelSteps.length)) + ' avg input tokens/model step' : 'tokens/model step: no token count'}`
    : 'steps/run: no recorded run count, tokens/run step: no recorded run step count';
  const boardDrivers = card.recordMissing ? 'board steps: no recorded stage history' : `${totalStepsCount} step${totalStepsCount === 1 ? '' : 's'} (board history)`;
  const waitDriver = card.recordMissing ? 'waits on Todd: no recorded stage history' : `${waitsOnTodd} wait${waitsOnTodd === 1 ? '' : 's'} on Todd outside UAT`;
  const driversText = `  Drivers: ${boardDrivers}, ${runDrivers}, ${tokenDrivers}, ${reviewDriver}, ${failedAttempts} failed attempt${failedAttempts === 1 ? '' : 's'}, ${waitDriver}`;

  return {
    number: card.number,
    costUsd,
    faceCostUsd,
    elapsedMs,
    failedAttempts,
    doneByFactory,
    waitsOnTodd,
    steps: stepLines,
    driversText,
    text: parts.join(' — '),
  };
}

/**
 * Build the note for one week from sample-or-live records.
 *
 * @param {{cards?: Array, traces?: Array, from: string, to: string}} input
 * @returns {{title: string, body: string, quiet: boolean, lines: Array,
 *            totalUsd: number, faceTotalUsd: number, providerTotals: Object,
 *            namedGaps: Object, failedAttempts: number}}
 */
export function buildMondayNote({ cards = [], traces = [], from, to }) {
  // A card's week is measured from when it entered observability: the first
  // step it has, or its creation time. The first note's window starts at
  // observability switch-on, so it covers every card since then, and each later
  // week covers its own slice exactly once.
  const cardEntry = (card) => card.enteredAt ?? card.stageHistory?.[0]?.enteredAt ?? card.movements?.[0]?.at ?? card.createdAt;
  const weekTraces = traces.filter((trace) => within(trace.startedAt, from, to));
  const cardsWithWeekTraces = new Set(
    weekTraces.map((trace) => trace.card).filter((card) => card !== null && card !== undefined),
  );
  // A card is this week's when it entered the week, OR when its work ran in the
  // week: a card accepted earlier but built this week is this week's note, not
  // dropped. Filtering on entry alone would silently exclude it and then fail
  // closed on its trace as uncorrelated.
  const weekCards = cards.filter((card) =>
    within(cardEntry(card), from, to) || cardsWithWeekTraces.has(card.number) ||
    cardSteps(card).some((step) => {
      const entered = Date.parse(cardEntry(card));
      const activity = Date.parse(step.startedAt ?? step.endedAt);
      return (!Number.isFinite(entered) || activity >= entered) &&
        (within(step.startedAt, from, to) || within(step.endedAt, from, to));
    }),
  );
  const weekNumbers = new Set(weekCards.map((card) => card.number));
  // Fail closed before building any line: a missing cost is never $0 and a
  // cost-bearing span that names no card in the week is never guessed onto one.
  assertCostsAreCorrelated(weekTraces, weekNumbers);
  const lines = weekCards.map((card) =>
    cardLine(
      card,
      weekTraces.filter((trace) => trace.card === card.number),
      { acceptedInWeek: within(cardEntry(card), from, to), from, to },
    ),
  );
  // Cost correlation is enforced above, so an uncorrelated span here has no
  // numeric cost: it is summed and reported (at $0.00) rather than silently
  // dropped, and it can never widen a card's total.
  const overhead = weekTraces.filter(trace => trace.projectOverhead);
  const overheadUsd = overhead.reduce((sum, trace) => sum + (trace.whatYouPayCost ?? 0), 0);
  const uncorrelated = weekTraces.filter((trace) => !trace.projectOverhead && (trace.card === null || !weekNumbers.has(trace.card)));
  const uncorrelatedUsd = uncorrelated.reduce((sum, trace) => sum + (trace.whatYouPayCost ?? trace.costUsd ?? 0), 0);
  const cardUsd = lines.reduce((sum, line) => sum + line.costUsd, 0);
  const faceTotalUsd = lines.reduce((sum, line) => sum + (line.faceCostUsd ?? line.costUsd), 0)
    + overhead.reduce((sum, trace) => sum + (trace.faceCost ?? trace.whatYouPayCost ?? 0), 0);
  const totalUsd = cardUsd + uncorrelatedUsd + overheadUsd;
  const failedAttempts = lines.reduce((sum, line) => sum + line.failedAttempts, 0);
  const spentPhrase = failedAttemptPhrase(failedAttempts);

  // Provider totals in what-you-pay dollars and face cost
  const providerTotals = {};
  const providerTraces = {};
  for (const trace of weekTraces) {
    if (trace.costBearing === false) continue;
    const provider = trace.provider ?? 'no recorded provider';
    if (!providerTotals[provider]) {
      providerTotals[provider] = { whatYouPayCost: 0, faceCost: 0 };
      providerTraces[provider] = [];
    }
    const wyp = trace.whatYouPayCost ?? trace.costUsd ?? 0;
    const face = trace.faceCost ?? trace.whatYouPayCost ?? trace.costUsd ?? 0;
    providerTotals[provider].whatYouPayCost += wyp;
    providerTotals[provider].faceCost += face;
    providerTraces[provider].push(trace);
  }

  // Named gaps collection
  let noRecordedEffortCount = 0;
  let unpricedModelCount = 0;
  let noTokenCountCount = 0;

  for (const line of lines) {
    for (const step of line.steps) {
      if (step.effort === 'no recorded effort') {
        noRecordedEffortCount += 1;
      }
    }
  }

  for (const trace of weekTraces) {
    const gaps = trace.namedGaps ?? [];
    for (const gap of gaps) {
      if (gap.startsWith('unpriced_model')) unpricedModelCount += 1;
      if (gap === 'no_token_count') noTokenCountCount += 1;
    }
  }

  const namedGaps = {
    noRecordedEffort: noRecordedEffortCount,
    unpricedModels: unpricedModelCount,
    noTokenCount: noTokenCountCount,
  };

  const providerLines = ['Provider weekly totals (what-you-pay):'];
  const providerNames = Object.keys(providerTotals);
  if (providerNames.length > 0) {
    for (const p of providerNames) {
      const entry = providerTotals[p];
      const isSub = p === 'openai' || p === 'gemini' || (entry.whatYouPayCost === 0 && entry.faceCost > 0);
      const isDiscounted = entry.whatYouPayCost < entry.faceCost && entry.whatYouPayCost > 0;
      let line = `  • ${p}`;
      if (isSub) {
        line += ` (subscription): ${costDisplay(providerTraces[p], entry.whatYouPayCost)} (face value ${costDisplay(providerTraces[p], entry.faceCost)})`;
      } else if (isDiscounted) {
        line += `: ${costDisplay(providerTraces[p], entry.whatYouPayCost)} (face value ${costDisplay(providerTraces[p], entry.faceCost)})`;
      } else {
        line += `: ${costDisplay(providerTraces[p], entry.whatYouPayCost)}`;
      }
      providerLines.push(line);
    }
  } else {
    providerLines.push('  • (no billable provider usage)');
  }

  const namedGapLines = [
    'Named gaps:',
    `  • No recorded effort: ${noRecordedEffortCount} step(s)`,
    `  • Unpriced models: ${unpricedModelCount} call(s)`,
    `  • No token count: ${noTokenCountCount} call(s)`,
  ];
  const otherGaps = {};
  for (const trace of weekTraces.filter(trace => trace.costBearing !== false)) {
    for (const gap of trace.namedGaps ?? []) {
      if (!['no_token_count', 'unpriced_model', 'no_recorded_effort'].includes(gap)) otherGaps[gap] = (otherGaps[gap] ?? 0) + 1;
    }
  }
  for (const [gap, count] of Object.entries(otherGaps)) namedGapLines.push(`  • ${gap.replaceAll('_', ' ')}: ${count} call(s)`);
  const missingCallCards = weekCards.filter(card => !weekTraces.some(trace => trace.card === card.number && trace.costBearing !== false)).length;
  if (missingCallCards) namedGapLines.push(`  • No recorded model calls: ${missingCallCards} card(s)`);
  const totalDisplay = weekCards.length === 0 && weekTraces.length === 0 ? usd(0)
    : `${costDisplay(weekTraces, totalUsd)}${missingCallCards && weekTraces.some(trace => trace.costBearing !== false) ? ' + no recorded model calls' : ''}`;

  // The body is what Todd reads, so every fact the note computed is written
  // here, not left in the returned metadata.
  const bodyLines = [];
  if (lines.length > 0) {
    for (const line of lines) {
      bodyLines.push(line.text);
      for (const step of line.steps) {
        bodyLines.push(`  • ${step.text}`);
        for (const mLine of step.modelLines ?? []) {
          bodyLines.push(mLine);
        }
      }
      if (line.driversText) {
        bodyLines.push(line.driversText);
      }
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
    ...(overhead.length ? ['', `Factory project overhead (supervisor and memory): ${costDisplay(overhead, overheadUsd)}`,
      ...stepLine({ stage: 'project overhead', by: 'factory' }, overhead).modelLines] : []),
    ...(uncorrelatedLine ? ['', uncorrelatedLine] : []),
    '',
    ...providerLines,
    '',
    ...namedGapLines,
    '',
    `Total model spend: ${totalDisplay} across ${weekCards.length} cards${spentPhrase ? ` (${spentPhrase})` : ''}.`,
    '',
    "Costs are read from Mastra's traces for this Factory project and Factory's own card records. Sessions run outside Factory (Codex, GPT, or Claude sessions started by hand) are not counted and never appear here.",
  ].join('\n');

  return {
    title: noteTitle(to),
    body,
    quiet: lines.length === 0,
    lines,
    totalUsd,
    faceTotalUsd,
    providerTotals,
    namedGaps,
    uncorrelatedUsd,
    failedAttempts,
    from,
    to,
  };
}


/**
 * Publish the note through whatever adapter the caller passes (Issue #180: GitHub Issues).
 *
 * `issues` (or `publisher`) is the GitHub Issues publisher. `discussions` and `notifications`
 * are supported for backwards compatibility with earlier tests.
 */
export async function publishMondayNote({ note, issues, publisher, discussions, notifications }) {
  const client = issues ?? publisher ?? discussions;
  if (!client) throw new Error('publishMondayNote requires an issues or publisher client');

  const findQuery = (client === discussions) ? { category: MONDAY_NOTE_CATEGORY, title: note.title } : { title: note.title };
  const existing = await client.find(findQuery);
  if (existing) return { posted: false, reason: 'already published', url: existing.url };

  const url = await postMondayNote({ note, issues, publisher, discussions });
  if (notifications?.notify) {
    await notifications.notify({ title: note.title, body: note.quiet ? 'Quiet week.' : note.lines[0]?.text ?? '', url });
  }
  return { posted: true, url };
}

/**
 * Create the Issue or Discussion for a note that is known not to have one yet.
 */
export async function postMondayNote({ note, issues, publisher, discussions }) {
  const client = issues ?? publisher ?? discussions;
  if (!client) throw new Error('postMondayNote requires an issues or publisher client');

  if (client === discussions) {
    const discussion = await discussions.post({ category: MONDAY_NOTE_CATEGORY, title: note.title, body: note.body });
    return discussion.url;
  }

  const postResult = await client.post({ title: note.title, body: note.body });
  return postResult.url;
}
