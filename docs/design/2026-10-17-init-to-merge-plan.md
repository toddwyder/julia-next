# Simplest working machine: Init to merge

Date: 2026-10-17. Status: publication complete; cards await confirmation. Implementation is stopped.
“Approved” referred to the draft, not coding. This plan authorizes no dispatch, tracker write or merge.

## Outcome

One authorized machine card goes through Init, Build, independent Review, independent Pstack
Proof, real PR, passing CI and authorized exact-candidate merge, with Todd able to follow the work.

## Todd's decisions

- **Progress first:** S04 is first so Todd can see actual coder runs for every later slice.
- **JUL-226 starts at zero:** Todd excludes the three unauthorized-start sessions. Keep the
  historical receipts and actual usage/costs; this exclusion does not change future session policy.
- **Judgment is selected at Init:** use the existing model-selection mechanism, like other roles.
  Claude is outside the machine; its quota is reserved for advising Todd.
- Three authorized coder sessions per card; every later start/continuation counts. Handoff is at
  50% of the measured usable context window using Pocock's handoff. Carry accepted limits forward.
- Keep raw tool output on disk; bound saved history and subsequent requests, including batches/errors.
  Deterministic waits and progress updates belong to the runner, not a watching model.
- Runner sends the complete review contract and candidate/evidence directly to Codex and saves its
  result. Preserve unfinished JUL-238 plugin work without making it a prerequisite or claiming it done.
- Every slice includes independent review followed by **its own Pstack Proof**. Final journey
  Proof is additional. Keep one durable Mastra workflow; defer OM, Graphify and Jev integration.

## Execution order

IDs remain stable; S04 moves ahead of S01 rather than renumbering the work. All slices are pending
implementation authorization and have no accepted independent Review/Proof under this plan.

| Order | Slice and outcome | Owner / detailed brief | Prerequisite |
| --- | --- | --- | --- |
| 1 | S04: concrete steps, elapsed time, additions and actual coder runs | [JUL-239](https://linear.app/julia-next/issue/JUL-239/show-actual-work-steps-and-changes-to-the-plan) | Existing persisted run state/page; not S03 |
| 2 | S01: TS tests and typecheck run in the Windows CI gate | [JUL-240](https://linear.app/julia-next/issue/JUL-240/run-reviewer-typescript-tests-and-typecheck-in-the-existing-windows) | S04 |
| 3 | S02: oversized results stay out of saved/replayed history | [JUL-241](https://linear.app/julia-next/issue/JUL-241/prevent-large-tool-results-from-accumulating-in-the-api-builders) | S01 |
| 4 | S03: mechanical admission, limits and 50% handoff | [JUL-226](https://linear.app/julia-next/issue/JUL-226/produce-an-immutable-reviewed-candidate-through-stock-mastra) | S02; consumes S04 events |
| 5 | S05: one saved direct-Codex review of the pinned candidate | [JUL-228](https://linear.app/julia-next/issue/JUL-228/add-the-codex-route) | S01-S04 |
| 6 | S06: real Init through gated Build, Review, remediation and Proof | [JUL-226](https://linear.app/julia-next/issue/JUL-226/produce-an-immutable-reviewed-candidate-through-stock-mastra) | S05 |
| 7 | S07: qualified release through PR, CI and exact-candidate merge | [JUL-227](https://linear.app/julia-next/issue/JUL-227/release-the-exact-candidate-through-preview-uat-merge-and-production) | S06 |
| 8 | S08: one real card completes the entire qualified journey | [JUL-227](https://linear.app/julia-next/issue/JUL-227/release-the-exact-candidate-through-preview-uat-merge-and-production) | Qualified S01-S07 |

S04 extends existing run persistence and lifecycle reporting, independent of admission policy.
S03 subsequently adds counting, limits and handoff to those events. S04's own build is the bootstrap;
its real coder-run visibility must pass Proof before S01 starts. Do not wait for S06 to show runs.

## How the documents work

The plan is the readable route and status, not another requirements manual. The briefs retain
the dated approved publication source; the published Linear cards own requirements, acceptance and status.
Keep the briefs as dated triage history after transfer, not a second live copy. Existing project
policies own generic TDD/review/Proof mechanics and accepted budgets. Agent-written proposals are
not Todd's decisions. Record later agreed changes where they belong and update these pointers.

Every slice finishes Build → independent Review → independent Proof before a dependent slice
consumes it. Use the maintained verification map; source changes invalidate affected evidence.
S04 runs TS tests/typecheck directly until S01 wires them into CI. Complete Windows qualification
must pass before the adapted runner is used for delivery. Julia preview/household UAT and the
broader unfinished criteria on JUL-226/227 remain outside this first machine demonstration.

## Next process step

Publication is complete: C/A/B are in Triage; JUL-226/228/227 remain in Backlog. D was not created.
Next, complete pre-plan qualification and Confirm on the published cards. Ready status and any
implementation/model/spend authorization remain separate; publication authorizes no coder launch.
Prefer an eligible existing subject for S08; [brief D](2026-10-17-init-to-merge-triage.md#brief-d--conditional-final-delivery-subject)
is returned for triage approval only if a new non-product subject is needed.

## Runtime dependency matrix

No server, SSH or sudo step. Slice Proof uses the real interfaces; regression fixtures do not
substitute for real seam evidence. Actual selected identities are recorded at authorized Init.

| Interface / principal | Store or API / access | Regression fixture | Real Proof owner |
| --- | --- | --- | --- |
| Restricted Julia identity via Windows vault helper | Linear / approved reads and authorized status writes | Saved-card validation | S06 |
| Laptop workflow process | Existing local libSQL/run evidence / read-write | Temporary-store restart/concurrency | S04, S03, S06 |
| Init-selected Builder | Isolated worktree/tool artifacts / write | Oversized success/error/batch | S02 |
| Saved Codex Reviewer and Init-selected judgment role | Existing selected runtimes / bounded jobs | Invalid result/identity/limit | S05, S06 |
| Independent verifier | Real mapped features/evidence / drive and owned cleanup | Doctor/map validation | Every slice |
| Ordinary signed-in GitHub identity | Branch/PR/check/merge operations / authorized writes and readback | Stale identity/duplicate effect | S01, S07, S08 |

## Evidence and implementation references

[Slice briefs and framework references](2026-10-17-init-to-merge-triage.md) retain the technical
detail and unauthorized-start evidence. [Interview notes](2026-10-17-init-to-merge-notes.md) are
historical discussion. Root-cause reports are in `C:/Dev/jul233-supervision/`; preserved integration
is `ce3897ca`, unfinished JUL-238 is `e4c9a132`. Preserve all existing dirty work and evidence.
