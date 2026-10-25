# JUL-252 plan: Evidence review

I couldn't open the repo for this plan, so I took the file paths from AGENTS.md and the card. Paths marked *(new)* are proposed names. Paths marked *(confirm)* need checking against the runner code before the build starts.

## Files

1. `docs/agents/JUL-252/todo.md` *(new)*: the poteto-mode todo list.
2. `docs/agents/JUL-252/decision-log.md` *(new)*: the show-me-your-work decision log.
3. `docs/adr/0023-evidence-review.md` *(new)*: records which other company's model is the reviewer, why, and how it fits the $2 card cap.
4. Runner settings file *(confirm, under `ops/build-runner/`)*: the reviewer model's published price, where the price comes from, and limits on request tokens and calls.
5. `ops/build-runner/evidence-review/prompt.md` *(new)*: the reviewer prompt. Every claim starts as unproven, and the reviewer tries to break each one. Each criterion gets one of three verdicts: `proven`, `unproven` or `wrong-thing-tested`.
6. `ops/build-runner/evidence-review/review.mjs` *(new)*: runs the review with no human input. It loads the proof and the acceptance criteria, refuses requests that have no price or no limit, calls the reviewer and parses the verdicts.
7. `ops/build-runner/evidence-review/linear-verdict.mjs` *(new)*: posts a table of verdicts per criterion on the Linear card.
8. Card flow / state machine *(confirm, under `ops/build-runner/`)*: these transitions:
   - Build done → Review
   - Review fails → Remediation (once)
   - Remediation → a new Review
   - Second failure → Investigation → Stopped
9. `ops/build-runner/evidence-review/playbook-guard.mjs` *(new)*: refuses a Remediation run unless its checklist follows poteto-mode's Bug fix playbook. It refuses an Investigation run unless its checklist follows the Investigation playbook.
10. `ops/build-runner/framework/<reviewer-sdk>.learning.test.mjs` *(new)*: a learning test for the reviewer SDK's call and response shape, pinned to the installed version.
11. `ops/build-runner/evidence-review/*.test.mjs` *(new)*: tests for verdict parsing, the budget refusal, the state transitions and the playbook guard.
12. `GLOSSARY.md`: add Evidence review, Remediation and Investigation.

## Steps

1. Create the todo list and decision log under `docs/agents/JUL-252/`, then commit and push.
2. Choose a reviewer from a different company than the builder, using the installed packages and their version-matched docs. Write ADR 0023.
3. Add the reviewer's price, price source and request limits to the runner settings. Add a test that unpriced or unlimited requests are refused before they are sent.
4. Write the SDK learning test under `ops/build-runner/framework/` and get it green.
5. Write the adversarial prompt and `review.mjs`. Test that the output contains exactly one of the three verdicts for every criterion.
6. Write `linear-verdict.mjs` so the verdict table posts to the card. Check it on a test card.
7. Add the Review, Remediation and Investigation states to the card flow. Remediation is limited to one round, and the card stops after Investigation. Test every path.
8. Add `playbook-guard.mjs` and call it before Remediation and Investigation runs are sent. Test that a checklist following a different playbook is refused.
9. Run end to end on one real finished build with no one pressing anything. Record the cost against the $2 cap and save the proof under `docs/agents/JUL-252/`.
10. Update `GLOSSARY.md`. Run `check-skill-names`, `check-agent-links` and the full test suite.
11. Open a PR to `main` with the proof included, using `gh`, and get CI green.
