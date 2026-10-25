# JUL-252 todo

## 23 October triage (historical)

- [x] Read the settled decisions and current cards through Pocock triage.
- [x] Create Review in Backlog with JUL-231 first.
- [x] Cancel JUL-233 with the supplied one-line comment.
- [x] Reply under JUL-249's closing comment with the new card link.
- [x] Correct the single AGENTS.md path and inspect the exact diff.
- [x] Publish with gh, wait for exact-head CI, merge and verify main.

## 25 October build failure (Bug fix playbook)

1. Reproduce it yourself on the matching surface via the control skill (Non-negotiables), even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
2. Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with `how` over the affected subsystem and the **why** skill for regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Drive a long or stubborn hunt with Cursor's `/loop` command. Confirm the surviving *mechanism* with runtime evidence before the step-3 architect/interrogate fan-out.
3. Plan the fix. If it crosses a function boundary, `architect` first. Delegate implementation to a subagent using your configured bug-fix model (default `grok-4.7-xhigh-fast`) with a specific scope.
4. Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
5. Stage the commits so the failing repro lands before the fix in git history. See the **tdd** skill for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear. This is the canonical **sequence-verifiable-units** principle skill, the failing test first and the fix on top.
6. Run **Opening a PR**.

Task-specific items:

7. [x] Red test: a request whose worst-case reservation exceeds the old cap dispatches when actual spend is under the cap.
8. [x] Red test: the card stops only after a settled request makes actual spend exceed the cap.
9. [x] Red test: actual cost above the recorded maximum settles and continues while under the cap.
10. [x] Implement Todd's 25 Oct decision: actual usage at API prices gates the card, drop the worst-case reservation gate, raise the cap to $10.
11. [x] Retire the diagnosing-bugs skill and update the current routers to poteto-mode's Bug fix playbook.
12. [x] Run the full runner suite, no-fakes, lint and link checks.
13. [x] Merge, deploy, restart JUL-252 through the Start page with Claude Opus 5.5 and DeepSeek V4.1 Flash. The run was interrupted by the external #339 deploy, not a money stop.
14. [x] Capture the dashboard screenshot with the checklist ticking and the spend broken down by model and task kind.

## 25 October updater defer and JUL-252 no-stop (Bug fix playbook)

The red live evidence is the #339 deploy at `12:20:06Z`: the old updater restarted the runner while worker `1035904` was building and killed it. The new behavior must defer a mid-build merge until the worker ends.

15. [x] Red test: a merge while a build worker is running does not advance or restart services, and applies after the worker ends.
16. [x] Red test: a `cardCeilings` override of `null` removes the money stop for one card.
17. [x] Implement the updater defer and the per-card ceiling override.
18. [x] Install the updater, start JUL-252 with Claude Opus 5.5 and DeepSeek V4.1 Flash, and prove a mid-build merge is deferred. #343 merged at 13:58; the 13:58 and 14:00 polls deferred, and the merge applied at 14:02 after the build.
19. [ ] Wait for JUL-252 to complete without a money stop. The run passed $10 with no money stop, then hit the worker's 900-second build-session timeout at 14:00:44 during the panel review and failed with `session not completed`. The time bound is the remaining blocker.
20. [x] Report the final spend by model and checklist step. This run $4.502079354; card total $11.165119684; the split is in `proof/rerun-2-2026-10-25/report.md`.

Decision log: [decision-log.md](decision-log.md)
