// seat-labels.test.mjs -- JUL-79 step 5, widened by JUL-97 step 2. Pure: no
// I/O, no network. Pins the label-group and label-name vocabulary for the
// board's SIX agents, the catalogue -> seat-table mapping, and the
// resolution/family rules the Ready queue and the coordinator both depend on
// -- including that the two seats the coordinator dispatches, `builder` and
// `reviewer`, keep naming the Feature builder and the Adversarial reviewer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { SEAT_TABLE, FAMILY_OF } from '../graph/seat-table.mjs';
import {
  GRAPH_AGENTS,
  DISPATCH_SEATS,
  canonicalAgent,
  LABEL_GROUPS,
  MODEL_LABEL_GROUP,
  EFFORT_LABEL_GROUP,
  AGENT_CODES,
  MODEL_SPECS,
  MODEL_CATALOG,
  MODEL_LABELS,
  EFFORT_LABELS,
  labelNames,
  resolveSeatChoices,
  missingSeatLabels,
  validateFamilyChoice,
  fallbackSeatChoice,
  seatChoicesForIssue,
  main,
} from './seat-labels.mjs';

const execFileAsync = promisify(execFile);
const SEAT_LABELS_CLI = fileURLToPath(new URL('./seat-labels.mjs', import.meta.url));

// Run the exported CLI main() with captured streams and a captured exit
// code, so the argv/exit-code behaviour is asserted without a subprocess.
function runCli(argv) {
  let out = '';
  let err = '';
  let code;
  const stdout = { write: (chunk) => { out += chunk; } };
  const stderr = { write: (chunk) => { err += chunk; } };
  main({ argv, stdout, stderr, setExitCode: (c) => { code = c; } });
  return { out, err, code };
}

const AGENTS = [
  'feature-builder',
  'defect-fixer',
  'refactor',
  'adversarial-reviewer',
  'evidence-reviewer',
  'consultant',
];

// JUL-97 step 2, item 3: this file is the single source of truth for the six
// agents, their prefixes and their twelve group names. The names below are
// exactly what the live Julia-next board holds; none of them is renamed.
test('the six agents, their label prefixes and their twelve group names are exactly the board\'s', () => {
  assert.deepEqual(GRAPH_AGENTS.map((agent) => agent.key), AGENTS);
  assert.deepEqual(GRAPH_AGENTS.map((agent) => agent.code), [
    'builder', 'fixer', 'refactor', 'adversary', 'evidence', 'consultant',
  ]);
  assert.deepEqual(LABEL_GROUPS, [
    'Feature builder model',
    'Defect fixer model',
    'Refactor model',
    'Adversarial reviewer model',
    'Evidence reviewer model',
    'Consultant model',
    'Feature builder effort',
    'Defect fixer effort',
    'Refactor effort',
    'Adversarial reviewer effort',
    'Evidence reviewer effort',
    'Consultant effort',
  ]);
  assert.equal(LABEL_GROUPS.length, 12);
  assert.deepEqual(Object.keys(MODEL_LABEL_GROUP), AGENTS);
  assert.deepEqual(Object.keys(EFFORT_LABEL_GROUP), AGENTS);
  assert.equal(MODEL_LABEL_GROUP['feature-builder'], 'Feature builder model');
  assert.equal(EFFORT_LABEL_GROUP['adversarial-reviewer'], 'Adversarial reviewer effort');
  // The old three-seat vocabulary is gone.
  assert.ok(!LABEL_GROUPS.some((name) => /^(Orchestrator|Builder|Reviewer) (model|effort)$/.test(name)));
  assert.ok(!Object.values(AGENT_CODES).includes('orch'));
});

// Full six-seat dispatch is JUL-102's job. Until then the coordinator still
// dispatches exactly two seats by the names `builder` and `reviewer`, and they
// must keep naming the Feature builder and the Adversarial reviewer.
test('the two dispatched seat names still name the feature builder and the adversarial reviewer', () => {
  assert.deepEqual(DISPATCH_SEATS, { builder: 'feature-builder', reviewer: 'adversarial-reviewer' });
  assert.equal(canonicalAgent('builder'), 'feature-builder');
  assert.equal(canonicalAgent('reviewer'), 'adversarial-reviewer');
  assert.equal(canonicalAgent('consultant'), 'consultant');
  const choices = resolveSeatChoices([]);
  assert.equal(choices.builder, choices['feature-builder'], 'the dispatched builder IS the feature builder');
  assert.equal(choices.reviewer, choices['adversarial-reviewer'], 'the dispatched reviewer IS the adversarial reviewer');
});

test('the label-name convention produces the exact names the ticket gives', () => {
  assert.equal(MODEL_LABELS.BUILDER_CLAUDE_OPUS, 'builder-claude-opus');
  assert.equal(MODEL_LABELS.BUILDER_DEEPSEEK_FLASH, 'builder-deepseek-flash');
  assert.equal(MODEL_LABELS.FIXER_DEEPSEEK_PRO, 'fixer-deepseek-pro');
  assert.equal(MODEL_LABELS.ADVERSARY_CODEX, 'adversary-codex');
  assert.equal(MODEL_LABELS.EVIDENCE_CODEX, 'evidence-codex');
  assert.equal(MODEL_LABELS.CONSULTANT_CLAUDE_SONNET, 'consultant-claude-sonnet');
  assert.ok(!Object.values(MODEL_LABELS).some((name) => name.includes('glm')), 'no GLM label exists (JUL-93)');
  assert.equal(EFFORT_LABELS.ADVERSARY_EFFORT_MEDIUM, 'adversary-effort-medium');
  assert.equal(EFFORT_LABELS.REFACTOR_EFFORT_LOW, 'refactor-effort-low');
  // No label still carries the retired `orch-` prefix.
  assert.ok(!Object.values(MODEL_LABELS).some((name) => name.startsWith('orch-')));
  assert.ok(!Object.values(EFFORT_LABELS).some((name) => name.startsWith('orch-')));

  // Every agent offers every catalogue model and every effort level.
  for (const [agent, code] of Object.entries(AGENT_CODES)) {
    for (const suffix of Object.keys(MODEL_SPECS)) {
      assert.ok(`${code}-${suffix}` in MODEL_CATALOG, `${agent} is missing model label ${code}-${suffix}`);
    }
    for (const level of ['low', 'medium', 'high']) {
      assert.ok(Object.values(EFFORT_LABELS).includes(`${code}-effort-${level}`), `${agent} is missing ${level} effort`);
    }
  }
});

test('every catalogue entry names a real seat-table entry with a known family', () => {
  for (const [label, spec] of Object.entries(MODEL_CATALOG)) {
    assert.ok(Object.hasOwn(FAMILY_OF, spec.entry), `${label} names an entry with no family: ${spec.entry}`);
  }
});

test('over the whole catalogue, Claude models resolve only to claude and Codex only to codex', () => {
  for (const [label, spec] of Object.entries(MODEL_CATALOG)) {
    if (label.includes('claude-')) assert.equal(spec.entry, 'claude', `${label} must be the claude entry`);
    if (/-codex$/.test(label)) assert.equal(spec.entry, 'codex', `${label} must be the codex entry`);
    if (label.includes('deepseek-')) assert.equal(spec.entry, 'pi-deepseek', label);
    assert.ok(!label.includes('glm'), `${label} must not exist: GLM was removed (JUL-93)`);
  }
});

test('absent labels resolve to the seat-table primary entry and Medium effort for every agent', () => {
  const choices = resolveSeatChoices([]);
  for (const [agent, code] of Object.entries(AGENT_CODES)) {
    assert.equal(choices[agent].entry, SEAT_TABLE[agent].primary, `${agent} entry`);
    assert.equal(choices[agent].effort, 'medium', `${agent} effort`);
    assert.ok(choices[agent].modelLabel.startsWith(`${code}-`), `${agent} modelLabel`);
  }
});

test('every agent has a default for all three choices', () => {
  const choices = resolveSeatChoices([]);
  for (const agent of AGENTS) {
    assert.ok(choices[agent], `no choice for ${agent}`);
    assert.ok(choices[agent].entry, `${agent} has no entry`);
    assert.ok(choices[agent].modelLabel, `${agent} has no model label`);
    assert.equal(choices[agent].effort, 'medium');
  }
});

test('a present model label wins over the default, for each agent', () => {
  const choices = resolveSeatChoices([
    'builder-deepseek-pro', 'fixer-codex', 'refactor-claude-haiku',
    'adversary-claude-haiku', 'evidence-deepseek-flash', 'consultant-codex',
  ]);
  assert.equal(choices['feature-builder'].entry, 'pi-deepseek');
  assert.equal(choices['feature-builder'].modelLabel, 'builder-deepseek-pro');
  assert.equal(choices['defect-fixer'].entry, 'codex');
  assert.equal(choices.refactor.modelLabel, 'refactor-claude-haiku');
  assert.equal(choices['adversarial-reviewer'].entry, 'claude');
  assert.equal(choices['evidence-reviewer'].entry, 'pi-deepseek');
  assert.equal(choices.consultant.entry, 'codex');
});

// The card names a model with the `builder-` prefix; BOTH the feature builder
// and the seat the coordinator dispatches as `builder` must run it.
test('builder-deepseek-flash resolves the feature builder AND the dispatched builder seat to pi-deepseek', () => {
  const choices = resolveSeatChoices(['builder-deepseek-flash']);
  assert.equal(choices['feature-builder'].entry, 'pi-deepseek');
  assert.equal(choices['feature-builder'].modelLabel, 'builder-deepseek-flash');
  assert.equal(choices.builder.entry, 'pi-deepseek');
  assert.equal(choices.builder.modelLabel, 'builder-deepseek-flash');
  // And the adversary prefix does the same for the dispatched reviewer seat.
  const reviewed = resolveSeatChoices(['adversary-deepseek-pro']);
  assert.equal(reviewed['adversarial-reviewer'].entry, 'pi-deepseek');
  assert.equal(reviewed.reviewer.modelLabel, 'adversary-deepseek-pro');
});

test('a present effort label wins; absent is Medium', () => {
  const choices = resolveSeatChoices(['consultant-effort-high', 'builder-effort-low']);
  assert.equal(choices.consultant.effort, 'high');
  assert.equal(choices['feature-builder'].effort, 'low');
  assert.equal(choices.builder.effort, 'low');
  assert.equal(choices['adversarial-reviewer'].effort, 'medium');
});

test('unknown and malformed labels are ignored, never a crash', () => {
  const choices = resolveSeatChoices([42, null, undefined, {}, 'not-a-real-label', 'adversary-effort-turbo', { name: 'builder-effort-high' }]);
  assert.equal(choices.builder.effort, 'high');
  assert.equal(choices.reviewer.effort, 'medium');
  assert.equal(choices.consultant.entry, SEAT_TABLE.consultant.primary);
  assert.deepEqual(resolveSeatChoices(undefined), resolveSeatChoices([]));
});

test('labelNames reads plain arrays, getIssue connections, and objects, dropping junk', () => {
  assert.deepEqual(labelNames(['a', { name: 'b' }, null, 3]), ['a', 'b']);
  assert.deepEqual(labelNames({ nodes: [{ name: 'adversary-codex' }] }), ['adversary-codex']);
  assert.deepEqual(labelNames(undefined), []);
});

test('the family rule accepts the default table and an explicitly differing pair', () => {
  assert.deepEqual(validateFamilyChoice(resolveSeatChoices([])), { ok: true });
  assert.deepEqual(
    validateFamilyChoice(resolveSeatChoices(['builder-claude-opus', 'adversary-codex'])),
    { ok: true },
  );
  assert.deepEqual(
    validateFamilyChoice(resolveSeatChoices(['builder-deepseek-flash', 'adversary-claude-sonnet'])),
    { ok: true },
  );
});

test('the family rule rejects a same-family builder/reviewer pair, in one sentence naming both models', () => {
  const result = validateFamilyChoice(resolveSeatChoices(['builder-claude-opus', 'adversary-claude-sonnet']));
  assert.equal(result.ok, false);
  assert.match(result.reason, /builder-claude-opus/);
  assert.match(result.reason, /adversary-claude-sonnet/);
  assert.match(result.reason, /different families/);
});

test('a seat fallback that keeps builder and reviewer in different families is allowed', () => {
  const choices = resolveSeatChoices([]); // builder claude, reviewer codex
  const result = fallbackSeatChoice(choices, 'builder');
  assert.equal(result.ok, true);
  assert.equal(result.choices.builder.entry, 'pi-deepseek');
  assert.equal(result.choices.builder.modelLabel, 'builder-deepseek-flash');
  assert.equal(result.choices['feature-builder'].entry, 'pi-deepseek', 'the agent-keyed entry moves too');
  assert.equal(result.choices.reviewer.entry, 'codex');
});

test('a capped reviewer falls back to DeepSeek when the builder is claude (the default) -- JUL-98', () => {
  const choices = resolveSeatChoices([]); // builder claude, reviewer codex
  assert.equal(choices.builder.entry, 'claude');
  const result = fallbackSeatChoice(choices, 'reviewer');
  assert.equal(result.ok, true, 'the reviewer fallback must succeed against a claude builder');
  assert.equal(result.choices.reviewer.entry, 'pi-deepseek');
  assert.equal(result.choices['adversarial-reviewer'].entry, 'pi-deepseek', 'the agent-keyed entry moves too');
  assert.equal(result.choices.builder.entry, 'claude', 'the builder is untouched');
});

test('a fallback whose backup collides with the other seat is still refused, not silently used', () => {
  const choices = resolveSeatChoices([]); // builder claude, reviewer codex
  // A table whose reviewer backup is claude (the builder's family): the guard
  // must refuse it, not produce a same-family pair. The real table no longer
  // has this backup (JUL-98), so the guard is exercised on a copy that does.
  const collidingTable = { ...SEAT_TABLE, 'adversarial-reviewer': { primary: 'codex', backup: 'claude' } };
  const result = fallbackSeatChoice(choices, 'reviewer', { table: collidingTable });
  assert.equal(result.ok, false);
  assert.match(result.reason, /refusing the reviewer backup/);
  assert.match(result.reason, /different families/);
});

// GLM was removed (JUL-93). A card that still carries a GLM label is REFUSED
// with a plain reason -- never launched on GLM and never quietly re-mapped to
// the seat default (a silent vendor switch would break "what the card shows is
// what runs").
test('a leftover GLM label is refused with a plain reason: no launch entry, no silent default, no label added', () => {
  for (const agent of AGENTS) {
    const code = AGENT_CODES[agent];
    const label = `${code}-glm-5.3`;
    const choices = resolveSeatChoices([label]);
    assert.equal(choices[agent].entry, null, `${agent} must not resolve to any launch entry`);
    assert.equal(choices[agent].modelLabel, label);
    const verdict = validateFamilyChoice(choices);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, new RegExp(`${agent} carries the retired label ${label.replace('.', '\\.')}`));
    assert.match(verdict.reason, /change it to a current/);
    // The queue must not paper over it by adding a default model label.
    assert.ok(!missingSeatLabels([label]).some((name) => name.startsWith(`${code}-`) && !name.includes('-effort-')));
  }
  assert.ok(!Object.values(resolveSeatChoices(['builder-glm-5.3'])).some((choice) => choice.entry === 'pi-glm'));
});

test('the family rule rejects an unknown seat-table entry', () => {
  const result = validateFamilyChoice({ ...resolveSeatChoices([]), builder: { entry: 'gemini' } });
  assert.equal(result.ok, false);
  assert.match(result.reason, /feature-builder/);
  assert.match(result.reason, /unknown seat-table entry \(gemini\)/);
  // And an unknown entry on a seat that is NOT dispatched is caught too: all
  // six agents are checked, not only the builder/reviewer pair.
  const consultant = validateFamilyChoice({ ...resolveSeatChoices([]), consultant: { entry: 'gemini' } });
  assert.equal(consultant.ok, false);
  assert.match(consultant.reason, /consultant resolved to an unknown seat-table entry/);
});

// JUL-97 step 2, item 5: the twelve labels the team template applies, with
// exactly the names the live board holds.
test('missingSeatLabels returns exactly the twelve default model and effort labels not already present', () => {
  assert.deepEqual(missingSeatLabels([]), [
    'builder-claude-opus',
    'builder-effort-medium',
    'fixer-claude-opus',
    'fixer-effort-medium',
    'refactor-claude-opus',
    'refactor-effort-medium',
    'adversary-codex',
    'adversary-effort-medium',
    'evidence-codex',
    'evidence-effort-medium',
    'consultant-claude-opus',
    'consultant-effort-medium',
  ]);
  assert.equal(missingSeatLabels([]).length, 12);
  // Twelve, not fourteen: the two dispatch aliases name agents already in the
  // list and must not duplicate their labels.
  assert.equal(new Set(missingSeatLabels([])).size, 12);
  assert.deepEqual(missingSeatLabels(['builder-claude-opus', 'builder-effort-high']), [
    'fixer-claude-opus',
    'fixer-effort-medium',
    'refactor-claude-opus',
    'refactor-effort-medium',
    'adversary-codex',
    'adversary-effort-medium',
    'evidence-codex',
    'evidence-effort-medium',
    'consultant-claude-opus',
    'consultant-effort-medium',
  ]);
  assert.deepEqual(missingSeatLabels(missingSeatLabels([])), []);
});

test('seatChoicesForIssue resolves the exact shape linear-cli getIssue returns', () => {
  const issue = {
    id: 'uuid-1',
    identifier: 'JUL-79',
    labels: { nodes: [{ name: 'builder-claude-opus' }, { name: 'adversary-codex' }, { name: 'consultant-effort-high' }] },
  };
  const choices = seatChoicesForIssue(issue);
  assert.equal(choices.builder.entry, 'claude');
  assert.equal(choices.reviewer.entry, 'codex');
  assert.equal(choices.consultant.effort, 'high');
  assert.equal(choices.consultant.entry, SEAT_TABLE.consultant.primary);
});

// --- JUL-79 step 8 follow-up: the guard must be callable and tested by the
// exact real combination the table puts on a card. ---

test('the reviewer backup is not the builder default family, and the guard still refuses a claude reviewer against a claude builder', () => {
  // The real table's reviewer backup (deepseek) differs from the builder's
  // primary (claude), which is what lets the fallback succeed (JUL-98). The
  // guard itself is unchanged: an explicit claude-vs-claude pair is refused.
  assert.equal(SEAT_TABLE['feature-builder'].primary, 'claude');
  assert.notEqual(FAMILY_OF[SEAT_TABLE['adversarial-reviewer'].backup], FAMILY_OF[SEAT_TABLE['feature-builder'].primary]);
  assert.notEqual(FAMILY_OF[SEAT_TABLE.reviewer.backup], FAMILY_OF[SEAT_TABLE.builder.primary]);
  const unsafePair = {
    ...resolveSeatChoices([]),
    builder: { entry: 'claude' },
    reviewer: { entry: 'claude' },
  };
  const validated = validateFamilyChoice(unsafePair);
  assert.equal(validated.ok, false);
  assert.match(validated.reason, /anthropic/);
});

test('the fallback CLI allows reviewer -> pi-deepseek while the builder is on claude, printing the entry to use (JUL-98)', () => {
  const { out, err, code } = runCli(['fallback', '--seat', 'reviewer', '--builder', 'claude']);
  assert.equal(code, 0);
  assert.equal(err, '');
  // `--seat reviewer` keeps working and still names the adversarial reviewer;
  // the printed label carries that seat's live board prefix.
  assert.deepEqual(JSON.parse(out), { seat: 'reviewer', entry: 'pi-deepseek', modelLabel: 'adversary-deepseek-flash' });
  assert.match(out, /\n {2}"seat"/);
  // The agent key spells the same fallback.
  const byAgentKey = runCli(['fallback', '--seat', 'adversarial-reviewer', '--builder', 'claude']);
  assert.equal(byAgentKey.code, 0);
  assert.equal(JSON.parse(byAgentKey.out).entry, 'pi-deepseek');
});

test('the fallback CLI refuses reviewer -> pi-deepseek while the builder is already on pi-deepseek, and exits non-zero', () => {
  const { out, err, code } = runCli(['fallback', '--seat', 'reviewer', '--builder', 'pi-deepseek']);
  assert.notEqual(code, 0);
  assert.equal(out, '');
  assert.match(err, /refusing the reviewer backup \(pi-deepseek\)/);
  assert.match(err, /different families/);
  assert.equal(err.trim().split('\n').length, 1);
});

test('the fallback CLI is a real entry point: the process itself allows the reviewer fallback off a claude builder (JUL-98)', async () => {
  const { stdout } = await execFileAsync(process.execPath, [SEAT_LABELS_CLI, 'fallback', '--seat', 'reviewer', '--builder', 'claude']);
  assert.deepEqual(JSON.parse(stdout), { seat: 'reviewer', entry: 'pi-deepseek', modelLabel: 'adversary-deepseek-flash' });
});

test('the fallback CLI is a real entry point: the process itself refuses the reviewer fallback off a pi-deepseek builder, non-zero', async () => {
  await assert.rejects(
    () => execFileAsync(process.execPath, [SEAT_LABELS_CLI, 'fallback', '--seat', 'reviewer', '--builder', 'pi-deepseek']),
    (error) => {
      assert.notEqual(error.code, 0);
      assert.match(error.stderr, /refusing the reviewer backup \(pi-deepseek\)/);
      return true;
    },
  );
});

test('the fallback CLI treats a bad seat or an unknown builder entry as a one-line usage error, not a refusal', () => {
  const badSeat = runCli(['fallback', '--seat', 'potato', '--builder', 'claude']);
  assert.equal(badSeat.code, 2);
  assert.match(badSeat.err, /^usage: /);
  const unknownBuilder = runCli(['fallback', '--seat', 'reviewer', '--builder', 'gemini']);
  assert.equal(unknownBuilder.code, 2);
  assert.match(unknownBuilder.err, /^usage: /);
  // `orchestrator` is no longer a seat: the vocabulary is the board's six.
  const retiredSeat = runCli(['fallback', '--seat', 'orchestrator']);
  assert.equal(retiredSeat.code, 2);
  assert.match(retiredSeat.err, /^usage: /);
});
