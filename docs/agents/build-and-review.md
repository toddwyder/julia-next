# Build and review workflow

How a coordinator builds or repairs a card by hand (outside the graph). Every build follows the
repo's own skills; a dispatch brief, worker restriction or graph brief that conflicts with them is
written wrong and is corrected before dispatch.

## Building

Follow `.agents/skills/tdd/SKILL.md`.

1. Agree the seams with Todd before any test is written.
2. Take one vertical slice at a time:
   1. Write one behaviour test at an agreed seam.
   2. Run it alone and show it fails because the behaviour is missing. A setup error, a broken
      fake or an unrelated failure is not a red step.
   3. Write the minimal code.
   4. Run the test and the full suite, and show them pass.
   5. Guard check (the builder skill's mutation check): revert the slice's code in a copy and
      show the test fails again.
3. Only then start the next slice.

**A worker that cannot run commands** (headless Gemini, for one) gets the builder skill's
split-step briefs: one brief asks for the test, the next for the minimal code. Here the
coordinator does the controller's part: it commits each edit, and runs every red, green and guard
step between them.

## Reviewing

After every slice is green, follow `.agents/skills/code-review/SKILL.md`. Run its Standards and
Spec sub-agents separately and keep both reports verbatim, without merging or reranking them.
They come in addition to any adversarial reviewer Todd asks for, not instead of one. As in the
builder skill, that reviewer is from a different model maker than the builder.

## Evidence

Record these on the card:
- the skill paths used;
- each red and green result, with its command, output and commit;
- each guard check;
- both code-review reports.

Tick checkboxes as CLAUDE.md says ("Tick as you go"). A card moves to UAT only after every check
and review passes.
