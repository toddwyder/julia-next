#!/usr/bin/env node
// seat-labels.mjs -- JUL-79 step 5, widened to the board's six agents by
// JUL-97 step 2: the canonical label vocabulary for the per-card model/effort
// choices, and the pure resolution from a card's labels to what each agent
// seat should run.
//
// Pure and I/O-free on purpose: the Ready queue uses resolveSeatChoices() to
// decide eligibility and to fill missing defaults, the coordinator uses
// seatChoicesForIssue() to read a card it fetched through linear-cli.mjs, and
// this file is the single source of truth for the label names the board setup
// creates in Linear. No Linear call happens here.
//
// JUL-97 step 2, item 3: GRAPH_AGENTS below is THE source of truth for the six
// agents, their label prefixes and their twelve group names.
// graph/board-spec.mjs imports it from here and re-exports it. The direction
// matters: board-spec.mjs already imports MODEL_SPECS from this file, so
// defining the agents in board-spec.mjs and importing them back would be a
// circular import.
//
// The twelve groups (one label per group allowed on a card) are
// "<Agent> model" and "<Agent> effort" for each of the six agents. Model
// labels are `<code>-<vendor>-<model>`; effort labels are
// `<code>-effort-low|medium|high`. The old three-seat vocabulary
// (Orchestrator/Builder/Reviewer groups and the `orch-` prefix) is gone: the
// BOARD's six-agent vocabulary wins and the code follows it.
import { SEAT_TABLE, FAMILY_OF } from '../graph/seat-table.mjs';
import { DEFAULT_EFFORT, EFFORT_LEVELS, normalizeEffort } from './effort.mjs';

// The six agents the graph runs, in board order. `key` is the SEAT_TABLE entry
// the default model is read from; `code` is the label prefix. These are
// exactly the names the live Julia-next board holds, and no live label name is
// renamed by this file: `builder-*` stays the Feature builder's prefix.
export const GRAPH_AGENTS = Object.freeze([
  Object.freeze({ key: 'feature-builder', code: 'builder', modelGroup: 'Feature builder model', effortGroup: 'Feature builder effort' }),
  Object.freeze({ key: 'defect-fixer', code: 'fixer', modelGroup: 'Defect fixer model', effortGroup: 'Defect fixer effort' }),
  Object.freeze({ key: 'refactor', code: 'refactor', modelGroup: 'Refactor model', effortGroup: 'Refactor effort' }),
  Object.freeze({ key: 'adversarial-reviewer', code: 'adversary', modelGroup: 'Adversarial reviewer model', effortGroup: 'Adversarial reviewer effort' }),
  Object.freeze({ key: 'evidence-reviewer', code: 'evidence', modelGroup: 'Evidence reviewer model', effortGroup: 'Evidence reviewer effort' }),
  Object.freeze({ key: 'consultant', code: 'consultant', modelGroup: 'Consultant model', effortGroup: 'Consultant effort' }),
]);

// The full seat names are how callers key the result; the codes are the label
// prefixes. Derived from GRAPH_AGENTS so the label convention can never drift
// from the agent list.
export const AGENT_CODES = Object.freeze(
  Object.fromEntries(GRAPH_AGENTS.map((agent) => [agent.key, agent.code])),
);

export const CODE_TO_AGENT = Object.freeze(
  Object.fromEntries(GRAPH_AGENTS.map((agent) => [agent.code, agent.key])),
);

export const MODEL_LABEL_GROUP = Object.freeze(
  Object.fromEntries(GRAPH_AGENTS.map((agent) => [agent.key, agent.modelGroup])),
);

export const EFFORT_LABEL_GROUP = Object.freeze(
  Object.fromEntries(GRAPH_AGENTS.map((agent) => [agent.key, agent.effortGroup])),
);

// The exact twelve board group names: the six model groups, then the six
// effort groups, each in GRAPH_AGENTS order.
export const LABEL_GROUPS = Object.freeze([
  ...GRAPH_AGENTS.map((agent) => agent.modelGroup),
  ...GRAPH_AGENTS.map((agent) => agent.effortGroup),
]);

// The two seat names the coordinator dispatches today, and the six-agent key
// each one means. Full six-seat dispatch wiring is JUL-102's job; until then
// `builder` must keep naming the Feature builder and `reviewer` the
// Adversarial reviewer, so validateFamilyChoice, fallbackSeatChoice and the
// `fallback` CLI keep working exactly as they do now.
export const DISPATCH_SEATS = Object.freeze({
  builder: 'feature-builder',
  reviewer: 'adversarial-reviewer',
});

const ALIAS_FOR_AGENT = Object.freeze(
  Object.fromEntries(Object.entries(DISPATCH_SEATS).map(([seat, agent]) => [agent, seat])),
);

// A dispatch seat name ('builder'/'reviewer') resolved to its agent key;
// anything else is returned unchanged, so the six agent keys work directly.
export function canonicalAgent(seat) {
  return Object.hasOwn(DISPATCH_SEATS, seat) ? DISPATCH_SEATS[seat] : seat;
}

// Read one agent's choice out of a choices object. resolveSeatChoices() files
// the two dispatched seats under BOTH their agent key and their dispatch name
// (the same object), so either spelling finds it. The dispatch name wins when
// both are present: that is the name the coordinator writes when it overrides
// a seat, so an override must not be shadowed by the stale agent-keyed entry.
function choiceFor(choices, agentKey) {
  const alias = ALIAS_FOR_AGENT[agentKey];
  return (alias ? choices?.[alias] : undefined) ?? choices?.[agentKey];
}

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
});

// The model each seat-table entry runs when the card names none (the
// "default model from the seat table" the ticket's template pre-applies).
// One per entry, so a card with no model label resolves deterministically.
export const DEFAULT_MODEL_SUFFIX_BY_ENTRY = Object.freeze({
  claude: 'claude-opus',
  codex: 'codex',
  'pi-deepseek': 'deepseek-flash',
});

function suffixKey(suffix) {
  return suffix.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

// The model label NAMES as exported constants, e.g.
// MODEL_LABELS.BUILDER_CLAUDE_OPUS === 'builder-claude-opus'. Derived from
// AGENT_CODES x MODEL_SPECS so the two can never disagree.
export const MODEL_LABELS = Object.freeze(
  Object.fromEntries(
    Object.entries(AGENT_CODES).flatMap(([, code]) =>
      Object.keys(MODEL_SPECS).map((suffix) => [`${code.toUpperCase()}_${suffixKey(suffix)}`, `${code}-${suffix}`]),
    ),
  ),
);

// The effort label NAMES as exported constants, e.g.
// EFFORT_LABELS.ADVERSARY_EFFORT_MEDIUM === 'adversary-effort-medium'.
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

// Model labels that used to exist and were removed on purpose (GLM, JUL-93).
// A card that still carries one is REFUSED, never quietly re-mapped to the
// seat default: "what the card shows is exactly what runs" must hold, and a
// silent switch of vendor would break it.
export const RETIRED_MODEL_SUFFIXES = Object.freeze(['glm-5.3']);

function explicitModelLabel(code, present) {
  for (const name of present) {
    if (MODEL_CATALOG[name] && name.startsWith(`${code}-`)) return name;
  }
  return null;
}

function retiredModelLabel(code, present) {
  return present.find((name) => RETIRED_MODEL_SUFFIXES.some((suffix) => name === `${code}-${suffix}`)) ?? null;
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
//
// All six agents are resolved, keyed by their agent key. The two seats the
// coordinator dispatches are ALSO filed under their dispatch names
// (`builder` -> feature-builder, `reviewer` -> adversarial-reviewer), sharing
// the very same object, so today's callers keep reading `choices.builder` and
// `choices.reviewer` and get the Feature builder and the Adversarial reviewer.
export function resolveSeatChoices(labels) {
  const present = labelNames(labels);
  const choices = {};
  for (const [agent, code] of Object.entries(AGENT_CODES)) {
    const retired = retiredModelLabel(code, present);
    if (retired) {
      choices[agent] = { entry: null, effort: effortFor(code, present), modelLabel: retired, retired: true };
      continue;
    }
    const explicit = explicitModelLabel(code, present);
    const entry = explicit ? MODEL_CATALOG[explicit].entry : SEAT_TABLE[agent].primary;
    const modelLabel = explicit ?? `${code}-${DEFAULT_MODEL_SUFFIX_BY_ENTRY[entry]}`;
    choices[agent] = { entry, effort: effortFor(code, present), modelLabel };
  }
  for (const [seat, agent] of Object.entries(DISPATCH_SEATS)) {
    choices[seat] = choices[agent];
  }
  return choices;
}

// The model and effort labels a card is missing, defaulted. Used by the queue
// to fill a card before it starts; kept pure so the decision is tested without
// Linear. Twelve labels for a card carrying none -- one model and one effort
// per agent, in GRAPH_AGENTS order. The dispatch aliases are deliberately NOT
// walked here: they name the same two agents and would duplicate their labels.
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

// The enforced rule: the dispatched builder and reviewer must be from
// different model families (a model must never review its own family's work),
// and every resolved entry must be a real seat-table entry. Pure:
// `{ ok: true }` or `{ ok: false, reason }` with one plain-English sentence.
// Every one of the six agents is checked for a retired or unknown entry -- the
// GLM refusal fires for any of the six prefixes -- while the family rule
// itself stays exactly what it is today: feature builder vs adversarial
// reviewer, named in the reason by the seats the coordinator dispatches.
export function validateFamilyChoice(choices) {
  for (const agent of Object.keys(AGENT_CODES)) {
    const choice = choiceFor(choices, agent);
    if (choice?.retired) {
      return {
        ok: false,
        reason: `${agent} carries the retired label ${choice.modelLabel} (that model was removed); change it to a current ${agent} model label`,
      };
    }
    const entry = choice?.entry;
    if (!entry || !Object.hasOwn(FAMILY_OF, entry)) {
      return {
        ok: false,
        reason: `${agent} resolved to an unknown seat-table entry (${entry ?? 'none'}); every seat must name a known entry`,
      };
    }
  }
  const builder = choiceFor(choices, DISPATCH_SEATS.builder);
  const reviewer = choiceFor(choices, DISPATCH_SEATS.reviewer);
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
// `{ ok: false, reason }` naming the refused backup and why. `seat` may be an
// agent key or a dispatch name; the moved choice is written under BOTH so no
// reader sees a stale one.
export function fallbackSeatChoice(choices, seat, { table = SEAT_TABLE } = {}) {
  const agent = canonicalAgent(seat);
  const code = AGENT_CODES[agent];
  if (!code) {
    return { ok: false, reason: `cannot fall back: '${seat}' is not an agent seat` };
  }
  const backupEntry = table?.[agent]?.backup;
  if (!backupEntry) {
    return { ok: false, reason: `cannot fall back: ${seat} has no backup entry in the seat table` };
  }
  const moved = {
    ...choiceFor(choices, agent),
    entry: backupEntry,
    modelLabel: `${code}-${DEFAULT_MODEL_SUFFIX_BY_ENTRY[backupEntry]}`,
  };
  const fallbackChoices = { ...choices, [agent]: moved };
  if (ALIAS_FOR_AGENT[agent]) fallbackChoices[ALIAS_FOR_AGENT[agent]] = moved;
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
// and resolves the six seats. Pure.
export function seatChoicesForIssue(issue) {
  return resolveSeatChoices(issue?.labels);
}

// A real CLI entry point for the fallback guard (JUL-79 step 8 follow-up).
// The guard above is only real if the coordinator actually runs it: the
// skill's fallback passages now name this command, so a capped seat's backup
// is resolved through fallbackSeatChoice instead of being read off the table
// raw. Given the entry in use on the OTHER seat (the family rule is only
// builder-vs-reviewer), it prints the backup entry to dispatch, or refuses
// with the guard's own reason and a non-zero exit. It is a thin passthrough
// over fallbackSeatChoice/validateFamilyChoice -- never a second copy of the
// rule.
const SEAT_ARGUMENTS = [...Object.keys(DISPATCH_SEATS), ...Object.keys(AGENT_CODES)];
const USAGE = {
  fallback: `usage: seat-labels.mjs fallback --seat <${SEAT_ARGUMENTS.join('|')}> --builder <entry> (when the reviewer falls back) or --reviewer <entry> (when the builder falls back)`,
};
const USAGE_ROOT = 'usage: seat-labels.mjs fallback --seat <seat> [--builder <entry>] [--reviewer <entry>]';

// Distinct from a refusal so the exit code can tell the two apart (2 = bad
// argv, matching the other repo CLIs; 1 = the guard refused the fallback).
class UsageError extends Error {}

function parseFlags(args, allowed, usage) {
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      throw new UsageError(usage);
    }
    const name = arg.slice(2);
    if (!allowed.includes(name)) {
      throw new UsageError(usage);
    }
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError(usage);
    }
    flags[name] = value;
    i += 1;
  }
  return flags;
}

// Re-point one seat's choice at an entry the coordinator says is in use,
// keeping the label convention (`<code>-<default suffix>`) so the refusal
// reason names the same model the card does.
function withEntry(choices, agent, entry) {
  const code = AGENT_CODES[agent];
  const moved = { ...choiceFor(choices, agent), entry, modelLabel: `${code}-${DEFAULT_MODEL_SUFFIX_BY_ENTRY[entry]}` };
  choices[agent] = moved;
  if (ALIAS_FOR_AGENT[agent]) choices[ALIAS_FOR_AGENT[agent]] = moved;
}

// main() takes every dependency as an injectable default so the CLI can be
// tested without a subprocess. Called bare by the guard at the bottom of
// this file, where the defaults are the real process argv/stdio/exitCode.
export function main({
  argv = process.argv.slice(2),
  stdout = process.stdout,
  stderr = process.stderr,
  setExitCode = (code) => { process.exitCode = code; },
} = {}) {
  const [command, ...rest] = argv;
  const usage = USAGE[command];
  if (!usage) {
    stderr.write(`${USAGE_ROOT}\n`);
    setExitCode(2);
    return;
  }
  try {
    const flags = parseFlags(rest, ['seat', 'builder', 'reviewer'], usage);
    if (!flags.seat || !SEAT_ARGUMENTS.includes(flags.seat)) {
      throw new UsageError(usage);
    }
    // Start from the table's own resolution, then overlay the entry the
    // caller says is in use on the other seat. Never assume which flag was
    // passed: the reviewer's fallback is checked against the builder, and
    // the builder's against the reviewer. The family rule is only about the
    // two dispatched seats, so any other seat needs no overlay.
    const choices = resolveSeatChoices([]);
    const seatAgent = canonicalAgent(flags.seat);
    if (seatAgent === DISPATCH_SEATS.reviewer) {
      if (!flags.builder || !Object.hasOwn(FAMILY_OF, flags.builder)) throw new UsageError(usage);
      withEntry(choices, DISPATCH_SEATS.builder, flags.builder);
    } else if (seatAgent === DISPATCH_SEATS.builder) {
      if (!flags.reviewer || !Object.hasOwn(FAMILY_OF, flags.reviewer)) throw new UsageError(usage);
      withEntry(choices, DISPATCH_SEATS.reviewer, flags.reviewer);
    }
    const result = fallbackSeatChoice(choices, flags.seat);
    if (!result.ok) {
      stderr.write(`${result.reason}\n`);
      setExitCode(1);
      return;
    }
    const choice = choiceFor(result.choices, canonicalAgent(flags.seat));
    stdout.write(`${JSON.stringify({ seat: flags.seat, entry: choice.entry, modelLabel: choice.modelLabel }, null, 2)}\n`);
    setExitCode(0);
  } catch (error) {
    // A usage error and a refused fallback both go to stderr as one line;
    // only the exit code differs (2 vs 1). Never a raw stack trace.
    stderr.write(`${error.message}\n`);
    setExitCode(error instanceof UsageError ? 2 : 1);
  }
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
