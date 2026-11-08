import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commandsFromSpans,
  describeReturn,
  criteriaFromCard,
  determinationComment,
  judgedCriteria,
  parseVerdict,
  playbookSteps,
} from './determination.mjs';
import { tokensPerTurn } from './trace-record.mjs';

const CARD = `One letter, so a machine can tell whether the check ran.

## Criteria

- [ ] One command proves the letter is there: \`grep -qx 'the letter is Q' machine/proof/letter.txt\` prints the line it matched and exits 0

## UAT

1. Open the pull request and read the comment.
`;

const ANSWER = `VERDICT: PASS

CRITERION 1: PASS — grep printed the line it matched and exited 0
NOTES: the letter is the only line in the file.`;

test('criteria come from the card, and only from its criteria section', () => {
  assert.deepEqual(criteriaFromCard(CARD), [
    "One command proves the letter is there: `grep -qx 'the letter is Q' machine/proof/letter.txt` prints the line it matched and exits 0",
  ]);
  assert.deepEqual(criteriaFromCard('No headings here\n\n- a bullet'), []);
});

test('the verdict is read per criterion, with the reason beside it', () => {
  const verdict = parseVerdict(ANSWER);
  assert.equal(verdict.verdict, 'PASS');
  assert.deepEqual(verdict.criteria, [
    { number: 1, verdict: 'PASS', reason: 'grep printed the line it matched and exited 0' },
  ]);
  assert.equal(verdict.notes, 'the letter is the only line in the file.');
});

test('a failed answer is read as a failure, not smoothed over', () => {
  const verdict = parseVerdict('VERDICT: FAIL\n\nCRITERION 1: FAIL — grep exited 1');
  assert.equal(verdict.verdict, 'FAIL');
  assert.equal(verdict.criteria[0].verdict, 'FAIL');
});

test('only the Shipping agent own commands are listed, with what they returned', () => {
  const spans = [
    { spanType: 'workflow_run', eventType: 'start', runId: 'wf-1', name: "workflow run: 'shipping'" },
    { spanType: 'agent_run', eventType: 'start', runId: 'agent-1', name: "agent run: 'subagent-execute'" },
    {
      spanType: 'tool_call',
      eventType: 'end',
      runId: 'agent-1',
      name: "tool: 'execute_command'",
      input: JSON.stringify({ command: 'cat note.txt', description: 'Read the note' }),
      output: JSON.stringify('the letter is Q\n'),
    },
    {
      spanType: 'tool_call',
      eventType: 'end',
      runId: 'agent-1',
      name: "tool: 'execute_command'",
      input: JSON.stringify({ command: 'grep -qx missing file' }),
      output: JSON.stringify({ error: true, message: 'Tool input validation failed for execute_command.' }),
    },
    {
      spanType: 'tool_call',
      eventType: 'end',
      runId: 'agent-1',
      name: "tool: 'execute_command'",
      input: JSON.stringify({ command: 'git log -1', description: 'Look at the commit' }),
      output: null,
    },
    {
      spanType: 'tool_call',
      eventType: 'end',
      runId: 'agent-1',
      name: "tool: 'view'",
      input: JSON.stringify({ path: 'note.txt' }),
      output: JSON.stringify('ok'),
    },
    {
      spanType: 'tool_call',
      eventType: 'end',
      runId: 'builder',
      name: "tool: 'execute_command'",
      input: JSON.stringify({ command: 'npm test' }),
      output: JSON.stringify('not this run'),
    },
  ];
  const { commands, otherTools } = commandsFromSpans(spans);
  assert.equal(commands.length, 3);
  assert.equal(commands[0].command, 'cat note.txt');
  assert.equal(commands[0].returned, 'the letter is Q');
  assert.equal(commands[1].refused, true);
  assert.match(commands[1].returned, /refused before it ran, the tool said: Tool input validation failed/);
  assert.equal(commands[2].returned, null);
  assert.deepEqual(otherTools, [{ name: 'view', count: 1 }]);
});

test('the determination leads with the verdict and shows command and return side by side', () => {
  const comment = determinationComment({
    pr: 401,
    sha: 'dc62b45',
    card: { identifier: 'JUL-305' },
    model: 'commandcode/reflection/beam:free',
    playbook: '.agents/skills/poteto-mode/playbooks/shipping.md',
    workflowRunId: '79fcbd91-9ea3-4779-9515-c0d0bf2f26e3',
    workflowId: 'shipping',
    traceFile: '/tmp/trace.duckdb',
    criteria: criteriaFromCard(CARD),
    verdict: parseVerdict(ANSWER),
    commands: [{ command: "grep -qx 'the letter is Q' machine/proof/letter.txt", returned: 'the letter is Q', refused: false }],
    otherTools: [],
    steps: [],
  });
  assert.ok(comment.startsWith('Shipping agent: PASS\n'), comment.slice(0, 40));
  assert.match(comment, /commandcode\/reflection\/beam:free/);
  assert.match(comment, /playbooks\/shipping\.md/);
  assert.match(comment, /79fcbd91-9ea3-4779-9515-c0d0bf2f26e3/);
  assert.match(comment, /\*\*1\. PASS\*\* — grep printed the line it matched and exited 0/);
  assert.match(comment, /\| 1 \| `grep -qx 'the letter is Q' machine\/proof\/letter\.txt` \| the letter is Q \|/);
});

test('a command the record kept without its result says so and falls back to the playbook steps', () => {
  const playbook = `# Shipping

1. **Resolve the forge and verify each PR** — one verifier per PR.
2. **Land only a contiguous verified run** — bottom up.
3. **Re-check the verdict** with patch-id when heads move.
`;
  const comment = determinationComment({
    pr: 401,
    sha: 'dc62b45',
    card: { identifier: 'JUL-305' },
    model: 'commandcode/reflection/beam:free',
    playbook: '.agents/skills/poteto-mode/playbooks/shipping.md',
    workflowRunId: 'run-1',
    workflowId: 'shipping',
    traceFile: '/tmp/trace.duckdb',
    criteria: criteriaFromCard(CARD),
    verdict: parseVerdict(ANSWER),
    commands: [{ command: 'git log -1', returned: null, refused: false }],
    otherTools: [],
    steps: playbookSteps(playbook),
  });
  assert.match(comment, /the record kept the command but not what it returned/);
  assert.match(comment, /### What the record did not keep/);
  assert.match(comment, /1\. Resolve the forge and verify each PR/);
  assert.match(comment, /3\. Re-check the verdict/);
});

test('no verdict is written down as no verdict, never as a pass', () => {
  const comment = determinationComment({
    pr: 401,
    sha: 'dc62b45',
    card: { identifier: 'JUL-305' },
    model: 'commandcode/reflection/beam:free',
    playbook: '.agents/skills/poteto-mode/playbooks/shipping.md',
    workflowRunId: 'run-1',
    workflowId: 'shipping',
    traceFile: '/tmp/trace.duckdb',
    criteria: criteriaFromCard(CARD),
    verdict: null,
    commands: [],
    otherTools: [],
    steps: [],
    failed: 'the workflow ended failed: model unavailable',
  });
  assert.ok(comment.startsWith('Shipping agent: NO VERDICT\n'));
  assert.match(comment, /The machine could not get a verdict: the workflow ended failed/);
  assert.match(comment, /\*\*1\. no verdict\*\*/);
});

test('a return written for a terminal is quoted without its colour codes', () => {
  const output = JSON.stringify('\u001b[32m7 tests\u001b[39m\n\u001b[32m0 failing\u001b[39m\n');
  assert.deepEqual(describeReturn(output), { text: '7 tests\n0 failing', refused: false });
});

test('criteria come from a card acceptance criteria heading, and stop at the next heading', () => {
  const card = `The Shipping agent leaves one comment on the pull request.

## Outcome

The Shipping agent leaves one comment on the pull request.

## Acceptance criteria

- [ ] The comment lists each criterion beside its verdict.
- [ ] The comment names the model that ran the review.

## UAT steps

- [ ] Open the pull request and read the comment.
- [ ] Check the model name against the run.
`;
  assert.deepEqual(criteriaFromCard(card), [
    'The comment lists each criterion beside its verdict.',
    'The comment names the model that ran the review.',
  ]);
});

test('the older criteria heading still reads its bullets', () => {
  const card = `One letter, so a machine can tell whether the check ran.

## Criteria

- [ ] The comment lists each verdict.

## UAT

- [ ] Open the pull request and read the comment.
`;
  assert.deepEqual(criteriaFromCard(card), ['The comment lists each verdict.']);
});

test('a stopped review says which criteria it judged, so the next one covers only the rest', () => {
  const stopped = parseVerdict('CRITERION 1: PASS — the command printed the line\nCRITERION 3: FAIL — it exited 1');
  assert.deepEqual(judgedCriteria(stopped.raw), [1, 3]);
  assert.deepEqual(judgedCriteria('nothing judged yet'), []);
});

test('a stopped review posts its verdicts, its reason and its tokens', () => {
  const comment = determinationComment({
    pr: 401,
    sha: 'dc62b45',
    card: { identifier: 'JUL-305' },
    model: 'commandcode/reflection/beam:free',
    playbook: '.agents/skills/poteto-mode/playbooks/shipping.md',
    workflowRunId: 'run-1',
    workflowId: 'shipping',
    traceFile: '/tmp/trace.duckdb',
    criteria: criteriaFromCard(CARD),
    verdict: parseVerdict('CRITERION 1: PASS — the command printed the line'),
    commands: [],
    otherTools: [],
    steps: [],
    stop: { kind: 'stuck', detail: 'no activity for 7 minutes' },
  });
  assert.ok(comment.startsWith('Shipping agent: NO VERDICT\n'), comment.slice(0, 40));
  assert.match(comment, /\*\*Stopped as stuck\.\*\* No activity for 7 minutes\./);
  assert.match(comment, /It judged criterion 1 before it stopped, and the next review covers only the rest\./);
  assert.match(comment, /\*\*1\. PASS\*\* — the command printed the line/);
});

test('a stop at the ceiling names the tokens it used', () => {
  const comment = determinationComment({
    pr: 401,
    sha: 'dc62b45',
    card: { identifier: 'JUL-305' },
    model: 'commandcode/reflection/beam:free',
    playbook: '.agents/skills/poteto-mode/playbooks/shipping.md',
    workflowRunId: 'run-1',
    workflowId: 'shipping',
    traceFile: '/tmp/trace.duckdb',
    criteria: criteriaFromCard(CARD),
    verdict: null,
    stop: { kind: 'ceiling', detail: '10,000,000 input tokens, at the 10,000,000 ceiling', tokensUsed: 10_000_000, ceiling: 10_000_000 },
  });
  assert.match(comment, /\*\*Stopped as ceiling\.\*\*/);
  assert.match(comment, /Tokens used: `10,000,000` of `10,000,000`\./);
  assert.match(comment, /It judged no criterion before it stopped, so the next review covers all of them\./);
});

test('each model turn is written down with what it sent', () => {
  const attribute = usage => JSON.stringify({ stepIndex: usage.step, model: 'moonshotai/Kimi-K3.1-Pro', usage });
  const spans = [
    { spanType: 'model_inference', eventType: 'end', attributes: attribute({ step: 0, inputTokens: 16_299, outputTokens: 253 }) },
    { spanType: 'model_inference', eventType: 'end', attributes: attribute({ step: 1, inputTokens: 83_000, outputTokens: 466 }) },
    { spanType: 'model_inference', eventType: 'start', attributes: '{}' },
    { spanType: 'tool_call', eventType: 'end', attributes: attribute({ step: 2, inputTokens: 1, outputTokens: 1 }) },
  ];
  assert.deepEqual(tokensPerTurn(spans), [
    { step: 0, model: 'moonshotai/Kimi-K3.1-Pro', inputTokens: 16_299, outputTokens: 253 },
    { step: 1, model: 'moonshotai/Kimi-K3.1-Pro', inputTokens: 83_000, outputTokens: 466 },
  ]);
});

test('the per-turn table flags a turn at or above the 83,000 of the review this card came from', () => {
  const comment = determinationComment({
    pr: 401,
    sha: 'dc62b45',
    card: { identifier: 'JUL-305' },
    model: 'commandcode/reflection/beam:free',
    playbook: '.agents/skills/poteto-mode/playbooks/shipping.md',
    workflowRunId: 'run-1',
    workflowId: 'shipping',
    traceFile: '/tmp/trace.duckdb',
    criteria: criteriaFromCard(CARD),
    verdict: null,
    turnTokens: [
      { step: 0, inputTokens: 16_299, outputTokens: 253 },
      { step: 1, inputTokens: 90_000, outputTokens: 466 },
    ],
  });
  assert.match(comment, /### What each model turn sent/);
  assert.match(comment, /2 turns, 90,000 input tokens at the highest, which is at or above the 83,000 a turn/);
  assert.match(comment, /\| 0 \| 16,299 \| 253 \|/);
});
