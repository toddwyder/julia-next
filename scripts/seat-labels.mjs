#!/usr/bin/env node
// seat-labels.mjs -- JUL-79 step 5: the canonical label vocabulary for the
// six per-card model/effort choices, and the pure resolution from a card's
// labels to what each agent seat should run.
//
// Pure and I/O-free on purpose: the Ready queue uses resolveSeatChoices() to
// decide eligibility and to fill missing defaults, the coordinator uses
// seatChoicesForIssue() to read a card it fetched through linear-cli.mjs, and
// this file is the single source of truth for the label names a later
// coordinator step creates in Linear. No Linear call happens here.
//
// The six groups (one label per group allowed on a card):
//   - "Orchestrator model" / "Builder model" / "Reviewer model"
//   - "Orchestrator effort" / "Builder effort" / "Reviewer effort"
// Model labels are `<agent>-<vendor>-<model>` with `<agent>` one of
// `orch`/`builder`/`reviewer`; effort labels are `<agent>-effort-low|medium|high`.
import { SEAT_TABLE, FAMILY_OF } from '../graph/seat-table.mjs';
import { DEFAULT_EFFORT, EFFORT_LEVELS, normalizeEffort } from './effort.mjs';

// The full seat names are how callers key the result; the codes are the label
// prefixes. Keeping both here means the label convention can never drift from
// the seat table's own key names.
export const AGENT_CODES = Object.freeze({
  orchestrator: 'orch',
  builder: 'builder',
  reviewer: 'reviewer',
});

export const CODE_TO_AGENT = Object.freeze(
  Object.fromEntries(Object.entries(AGENT_CODES).map(([agent, code]) => [code, agent])),
);

export const MODEL_LABEL_GROUP = Object.freeze({
  orchestrator: 'Orchestrator model',
  builder: 'Builder model',
  reviewer: 'Reviewer model',
});

export const EFFORT_LABEL_GROUP = Object.freeze({
  orchestrator: 'Orchestrator effort',
  builder: 'Builder effort',
  reviewer: 'Reviewer effort',
});

// The exact six group names, in the ticket's own order.
export const LABEL_GROUPS = Object.freeze([
  'Orchestrator model',
  'Builder model',
  'Reviewer model',
  'Orchestrator effort',
  'Builder effort',
  'Reviewer effort',
]);

// The catalogue of vendor models each seat may be pointed at. `entry` is the
// SEAT_TABLE entry (the launch route and model family); `model` is the
// vendor's own model id where that route needs one (null where the route
// already names its single current model, e.g. Codex). Plain, frozen data a
// later coordinator step extends when a vendor ships a new model -- every
// label name is derived from these keys, so adding one here is the whole
// change.
export const MODEL_SPECS = Object.freeze({
  'claude-opus': { entry: 'claude', model: 'opus' },
  'claude-sonnet': { entry: 'claude', model: 'sonnet' },
  'claude-haiku': { entry: 'claude', model: 'haiku' },
  codex: { entry: 'codex', model: null },
  'deepseek-pro': { entry: 'pi-deepseek', model: 'deepseek-v4-pro' },
  'deepseek-flash': { entry: 'pi-deepseek', model: 'deepseek-v4-flash' },
  'glm-5.3': { entry: 'pi-glm', model: 'glm-5.3' },
});

// The model each seat-table entry runs when the card names none (the
// "default model from the seat table" the ticket's template pre-applies).
// One per entry, so a card with no model label resolves deterministically.
export const DEFAULT_MODEL_SUFFIX_BY_ENTRY = Object.freeze({
  claude: 'claude-opus',
  codex: 'codex',
  'pi-deepseek': 'deepseek-flash',
  'pi-glm': 'glm-5.3',
});

function suffixKey(suffix) {
  return suffix.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

// The model label NAMES as exported constants, e.g. MODEL_LABELS.ORCH_CLAUDE_OPUS
// === 'orch-claude-opus'. Derived from AGENT_CODES x MODEL_SPECS so the two
// can never disagree.
export const MODEL_LABELS = Object.freeze(
  Object.fromEntries(
    Object.entries(AGENT_CODES).flatMap(([, code]) =>
      Object.keys(MODEL_SPECS).map((suffix) => [`${code.toUpperCase()}_${suffixKey(suffix)}`, `${code}-${suffix}`]),
    ),
  ),
);

// The effort label NAMES as exported constants, e.g.
// EFFORT_LABELS.REVIEWER_EFFORT_MEDIUM === 'reviewer-effort-medium'.
export const EFFORT_LABELS = Object.freeze(
  Object.fromEntries(
    Object.entries(AGENT_CODES).flatMap(([, code]) =>
      EFFORT_LEVELS.map((level) => [`${code.toUpperCase()}_EFFORT_${level.toUpperCase()}`, `${code}-effort-${level}`]),
    ),
  ),
);

// Every model label -> the seat-table entry and vendor model id it means.
// Keyed by the full label name (`builder-deepseek-flash`) so a caller can look
// a card's label up directly.
export const MODEL_CATALOG = Object.freeze(
  Object.fromEntries(
    Object.entries(AGENT_CODES).flatMap(([, code]) =>
      Object.entries(MODEL_SPECS).map(([suffix, spec]) => [`${code}-${suffix}`, Object.freeze({ ...spec })]),
    ),
  ),
);

// Labels may arrive as plain strings (the Ready queue's normalized shape) or
// as the `{ nodes: [{ name }] }` connection `getIssue` returns. This is the
// one place that difference is absorbed.
export function labelNames(labels) {
  if (!labels) return [];
  const nodes = Array.isArray(labels) ? labels : (labels.nodes ?? []);
  return nodes
    .map((label) => (typeof label === 'string' ? label : label?.name))
    .filter((name) => typeof name === 'string' && name.length > 0);
}

function explicitModelLabel(code, present) {
  for (const name of present) {
    if (MODEL_CATALOG[name] && name.startsWith(`${code}-`)) return name;
  }
  return null;
}

function effortFor(code, present) {
  const pattern = new RegExp(`^${code}-effort-(low|medium|high)$`);
  for (const name of present) {
    const match = pattern.exec(name);
    if (match) return normalizeEffort(match[1]);
  }
  return DEFAULT_EFFORT;
}

// Resolve each seat's entry + effort from a card's labels. A present model or
// effort label wins; an absent model label falls back to that agent's
// seat-table primary entry and its default model, and an absent effort is
// Medium. Unrecognized labels are ignored, never a crash. The returned
// `modelLabel` is always the label the card should carry, which is what makes
// "what the card shows is exactly what runs" checkable.
export function resolveSeatChoices(labels) {
  const present = labelNames(labels);
  const choices = {};
  for (const [agent, code] of Object.entries(AGENT_CODES)) {
    const explicit = explicitModelLabel(code, present);
    const entry = explicit ? MODEL_CATALOG[explicit].entry : SEAT_TABLE[agent].primary;
    const modelLabel = explicit ?? `${code}-${DEFAULT_MODEL_SUFFIX_BY_ENTRY[entry]}`;
    choices[agent] = { entry, effort: effortFor(code, present), modelLabel };
  }
  return choices;
}

// The model and effort labels a card is missing, defaulted. Used by the queue
// to fill a card before it starts; kept pure so the decision is tested without
// Linear.
export function missingSeatLabels(labels) {
  const present = labelNames(labels);
  const presentSet = new Set(present);
  const choices = resolveSeatChoices(present);
  const missing = [];
  for (const [agent, code] of Object.entries(AGENT_CODES)) {
    const choice = choices[agent];
    if (!presentSet.has(choice.modelLabel)) missing.push(choice.modelLabel);
    const effortLabel = `${code}-effort-${choice.effort}`;
    if (!presentSet.has(effortLabel)) missing.push(effortLabel);
  }
  return missing;
}

// The enforced rule: builder and reviewer must be from different model
// families (a model must never review its own family's work), and every
// resolved entry must be a real seat-table entry. Pure: `{ ok: true }` or
// `{ ok: false, reason }` with one plain-English sentence naming both models.
export function validateFamilyChoice(choices) {
  for (const agent of Object.keys(AGENT_CODES)) {
    const entry = choices?.[agent]?.entry;
    if (!entry || !Object.hasOwn(FAMILY_OF, entry)) {
      return {
        ok: false,
        reason: `${agent} resolved to an unknown seat-table entry (${entry ?? 'none'}); every seat must name a known entry`,
      };
    }
  }
  const { builder, reviewer } = choices;
  if (FAMILY_OF[builder.entry] === FAMILY_OF[reviewer.entry]) {
    return {
      ok: false,
      reason: `builder (${builder.modelLabel ?? builder.entry}) and reviewer (${reviewer.modelLabel ?? reviewer.entry}) are both from the ${FAMILY_OF[builder.entry]} model family; builder and reviewer must be from different families`,
    };
  }
  return { ok: true };
}

// The runtime fallback path (JUL-79 step 8): when a seat's primary ends in a
// usage-cap error the coordinator restarts that step on the seat's `backup`
// entry. That fallback is a NEW resolved pair, so it must be re-checked
// against the same builder/reviewer rule -- via validateFamilyChoice, never a
// second copy of it. If the natural backup would put builder and reviewer in
// the same family (e.g. reviewer falling back to claude while the builder is
// already claude), the fallback is REFUSED rather than silently used. Pure:
// `{ ok: true, choices }` with the seat moved to its backup, or
// `{ ok: false, reason }` naming the refused backup and why.
export function fallbackSeatChoice(choices, seat, { table = SEAT_TABLE } = {}) {
  const code = AGENT_CODES[seat];
  if (!code) {
    return { ok: false, reason: `cannot fall back: '${seat}' is not an agent seat` };
  }
  const backupEntry = table?.[seat]?.backup;
  if (!backupEntry) {
    return { ok: false, reason: `cannot fall back: ${seat} has no backup entry in the seat table` };
  }
  const fallbackChoices = {
    ...choices,
    [seat]: {
      ...choices?.[seat],
      entry: backupEntry,
      modelLabel: `${code}-${DEFAULT_MODEL_SUFFIX_BY_ENTRY[backupEntry]}`,
    },
  };
  const valid = validateFamilyChoice(fallbackChoices);
  if (!valid.ok) {
    return {
      ok: false,
      reason: `refusing the ${seat} backup (${backupEntry}): ${valid.reason}`,
    };
  }
  return { ok: true, choices: fallbackChoices };
}

// Read-only helper for the coordinator: takes an issue object as
// linear-cli.mjs's getIssue() returns it (labels as `{ nodes: [{ name }] }`)
// and resolves the three seats. Pure.
export function seatChoicesForIssue(issue) {
  return resolveSeatChoices(issue?.labels);
}
