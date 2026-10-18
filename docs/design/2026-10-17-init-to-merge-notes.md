# Historical interview notes

Latest corrections from Todd, 2026-10-17: the three unauthorized JUL-226 sessions are excluded;
its authorized session count starts at zero. S04 moves first and uses existing run persistence,
without waiting for S03, so later coder runs are visible. S06 uses a judgment model selected and
saved through Init's existing model-selection mechanism. Claude is outside the machine and advises
Todd only. The short plan is the route/status; briefs and approved cards own detailed criteria and
Proof. Older conflicting proposals below are historical, not authority.

Current handoff: [completed plan and slice register](2026-10-17-init-to-merge-plan.md) and
[triage briefs/card changes](2026-10-17-init-to-merge-triage.md). Implementation is stopped.
Todd clarified that design approval did not authorize coding. Every slice requires its own
independent Pstack Proof. Earlier statements below about no dispatch/provider calls describe the
interview at that point; the mistaken later start and its retained accounting are recorded in the
plan. These historical notes are not a dispatch brief.

Latest reviewer decision: the runner automatically sends the review contract/candidate/evidence
to Codex and saves the result, without manual passing or a Claude intermediary. Preserve Claude
quota for advising. The minimum direct-Codex adapter is first-release work; finishing JUL-238's
Claude-to-Codex plugin chain is deferred and that card remains unfinished. Earlier proposals to
finish that chain or use direct Claude as the first-release prerequisite are superseded.

Latest correction from Todd: handoff triggers at 50% context. The corrected high-volume October 17
sessions stayed below the 900K auto-compaction threshold (cited peak about 494K); repeated
auto-compaction is not the token RCA for that run. The consolidated plan now explicitly prevents
large raw tool results from entering persistent history and being replayed on later requests.
Earlier references below to handoff only before auto-compaction are superseded.

These notes retain investigation and intermediate proposals. The consolidated plan in `2026-10-17-init-to-merge-plan.md` and Todd's latest decisions supersede earlier pending or conflicting proposals below. OM and dedicated decision-model integration were deferred until after the first successful machine-card merge.

# Init to merge: working plan

Date: 2026-10-17

Status: Discussion draft from `grill-with-docs`. Recommendations below are not accepted decisions,
implementation authorization, or permission to resume the stopped JUL-233 run. No new tracker issue
is proposed for creation here.

Todd's latest priority, 2026-10-17: take the simplest path to a working machine, then improve it.
Do not let proposed memory or decision-model integrations become an unbounded prerequisite to
the first successful Init-to-merge journey. Earlier trial/role ideas remain recorded below, but
the first-release boundary is being narrowed; deferring a previously discussed integration needs
an explicit scope decision rather than silently dropping it.

Proposed first-release scope: reuse the preserved Build/Review work and stock durable workflow;
finish the unresolved Review boundary; qualify the existing harness; wire the omitted CI checks;
connect the actual Init path through independent review, Proof, PR, CI and exact-candidate merge;
enforce three coder sessions and existing budgets; use Pocock handoff for context recovery; show
phases containing concrete steps with elapsed time and visibly added work on the existing page.
Avoid a new controller, a new dashboard or a general supervisor framework. The decision/judgment
split remains the design, while using existing model connections for the first release and
deferring OM/new decision-model integration is a proposed simplification awaiting Todd.

## Outcome

Todd starts an authorized issue through Init. The machine carries the exact candidate through
implementation, the required independent reviews and remediation, machine Proof, PR, passing CI,
and merge. Todd can see what happened, what is happening, and what will finish the current step.
Julia changes retain their required preview UAT before merge.

Todd's decision, 2026-10-17: the first release proves one machine card from Init through Proof
to merge. Proving Julia delivery is outside this first finish line; its preview/UAT policy remains.

Proof means the existing machine acceptance step, after adversarial review and remediation and
before the PR. Maker checks and harness qualification do not substitute for it.

## Evidence and current state

The source reports are in `C:/Dev/jul233-supervision/`:

| Report | Consequence for this plan |
| --- | --- |
| `retro-20261017.md` | Four child maker implementations did not deliver the parent. Preserve existing repairs and distinguish implementation, maker proof, independent acceptance and delivery. |
| `supervisor-actions-20261017.md` | Model-mediated launch, polling, accounting, readback, cleanup and status work can move to deterministic execution. Diagnosis and review still require judgment. |
| `harness-rca-20261017.md` | Qualify the driver and resource lifecycle before another expensive full drive. Some reported harness defects were product runtime defects. |
| `token-rca-20261017.md` | Repeated large context and broad tool output drove token volume. Approximately 375 million request tokens are not unique new reasoning; most input was cached. |
| `ci-rca-20261017.md` | Windows CI installs reviewer dependencies but omits reviewer TypeScript tests and typecheck. A green existing gate does not establish their execution. |

Preserved integration: `C:/Dev/jul233-integration`, `ce3897ca` (JUL-234–237).
Unintegrated JUL-238: `C:/Dev/jul238-ownership-retry`, `e4c9a132`.
The last JUL-238 delegated job completed, but no durable Review result or observed driver exit
was recorded. Exact requirements delivery and the unsettled completion boundary remain unresolved.
An earlier positive result is stale after source changes.

`C:/Dev/julia-next` is on `main` at `e75bbaae`, with pre-existing dirty documentation, tests and
skill metadata. Those changes and all retained worktrees/evidence must be preserved. Its cached
remote comparison is ahead 35 / behind 2; this planning session has not refreshed remote refs.

There are existing pieces to extend, rather than a need for a new orchestration system:

- `src/delivery-workflow.mjs` and `scripts/julia-mastra-delivery.mjs` provide a durable Mastra
  build/check/review spine, bounded rounds and technical-acceptance suspension. They lack the
  connected Proof/PR/CI/merge tail.
- `src/mastra/initialization.ts` and the newer Build/Review modules provide the saved-run control
  page route. The initialization workflow itself currently ends at Build. The implementation
  must establish one authoritative route through these pieces.
- `src/mastra/cli.ts` accepts connections, models and init; Init accepts Start or Cancel.
  Its Start path calls `src/mastra/workflows/delivery.ts`, which executes all four role selections
  in one step and returns completed. It does not call the richer durable delivery spine above,
  enforce its checks/review gates, or reach merge. The restricted vault launcher targets this
  CLI. Converging the real entry points is a prerequisite; completed here is not delivery.
  Do not invent an already-supported resume/merge command.
- Existing `publish-pr.mjs` and `merge-pr.mjs` use GitHub App publisher credentials. They cannot
  simply be called as the supported delivery route: current instructions require ordinary
  signed-in GitHub access.

Paths beginning `src/` above are under `ops/mastra-agents/reviewer/`.

## Recommended smallest sequence

1. **Make progress and limits mechanical.** Extend the existing run state with a durable worker
   admission count and transition journal. Render a readable current status and retained history
   in the existing control surface. Group concrete work steps under delivery phases. Show
   completed, current and remaining work steps, the elapsed
   time at the current step, and visibly identify steps added during the run with when/why they
   were added. Retain additions and transitions rather than overwriting the initial plan or
   earlier progress. Record card, phase, session usage, candidate, outcome,
   obstacle, next completion condition and evidence. Process-observation failure means unknown,
   never confirmed exit. Before coder auto-compaction, arrange a fresh-session handoff using
   Pocock's installed `handoff` skill. Enforce three coder sessions per card, reserving admission
   before each launch/continuation and reconciling ambiguous starts before any redispatch.
   Do not require a model to poll a worker or wait on CI.
2. **Make the cheap gate cover the active code.** Run the full reviewer TypeScript inventory and
   typecheck alongside the current runner suite in the selected Windows CI job. Demonstrate that
   a failing TS regression and a type error each fail the gate. Qualify the complete harness tail
   and success/error/abort/ownership lifecycle through existing seams before live dispatch.
   Include the bounded observational-memory trial on the existing direct Mastra API builder;
   adopt it only if the retained continuity, completion and total-cost evidence supports it.
   An unsuccessful trial leaves Pocock handoff as the first-release fallback rather than opening
   an unbounded memory-development effort. Memory is never shared with independent reviewers.
3. **Finish the preserved Review boundary.** Trace exact requirements across saved input,
   Claude/plugin handoff and delegated job; separately trace generation, cleanup, collection and
   durable publication. Use retained artifacts before another paid drive. Keep nonce fixtures,
   guarded restoration, direct Node exit observation and exact process ownership. Stabilize and
   independently review the resulting candidate; rerun required current-source proof.
4. **Connect the delivery tail in the existing durable workflow.** Reuse qualified Build/Review
   adapters and existing checks. Add the required review/remediation, Proof, PR, CI and exact-head
   merge transitions with signed-in GitHub access. Persist external operation identities and
   reconcile after restart before redispatch. Preserve Julia's preview/UAT suspension and
   candidate invalidation rules. Apply the accepted runner/decision-model/judgment split at event
   boundaries, using the same durable workflow as the owner. Chief-of-staff reasoning returns
   revised steps; it does not become a second orchestrator. Mechanical transitions, process/CI
   waiting, status updates and known limit responses need no model call. Do not revive Factory.
5. **Prove one real end-to-end delivery.** Use an approved existing issue and genuinely unsatisfied
   change through the supported Init path. Retain independent review and Proof evidence, actual
   PR/CI/merge identities, restart/duplicate behavior, bounded-stop evidence and readable progress.
   The complete required suite must pass on Todd's Windows laptop before delivery use.
   Extend the existing feature map/recipe through `maintain-verification-skill` before the new
   end-to-end Proof; do not handwrite a replacement verification skill or claim the current
   Init/Build/Review-only map proves merge.

Acceptance also covers the operating constraints: the fourth coder session is refused, restart
does not reset allowances or repeat an external action, failed observation is not called process
exit, step additions remain visible after refresh/restart, and a model-selected action cannot
override authorization, identity or gates. These checks are deterministic where possible; the
final supported-path machine Proof remains independent and uses the exact candidate.

Each step must fit a bounded unit of work. This sequence is not authorization to expand JUL-238's
existing Review-only requirements into the entire delivery tail.

## Limits and distinctions to settle

Keep these separate:

- A **work session allowance** bounds how many worker starts/continuations a card can consume.
- A **failure classification** records why a session ended. It must not silently grant capacity.
- A **review round** is a build/check/review cycle; it is not a worker session.
- **Cumulative spend and active time** remain enforced across continuations and restarts.

The reports count JUL-238 as eight control segments but three fresh worker contexts and one work
failure under that day's policy. A new all-sessions-count rule must specify which of those units
it counts, which roles it covers, and the ceiling. It must not rewrite the historical failure count.
Do not assume that a two-session total accommodates maker, independent review and Proof.

Accepted ADR 0021 supplies per-role limits; the reviewer remains $1 per card. Today's $12/GOAT-only
authorization and exact worker/context selection are historical run-specific constraints, not
new spending authorization. This planning session has made no model-provider calls or credential
probes. A later implementation must read the applicable accepted limits and dated decisions and
verify credentials through the restricted Windows vault helper where secrets are required.

## Open design tree

Settled, 2026-10-17:

1. First verified delivery: one real machine card, Init through Proof to merge.
2. Interview format: ask Todd one question at a time.
3. Context continuity: the runner arranges a handoff to a fresh coder session before
   auto-compaction, using Pocock's `handoff` skill. Candidate, remaining work, evidence and
   cumulative limits carry forward. The exact context trigger remains to settle.
4. Every coder session counts toward the same finite allowance, including context handoffs,
   provider retries and harness repairs. The runner owns counting; causal classification does not
   exempt or refund a session. Todd set the ceiling at **three coder sessions per card**.
   Refuse a fourth launch, retain the work and evidence, and report the limit through the existing
   stopped/parked path. Cumulative time and spend are not reset. Todd also notes that
   stopping and restarting has a cost and suggests evaluating Mastra observational memory.
5. Include a bounded builder-only observational-memory trial before adopting it, measuring
   completed work, retained context and total cost including Observer/Reflector calls. Pocock's
   handoff remains the fallback. This authorizes inclusion in the plan, not execution during
   this design interview, an unselected memory model, or additional spending.
6. The progress view shows concrete work steps grouped under phases: which steps are done,
   current and not done, plus elapsed time at
   the current step. When work is added mid-run, show the added steps explicitly and retain when
   and why they appeared. The runner updates this view without a monitoring model. This refines
   the earlier recommendation for the existing control page; it is not just a changing status line.
   Todd clarified that Review, Proof, CI and Merge are phases. Phases contain steps; a phase-only
   display does not meet this requirement. Use the same terms for Build and its concrete work.
7. Separate routine execution from judgment. Todd describes a chief-of-staff role whose job is
   keeping delivery directed toward the goal and deciding what to do when the plan breaks down.
   The runner performs everything that does not require judgment. Decisions should use a
   decision model such as Jev. This qualifies the earlier agreement to remove normal supervision:
   do not interpret it as removing goal-directed judgment on deviations. The exact boundary
   between structured decisions and open-ended diagnosis/replanning is settled in decision 8.
8. A decision selects among predefined permitted actions. Judgment is needed when the decision
   model cannot confidently select a suitable action: invoke chief-of-staff reasoning to diagnose
   or replan. Todd explicitly confirmed this distinction. The runner performs deterministic work
   and retains the authorization and limit checks.
9. Prioritize the simplest working machine. Improvements may follow the first successful delivery;
   their possible value does not make them first-release requirements. Apply this priority to
   the proposed memory trial and decision-model integration without losing the agreed role split,
   finite accounting, visibility or required independent Proof.

The context concern:

Todd explains that the supervisor was introduced because the coder repeatedly fell below 15%
context remaining and auto-compacted more than five times. The time/run scope of this observation
has not been established; do not conflate it with the corrected October 17 worker receipts.

Pocock's `handoff` is installed from `mattpocock/skills@v1.3.1` at
`.agents/skills/handoff/SKILL.md`. Its document goes in the operating system's temporary directory,
includes suggested skills, references existing artifacts instead of duplicating them, and redacts
sensitive information. The runner must retain its location for the receiving session. This is the
document handoff skill, not `claude-handoff`'s instruction to launch a background Claude agent.
No new session is launched by this planning decision.

## Observational memory trial

Todd accepted a bounded builder-only trial on 2026-10-17. Adoption depends on its results;
installation, dispatch and model/spend settings are not authorized by this planning session.
Installed `@mastra/core@1.75.0` documentation describes observational memory as Observer/Reflector
agents replacing older message history with observations. It requires `@mastra/memory` and a
supported storage provider; `@mastra/memory` is not installed in the current reviewer package.
The existing LibSQL adapter is a documented supported provider. `createCodingAgent()` accepts
memory configuration. The actual direct API builder factory, `src/mastra/routes.ts:298`, returns
that standard coding agent, so it offers a stock integration point; memory is not configured today.
That does not establish control over a separate Codex CLI or ACP application's internal context.
The October 17 supervisor's controller launched `codex.exe` and forwarded provider requests through
a proxy; it did not run that direct Mastra coding agent. Its configuration disabled Codex memories.
Turning on OM in the Mastra builder therefore does not fix that external worker by itself.

Any evaluation must distinguish the supervised CLI worker used on October 17 from the production
Mastra builder route. Measure continuity, completed work, context use, restart behavior and total
cost/active time including Observer/Reflector calls. Keep explicit model choices and cumulative
limits; do not silently enable the default memory model or its retry settings. Retain Pocock
handoff as the agreed fallback until a replacement is demonstrated. Reviewer memory remains
governed by accepted ADR 0017 and is outside this builder-context proposal.

The coder-session ceiling is three per card. Every context handoff, provider retry and
harness-repair session consumes that allowance. Memory observation/reflection within a continuing
coder session is not another coder session; its model calls still need full usage/cost accounting.
Independent review and Proof are separate roles, not coder continuations. This supplements existing
cumulative spend/active-time limits and the distinct review-round bound; it does not reset them.

Progress verification must demonstrate phases containing an original step list, a completed step, an in-progress step
with elapsed time, and a newly added step visible as added. Restart/readback must preserve both
the step state and addition history. Elapsed time derives from the retained step start, never
from the most recent page refresh. A waiting/stopped state remains visible rather than appearing
to be ongoing coder work. Detailed event receipts remain available behind the readable steps.

Routine monitoring/orchestration belongs to the runner. The retained judgment responsibility is
described in decision 7 above; it does not imply a continuously polling model. The runner must
preserve the current candidate, remaining work, failed boundary, budgets and raw evidence across
context handoff.

## Structured decisions and chief-of-staff judgment

No Jev integration or reference was found in the current project or installed skills. TypeSafe's
official documentation, reached through `https://docs.typesafe.ai/llms.txt`, establishes that Jev
accepts state and typed questions and returns choices, scores or probabilities. It does not write
diagnoses, plans or code. See [Jev with coding agents](https://docs.typesafe.ai/introduction/coding-agents).

Accepted split: deterministic rules execute in the runner; a decision model selects
among permitted actions when semantic judgment is needed; a bounded chief-of-staff reasoning job
diagnoses/replans when the supplied actions are insufficient or uncertainty prevents selection.
The runner retains authorization, session, identity and budget checks for every selected action.
No model decision creates another coder slot, additional spending or permission to expand scope.
Jev is Todd's example of a decision model, not an exact model/version/provider or spend selection.

Judgment returns a diagnosis and revised steps to the runner. It cannot bypass gates or change
Todd's goal, card scope, model selection, three-session ceiling or accepted spend limits.
Where a failure already has a fixed policy response, including a hard budget/session limit,
the runner executes that response without purchasing a model decision about it.

Concrete model selections, connection readiness and applicable accepted spend records must be
resolved at implementation preflight through the existing configuration/Init path, not inferred
from Jev's example name or this interview. The context-handoff trigger needs measured headroom
before auto-compaction, rather than an untested promise about a particular percentage.
The final agreed plan needs Todd's confirmation of shared understanding before implementation.

## Existing policy and documentation

Accepted ADRs 0018 and 0019 require one durable Mastra owner and documented stock capabilities;
0018 rejects a general supervisor or chief-of-staff agent. Todd's 2026-10-17 design steering now
retains a judgment role, with routine work in the runner. The final accepted design must state
its bounded authority and reconcile this explicitly; do not silently introduce a general
orchestrator or treat the role's name as changing authorization. ADRs 0012 and 0020 retain Julia preview UAT and exact
candidate merge authorization. The glossary's older Gate wording conflicts with that accepted
UAT order, and several delivery definitions still describe retired Factory. Reconcile affected
terms when the design decisions are settled; do not use that stale prose to bypass UAT.

Version-matched framework pages read for this planning session:

| Job | Installed documentation |
| --- | --- |
| Durable suspension/resumption | `@mastra/core@1.75.0/dist/docs/references/docs-workflows-suspend-and-resume.md` |
| Typed step inputs, resume data and retry semantics | `@mastra/core@1.75.0/dist/docs/references/reference-workflows-step.md` |
| Existing local snapshot storage | `@mastra/libsql@1.25.1/dist/docs/references/integrations-databases-libsql.md` |
| Observational memory design, prerequisites and background calls | `@mastra/core@1.75.0/dist/docs/references/docs-memory-observational-memory.md` |
| Memory configuration on stock coding agents | `@mastra/core@1.75.0/dist/docs/references/reference-coding-agent-create-coding-agent.md` |
| Jev's decision interface and boundary with coding agents | `https://docs.typesafe.ai/introduction/coding-agents`, indexed by the publisher's `llms.txt`; no local Jev package installed or configured |

These packages are installed under `ops/mastra-agents/reviewer/node_modules/`.
Implementation must add exact applicable documentation for external adapters it actually changes;
this draft does not claim their interfaces or permissions have been verified live.
