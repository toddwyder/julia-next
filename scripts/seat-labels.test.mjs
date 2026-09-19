// seat-labels.test.mjs -- JUL-79 step 5. Pure: no I/O, no network. Pins the
// label-group and label-name vocabulary, the catalogue -> seat-table mapping,
// and the resolution/family rules the Ready queue and the coordinator both
// depend on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { SEAT_TABLE, FAMILY_OF } from '../graph/seat-table.mjs';
import {
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

const AGENTS = ['orchestrator', 'builder', 'reviewer'];

test('the six label groups are exactly the ticket\'s, in the ticket\'s order and spelling', () => {
  assert.deepEqual(LABEL_GROUPS, [
    'Orchestrator model',
    'Builder model',
    'Reviewer model',
    'Orchestrator effort',
    'Builder effort',
    'Reviewer effort',
  ]);
  assert.deepEqual(Object.values(MODEL_LABEL_GROUP), ['Orchestrator model', 'Builder model', 'Reviewer model']);
  assert.deepEqual(Object.values(EFFORT_LABEL_GROUP), ['Orchestrator effort', 'Builder effort', 'Reviewer effort']);
});

test('the label-name convention produces the exact names the ticket gives', () => {
  assert.equal(MODEL_LABELS.ORCH_CLAUDE_OPUS, 'orch-claude-opus');
  assert.equal(MODEL_LABELS.BUILDER_DEEPSEEK_FLASH, 'builder-deepseek-flash');
  assert.equal(MODEL_LABELS.REVIEWER_GLM_5_3, 'reviewer-glm-5.3');
  assert.equal(MODEL_LABELS.REVIEWER_CODEX, 'reviewer-codex');
  assert.equal(EFFORT_LABELS.REVIEWER_EFFORT_MEDIUM, 'reviewer-effort-medium');
  assert.equal(EFFORT_LABELS.ORCH_EFFORT_LOW, 'orch-effort-low');

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
    if (label.includes('glm-')) assert.equal(spec.entry, 'pi-glm', label);
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
  const choices = resolveSeatChoices(['orch-codex', 'builder-glm-5.3', 'reviewer-claude-haiku']);
  assert.equal(choices.orchestrator.entry, 'codex');
  assert.equal(choices.orchestrator.modelLabel, 'orch-codex');
  assert.equal(choices.builder.entry, 'pi-glm');
  assert.equal(choices.builder.modelLabel, 'builder-glm-5.3');
  assert.equal(choices.reviewer.entry, 'claude');
  assert.equal(choices.reviewer.modelLabel, 'reviewer-claude-haiku');
});

test('a present effort label wins; absent is Medium', () => {
  const choices = resolveSeatChoices(['orch-effort-high', 'builder-effort-low']);
  assert.equal(choices.orchestrator.effort, 'high');
  assert.equal(choices.builder.effort, 'low');
  assert.equal(choices.reviewer.effort, 'medium');
});

test('unknown and malformed labels are ignored, never a crash', () => {
  const choices = resolveSeatChoices([42, null, undefined, {}, 'not-a-real-label', 'reviewer-effort-turbo', { name: 'builder-effort-high' }]);
  assert.equal(choices.builder.effort, 'high');
  assert.equal(choices.reviewer.effort, 'medium');
  assert.equal(choices.orchestrator.entry, SEAT_TABLE.orchestrator.primary);
  assert.deepEqual(resolveSeatChoices(undefined), resolveSeatChoices([]));
});

test('labelNames reads plain arrays, getIssue connections, and objects, dropping junk', () => {
  assert.deepEqual(labelNames(['a', { name: 'b' }, null, 3]), ['a', 'b']);
  assert.deepEqual(labelNames({ nodes: [{ name: 'orch-codex' }] }), ['orch-codex']);
  assert.deepEqual(labelNames(undefined), []);
});

test('the family rule accepts the default table and an explicitly differing pair', () => {
  assert.deepEqual(validateFamilyChoice(resolveSeatChoices([])), { ok: true });
  assert.deepEqual(
    validateFamilyChoice(resolveSeatChoices(['builder-claude-opus', 'reviewer-codex'])),
    { ok: true },
  );
  assert.deepEqual(
    validateFamilyChoice(resolveSeatChoices(['builder-deepseek-flash', 'reviewer-glm-5.3'])),
    { ok: true },
  );
});

test('the family rule rejects a same-family builder/reviewer pair, in one sentence naming both models', () => {
  const result = validateFamilyChoice(resolveSeatChoices(['builder-claude-opus', 'reviewer-claude-sonnet']));
  assert.equal(result.ok, false);
  assert.match(result.reason, /builder-claude-opus/);
  assert.match(result.reason, /reviewer-claude-sonnet/);
  assert.match(result.reason, /different families/);
});

test('a seat fallback that keeps builder and reviewer in different families is allowed', () => {
  const choices = resolveSeatChoices([]); // builder claude, reviewer codex
  const result = fallbackSeatChoice(choices, 'builder');
  assert.equal(result.ok, true);
  assert.equal(result.choices.builder.entry, 'pi-deepseek');
  assert.equal(result.choices.builder.modelLabel, 'builder-deepseek-flash');
  assert.equal(result.choices.reviewer.entry, 'codex');
});

test('a fallback whose backup collides with the other seat is refused, not silently used', () => {
  const choices = resolveSeatChoices([]); // builder claude, reviewer codex
  // The reviewer's natural backup is claude -- the builder's family. The
  // fallback must be refused, not produce a same-family pair.
  const result = fallbackSeatChoice(choices, 'reviewer');
  assert.equal(result.ok, false);
  assert.match(result.reason, /refusing the reviewer backup/);
  assert.match(result.reason, /different families/);
});

test('GLM is still a selectable seat-label model even though it is no seat default or backup', () => {
  const choices = resolveSeatChoices(['builder-glm-5.3']);
  assert.equal(choices.builder.entry, 'pi-glm');
  assert.equal(choices.builder.modelLabel, 'builder-glm-5.3');
});

test('the family rule rejects an unknown seat-table entry', () => {
  const result = validateFamilyChoice({
    orchestrator: { entry: 'claude' },
    builder: { entry: 'gemini' },
    reviewer: { entry: 'codex' },
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /builder/);
  assert.match(result.reason, /unknown seat-table entry/);
});

test('missingSeatLabels returns exactly the default model and effort labels not already present', () => {
  assert.deepEqual(missingSeatLabels([]), [
    'orch-claude-opus',
    'orch-effort-medium',
    'builder-claude-opus',
    'builder-effort-medium',
    'reviewer-codex',
    'reviewer-effort-medium',
  ]);
  assert.deepEqual(missingSeatLabels(['builder-claude-opus', 'builder-effort-high']), [
    'orch-claude-opus',
    'orch-effort-medium',
    'reviewer-codex',
    'reviewer-effort-medium',
  ]);
  assert.deepEqual(
    missingSeatLabels(['orch-codex', 'builder-glm-5.3', 'reviewer-claude-haiku', 'orch-effort-low', 'builder-effort-high', 'reviewer-effort-medium']),
    [],
  );
});

test('seatChoicesForIssue resolves the exact shape linear-cli getIssue returns', () => {
  const issue = {
    id: 'uuid-1',
    identifier: 'JUL-79',
    labels: { nodes: [{ name: 'builder-claude-opus' }, { name: 'reviewer-codex' }, { name: 'orch-effort-high' }] },
  };
  const choices = seatChoicesForIssue(issue);
  assert.equal(choices.builder.entry, 'claude');
  assert.equal(choices.reviewer.entry, 'codex');
  assert.equal(choices.orchestrator.effort, 'high');
  assert.equal(choices.orchestrator.entry, SEAT_TABLE.orchestrator.primary);
});

// --- JUL-79 step 8 follow-up: the guard must be callable and tested by the
// exact real combination the table puts on a card. ---

test('the specific unsafe combination -- builder primary claude plus reviewer backup claude -- is refused by the guard', () => {
  // Not a synthetic pair: this is literally SEAT_TABLE.builder.primary
  // ('claude') against SEAT_TABLE.reviewer.backup ('claude'), the collision
  // the family rule exists to prevent. Pin both the direct validation and the
  // fallback path that a capped reviewer takes.
  assert.equal(SEAT_TABLE.builder.primary, 'claude');
  assert.equal(SEAT_TABLE.reviewer.backup, 'claude');
  const unsafePair = {
    orchestrator: { entry: SEAT_TABLE.orchestrator.primary },
    builder: { entry: SEAT_TABLE.builder.primary },
    reviewer: { entry: SEAT_TABLE.reviewer.backup },
  };
  const validated = validateFamilyChoice(unsafePair);
  assert.equal(validated.ok, false);
  assert.match(validated.reason, /anthropic/);
  const fallback = fallbackSeatChoice(resolveSeatChoices([]), 'reviewer');
  assert.equal(fallback.ok, false);
  assert.match(fallback.reason, /refusing the reviewer backup \(claude\)/);
});

test('the fallback CLI refuses reviewer -> claude while the builder is on claude, and exits non-zero', () => {
  const { out, err, code } = runCli(['fallback', '--seat', 'reviewer', '--builder', 'claude']);
  assert.notEqual(code, 0);
  assert.equal(out, '');
  assert.match(err, /refusing the reviewer backup \(claude\)/);
  assert.match(err, /different families/);
  assert.equal(err.trim().split('\n').length, 1);
});

test('the fallback CLI allows reviewer -> claude when the builder is on pi-deepseek, printing the entry to use', () => {
  const { out, err, code } = runCli(['fallback', '--seat', 'reviewer', '--builder', 'pi-deepseek']);
  assert.equal(code, 0);
  assert.equal(err, '');
  assert.deepEqual(JSON.parse(out), { seat: 'reviewer', entry: 'claude', modelLabel: 'reviewer-claude-opus' });
  assert.match(out, /\n {2}"seat"/);
});

test('the fallback CLI is a real entry point: the process itself refuses the builder-primary reviewer-backup pair, non-zero', async () => {
  await assert.rejects(
    () => execFileAsync(process.execPath, [SEAT_LABELS_CLI, 'fallback', '--seat', 'reviewer', '--builder', 'claude']),
    (error) => {
      assert.notEqual(error.code, 0);
      assert.match(error.stderr, /refusing the reviewer backup \(claude\)/);
      return true;
    },
  );
});

test('the fallback CLI is a real entry point: the process itself allows the reviewer fallback off a pi-deepseek builder', async () => {
  const { stdout } = await execFileAsync(process.execPath, [SEAT_LABELS_CLI, 'fallback', '--seat', 'reviewer', '--builder', 'pi-deepseek']);
  assert.deepEqual(JSON.parse(stdout), { seat: 'reviewer', entry: 'claude', modelLabel: 'reviewer-claude-opus' });
});

test('the fallback CLI treats a bad seat or an unknown builder entry as a one-line usage error, not a refusal', () => {
  const badSeat = runCli(['fallback', '--seat', 'potato', '--builder', 'claude']);
  assert.equal(badSeat.code, 2);
  assert.match(badSeat.err, /^usage: /);
  const unknownBuilder = runCli(['fallback', '--seat', 'reviewer', '--builder', 'gemini']);
  assert.equal(unknownBuilder.code, 2);
  assert.match(unknownBuilder.err, /^usage: /);
});
