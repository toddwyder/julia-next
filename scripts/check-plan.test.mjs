import assert from "node:assert/strict";
import test from "node:test";

import { checkPlan } from "./check-plan.mjs";

const valid = `# Test plan

Intro.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. Check a box only when its evidence exists. The body is a how-to. The program runs \`playbooks/autopilot-full.md\`.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

The verification shape is in \`docs/pstack-deviations.md\`. Run \`node scripts/check-plan.mjs docs/agents/mechanical-layer/plan.md\`.

## Program checklist

### Arm the program

- [ ] Read the playbook.

### Spawn owners

- [ ] Spawn an owner.

### PR mechanics, for every PR

- [ ] Run \`npm run guard:flow\` and \`node scripts/machine-programs.mjs --check\`.

### Verdict and merge, for every PR

- [ ] One audit lane on \`gpt-6-luna\`, and a second only for a named risk.

### Boot recipe, for every live lane

- [ ] Boot Studio.

## Do the thing (P1)

**Depends on.** None.

**Files.**

- [ ] Edit \`a.mjs\`.

**Build.**

- [ ] Build it.

**You see.**

- [ ] It works.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run \`node --test\`.

**Verify, live.** One independent live checker at the PR head, in a fresh session, never the author. It runs the scenarios.

- [ ] Scenario 1. Regression against trunk. It fails on trunk. Save \`regression.png\`. Pass when head passes.
- [ ] Scenario 2. A broken case. Save \`case.png\`. Pass when it passes.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. A number.
- [ ] Probe. Measure it.
- [ ] Baseline. Record trunk.
- [ ] Rule. Head fails above 10.

**Review gate.** None. P1 is not review-gated.

**Merge.**

- [ ] Merge it.

## Close the program

- [ ] Done.

## Appendix A. Prototype evidence

Probe notes.
`;

const withChange = (from, to) => valid.replace(from, to);

test("accepts the new shape", () => {
  const result = checkPlan(valid);
  assert.deepEqual(result.problems, []);
  assert.equal(result.report.length, 1);
});

test("rejects a live block without the independent checker", () => {
  const result = checkPlan(withChange("One independent live checker at the PR head, in a fresh session, never the author.", "One lane."));
  assert.ok(result.problems.some((problem) => problem.includes("Verify, live lacks")));
});

test("rejects a live block without a regression scenario", () => {
  const result = checkPlan(withChange("Regression against trunk.", "A normal case."));
  assert.ok(result.problems.some((problem) => problem.includes("regression scenario")));
});

test("rejects a scenario without a pass condition", () => {
  const result = checkPlan(withChange("Pass when it passes.", "It passes."));
  assert.ok(result.problems.some((problem) => problem.includes("no pass condition")));
});

test("rejects the old ten-lane language", () => {
  const result = checkPlan(withChange("It runs the scenarios.", "It runs the scenarios. Ten lanes."));
  assert.ok(result.problems.some((problem) => problem.includes("ten-lane shape")));
});

test("requires one audit lane on Luna", () => {
  const result = checkPlan(withChange("One audit lane on `gpt-6-luna`", "Two audit lanes"));
  assert.ok(result.problems.some((problem) => problem.includes("one audit lane on gpt-6-luna")));
});

test("requires the plain command checks in PR mechanics", () => {
  const result = checkPlan(withChange("- [ ] Run `npm run guard:flow` and `node scripts/machine-programs.mjs --check`.", "- [ ] Run the checks."));
  assert.ok(result.problems.some((problem) => problem.includes("guard check")));
  assert.ok(result.problems.some((problem) => problem.includes("programs check")));
});

test("requires the deviations and repo check markers", () => {
  const result = checkPlan(withChange("The verification shape is in `docs/pstack-deviations.md`. Run `node scripts/check-plan.mjs docs/agents/mechanical-layer/plan.md`.", "The shape is documented."));
  assert.ok(result.problems.some((problem) => problem.includes("docs/pstack-deviations.md")));
  assert.ok(result.problems.some((problem) => problem.includes("node scripts/check-plan.mjs")));
});
