# Init-to-merge: slice briefs and proposed card amendments

Date: 2026-10-17. Status: publication verified; no card is certified Ready by this publication.
Implementation remains stopped. This file is the dated approved source snapshot, not a second live card.

[The short plan](2026-10-17-init-to-merge-plan.md) owns outcome, order, status and dated decisions.
The published Linear cards own current requirements, acceptance criteria and status. The slice
text below preserves the approved publication source; do not maintain it as another live spec.
A-D remain brief labels. Actual issue numbers and publication results are recorded below.

## Publication record — Todd, 17 October 2026

| Approved item | Published card | Verified state |
| --- | --- | --- |
| C / S04: progress visibility first | [JUL-239](https://linear.app/julia-next/issue/JUL-239/show-actual-work-steps-and-changes-to-the-plan) | Triage |
| A / S01: reviewer TS/typecheck CI | [JUL-240](https://linear.app/julia-next/issue/JUL-240/run-reviewer-typescript-tests-and-typecheck-in-the-existing-windows) | Triage |
| B / S02: retained tool-output bounds | [JUL-241](https://linear.app/julia-next/issue/JUL-241/prevent-large-tool-results-from-accumulating-in-the-api-builders) | Triage |
| S03 + S06: admission/handoff and gated workflow/judgment | [JUL-226](https://linear.app/julia-next/issue/JUL-226/produce-an-immutable-reviewed-candidate-through-stock-mastra) | Backlog |
| S05: direct Codex Reviewer milestone | [JUL-228](https://linear.app/julia-next/issue/JUL-228/add-the-codex-route) | Backlog |
| S07 + S08: machine release and full journey | [JUL-227](https://linear.app/julia-next/issue/JUL-227/release-the-exact-candidate-through-preview-uat-merge-and-production) | Backlog |
| D: conditional subject | **Not created** | No publication authorization |

Todd explicitly authorized publication only. All six card descriptions/states were read back.
The three existing cards retain their earlier specifications beneath the approved amendments.
New cards carry the existing category and needs-triage labels; no dependency/parent relations were
added or replaced. Publication does not authorize implementation, provider spend, Ready transitions
or model selection. Pending design qualification and Confirm remain agent work before Ready.

**Shape findings:** [source research and remaining unknowns](2026-10-17-init-to-merge-shape-findings.md).
Existing implementation facts have source citations there. New persistent-state designs and the
observation-only coder adapter are not proven by source inspection. Two-model sketches/prototypes,
where required by pre-plan, and live seam qualification have not been performed in this drafting
task; do not describe these drafts as a completed Confirm or move cards to Ready on that basis.
Fact/design qualification remains agent work before Ready, not a request for Todd to debug it.

The durable brief text describes behavior and interfaces; changing file/line citations stay in the
research/framework notes rather than becoming instructions to edit a particular implementation.
At publication each issue/comment begins with the triage AI disclaimer shown below.

## Shared completion and authorization

Every slice uses TDD, independent adversarial review, then its own independent Pstack Proof under
[the machine Proof policy](../agents/machine-pstack-verification.md). The verifier follows the
applicable maintained `verify-machine` feature, retaining exact commit/dirty-tree identity, Doctor,
actual drive/exit, criterion coverage, cleanup and readable evidence. Source changes invalidate
affected evidence. Final journey Proof does not substitute for any earlier slice's Proof.

Maintain changed verification surfaces through `maintain-verification-skill`; do not handwrite
recipes. Provider-free checks precede live qualification. S04, because it precedes the CI repair,
must run the complete existing Windows suite **and the active reviewer TS inventory/typecheck
directly**; the old MJS-only green gate is insufficient. S01 then wires those checks into CI.

Use the authorized development path to build/qualify the machine. Before using the adapted runner
for delivery, its complete Windows gate and applicable independent qualification must pass.
Slice feature drives are bounded qualification, not general delivery permission. No coder launch
is authorized by this document. S04 makes each later slice's actual coder runs visible before work
starts. New steps retain when/why they were added; a scope change returns through the owning card.

These are dated publication records, not additional standing rules. Before Start, the issue must exist,
its agreed criteria/Proof and dated decisions must match the authorized scope, and required
dependencies, model selections and accepted limits must be recorded. Actual cards become the
requirements source following publication; this file remains the historical triage record rather
than another copy to maintain. Existing policies own generic review/Proof/budget mechanics.

## Existing-work check and card ownership

The prior read-only Linear check covered current machine-setup cards and searches for rehearsal,
tool output, progress and context. Relevant descriptions were read for JUL-226/227/228/206/196,
JUL-229/232/233/238, JUL-80 and JUL-58.

- JUL-226 owns immutable build/check/review/remediation and durable recovery; its amendment is
  S03 plus S06 below. Preserve unaffected criteria and mark narrower milestones honestly.
- JUL-227 owns release and journey acceptance; S07/S08 do not complete its broader Julia scope.
- JUL-228 already proposes Codex. Triage/confirm its bounded Reviewer milestone, not a new Codex card.
- JUL-206 explicitly excludes runner changes and belongs to a browser-verification combined PR;
  completed JUL-197/JUL-198 are historical work, not ownership of this newly found TS omission.
- JUL-80 is the old graph/Linear-only visibility design, including a watchdog and 70%/Linear
  handoff. Brief C uses the current page and existing run store, without restoring that controller.
- JUL-232 is Build-only and excludes PR/merge. JUL-58 is a larger older household/production
  journey. Neither is silently repurposed as S08's subject.
- JUL-234-237 have preserved maker work at `ce3897ca`, not accepted independent evidence for
  this route. JUL-233/JUL-238 retain their plugin-specific scope; JUL-238 stays unfinished.

## Slice briefs, in execution order

### S04 — Show actual work steps and changes to the plan

> *This was generated by AI during triage.*

**Category:** enhancement. **Kind:** Machine.
**Summary:** Todd can follow actual coder work within phases, including elapsed time and added steps, for every later slice.

**Current behavior:** The existing page lists persisted Init/Build runs and results. It does not expose a durable concrete-step history or an interface for attaching ordinary development coder runs; using Build to obtain observations would also dispatch delivery.

**Desired behavior:** The existing page shows evidence-backed steps and actual coder lifecycle for both saved delivery runs and authorized bootstrap development runs. Observation alone cannot dispatch Build, admit a session, advance a phase or authorize work.

**Key interfaces:** Existing saved run/readback contract and Build lifecycle observations; proposed typed step/lifecycle extension and a minimal observation-only adapter for the authorized development path. New observations identify card, run, worker and step and retain starts, transitions and actual exits. S03 later consumes these events for admission/handoff.

**Owner:** proposed new issue, brief C. **Position:** first. **Dependencies:** existing persisted
Init/Build run state and local page; no dependency on S03. **Seams:** existing durable run/readback
and page, extended with step records and actual worker lifecycle events. Do not introduce a
progress-file controller or second runner.

**Acceptance criteria**

- [ ] 1. Each phase contains concrete steps with stable identity, original order, status and retained
  start/completion times. Show done, current and remaining steps rather than only phase labels.
- [ ] 2. Display elapsed time from the persisted current-step start; refresh/restart does not reset it.
  Working, waiting, stopped and unknown states remain distinguishable.
- [ ] 3. An added step is visibly marked with when and why it was added. Preserve the original plan and
  additions/transitions after restart, including a step reopened by remediation.
- [ ] 4. Show the actual coder runs for every later slice, including their issue/run identity, start,
  current concrete step, waiting/failure/stop and observed completion. The authorized bootstrap
  development path must record those lifecycle events in the same existing run store; attaching
  later coder runs is part of S04, not deferred to S03 or S06.
- [ ] 5. Render runner-owned state without an LLM watching or writing routine progress. Do not tick a
  step merely because a worker said it was done; retain its completion evidence.

**Independent review:** challenge the state/readback/page interface, refresh clocks, additions,
failed writes and misleading completion; cover browser-console and diagnostic logging standards.

**Proof:** after review, independently drive the real control page and its saved-run boundary.
Observe one done step, a current concrete step with elapsed time, remaining steps and one addition
with its reason/time. Restart the page/workflow process and independently read the same run back;
the step identity, original start and addition history survive. Attach a real bounded coder job
through the authorized development path and observe its actual start/current/exit states in this
same view before S01 starts. Retain screenshots/readbacks,
console outcome and cleanup evidence. A hand-edited status JSON or standalone page fixture is
not this Proof.

**Done:** every criterion has current independent Review and Proof.

**Out of scope:** A second runner/store, new dashboard, notifications, watchdog platform and the retired graph's 70%/Linear-handoff policy. Session admission and handoff enforcement remain S03.

**Scope split from S03:** S04 owns step identity/history, worker lifecycle observations and page
readback. S03 later adds durable admission counts, cumulative-limit enforcement and the 50%
handoff trigger, using those existing step events. A progress read does not grant a launch slot.
S04's own build is the bootstrap; its view is not claimed available before S04 passes Proof.

### S01 — Make the selected Windows gate cover the active code

> *This was generated by AI during triage.*

**Category:** bug. **Kind:** Machine.
**Summary:** A reviewer TypeScript regression or compiler error fails the existing Windows CI gate.

**Current behavior:** The Windows job installs reviewer dependencies and invokes a suite that discovers MJS tests only. A read-only reproduction found four active reviewer TS test files, zero selected, and no compiler invocation in the workflow; the coverage assertion exited 1 as expected.

**Desired behavior:** The selected Windows gate runs the full active reviewer TS inventory and compiler check alongside existing coverage, rejects missing required execution and propagates failures to the aggregate result.

**Key interfaces:** Test-discovery result, package test/typecheck commands, changed-path gate selection, actual Windows job exit and aggregate check. The local and hosted command contract must agree.

**Owner:** proposed brief A. **Seams:** `discoverRunnerTests`, the selected Windows workflow job,
reviewer package test/typecheck commands, and the aggregate GitHub check.

**Acceptance criteria**

- [ ] 1. The gate executes all active reviewer `.test.ts` files, existing runner/shared safety tests,
  and reviewer `tsc --noEmit`; no new TS regression disappears because of its extension.
- [ ] 2. A real failing TS behavior test and a real type error independently make the selected gate
  fail. An empty required test inventory is rejected. Existing unrelated routing is preserved.
- [ ] 3. Restoring the candidate makes the gate pass. Normal regression execution makes no model calls.

**Independent review:** audit discovery, exclusions, invocation and error propagation, including
the test inventory; do not accept a YAML assertion as evidence that tests ran.

**Proof:** after review, independently run the complete selected gate on Windows and inspect real
GitHub Actions results for an authorized candidate branch. Retain actual controlled TS-failure,
type-error and restored-green gate/aggregate outcomes and ordinary artifacts. A temporary failure
revision cannot inherit the restored candidate's PASS. The real local command and hosted command
must agree; neither passing the old MJS suite nor a mocked Actions result completes this slice.

**Done:** every criterion has current independent Review and Proof.

**Out of scope:** Browser-verification redesign, new CI infrastructure, unrelated routing/test cleanup and JUL-206's combined-PR scope.

**Dependencies:** accepted S04 Proof and real coder-run visibility. **Cause:** reviewer TS tests
and typecheck were omitted during the migration into the MJS-only discovery path. See
`C:/Dev/jul233-supervision/ci-rca-20261017.md`; the older browser-focused JUL-206 is not this owner.

### S02 — Bound tool results before persistence and replay

> *This was generated by AI during triage.*

**Category:** bug. **Kind:** Machine.
**Summary:** Large tool results remain complete on disk while saved conversation and later provider requests stay bounded.

**Current behavior:** The token RCA shows large tool results becoming retained history and being resent at each inference. Handoff and terminal display limits do not prevent that replay; no accepted live proof establishes a pre-persistence guard on the selected API builder.

**Desired behavior:** A successful result, thrown error or parallel batch produces bounded useful history and complete retrievable evidence before another inference. The later request cannot restore the raw payload through another field.

**Key interfaces:** The actual selected coding-agent tool-result processor, persistent message list, provider-request input and existing bounded artifact read/search tools. The installed successful-result processor does not handle thrown tool errors, so the error interface must be qualified separately.

**Owner:** proposed brief B. **Seams:** the actual selected direct Mastra API builder's tool-result
processor, persistent messages, next provider request and existing artifact read/search tools.

**Acceptance criteria**

- [ ] 1. Full raw successful and error output is retained as run/session/tool-call evidence. History
  contains bounded useful excerpts, actual status/exit, size/truncation and artifact references.
- [ ] 2. Both per-result and aggregate-before-inference limits cover parallel results, batches and
  thrown errors. The next request cannot reintroduce the raw payload from another message field.
- [ ] 3. Bounded read/search can retrieve a discriminating detail from the complete artifact and is
  subject to the same limits. Artifact ownership and candidate association remain inspectable.
- [ ] 4. Capture admitted versus original sizes, requests, input/cached/output usage and context trend.
  Waiting on a long local job does not create empty model-poll turns.

**Independent review:** trace the installed public Mastra seam through retained history and the
next call; challenge the thrown-error gap, concurrency, encoding and alternate result fields.

**Proof:** after review, use the mapped real selected-builder route with controlled oversized
output, an error and a batch, then a later model turn and bounded retrieval. Independently inspect
the complete artifacts, saved conversation and captured outbound request for absence of the raw
payload and presence of useful status/detail. Save hashes/sizes and actual request/usage evidence.
Deterministic provider-boundary tests are supporting regression evidence, not the live seam proof.
Do not claim this processor controls an external Codex/ACP application's internal tool history.

**Done:** every criterion has current independent Review and Proof.

**Out of scope:** External Codex/ACP applications' internal history, OM/Graphify, summary models, a new artifact service or terminal-only truncation as the history fix.

**Dependencies:** accepted S01 and S04 evidence. **Cause and implementation seam:** the token RCA
identifies retained raw tool output replay, not auto-compaction. Installed Mastra 1.75.0 documents
`processToolResult` / `messageList.updateToolInvocation` before persistence and next inference;
this hook does not fire for thrown tool errors. Prompt trimming alone leaves stored history
unchanged. Choose and record actual per-result and aggregate caps during qualification.

### S03 — Make session admission and context handoff mechanical

> *This was generated by AI during triage.*

**Category:** enhancement. **Kind:** Machine.
**Summary:** The runner mechanically enforces three authorized coder sessions and preserves continuity at 50% context.

**Current behavior:** Existing Build/Review modules retain launch identity, results and role limits, but do not establish the newly agreed all-sessions admission ledger and 50% handoff. JUL-226's older machinery-failure exemption conflicts with that policy.

**Desired behavior:** Every authorized coder start or continuation reserves capacity before dispatch, carries cumulative allowances forward and uses the measured-context handoff. Unknown launch/exit stays unknown until reconciled.

**Key interfaces:** Durable run/launch claim, card-level session and role-limit ledger, worker context telemetry, Pocock handoff reference and owned-process observation. Reuse S04's step events without making progress readback an admission mechanism.

**Owner:** proposed amendment to JUL-226. **Seams:** existing run state, durable launch claim,
worker telemetry, cumulative ledger, Pocock handoff artifact and owned-process observations.

**Acceptance criteria**

- [ ] 1. Reserve a coder-session slot durably before launch/continuation. Every admitted session counts;
  handoff, provider retry and harness repair neither refund slots nor reset time/spend.
- [ ] 2. Concurrent requests/restarts cannot double launch. An uncertain start/exit stays unknown until
  reconciled; reading an existing job is not another launch. Refuse a fourth coder session.
- [ ] 3. At 50% of the runtime-reported usable context window, preserve source identity, remaining work,
  evidence and limits in Pocock's temp-directory handoff; a permitted successor resumes from it.
  Record the measured numerator/denominator. Do not wait for native auto-compaction.
- [ ] 4. The third session may keep working within its other limits. If a handoff would need a fourth,
  save the handoff and park without launching. No role rename or new run evades the card's cap.
- [ ] 5. Job completion, deadlines and known limit responses are deterministic; only owned processes
  may be stopped, and actual exit/cleanup is verified. Waiting time is distinguished from active time.

**Independent review:** examine reservation/write/launch crash windows, counting all continuation
paths, telemetry validity, stale process identities and the actual successor's inputs.

**Proof:** after review, independently drive the real saved-run admission and handoff path on a
controlled machine candidate, restart at the launch/result seam, and read the durable state back.
Verify actual runtime telemetry and one real handoff/resume without restarting completed work.
Use exhaustive internal threshold/count tests for the 50% crossing and fourth-launch refusal;
rerun them as Proof evidence rather than exhausting paid limits. Distinguish a controlled
threshold test from a naturally observed 50% event; neither invented telemetry nor an arithmetic
unit test alone proves the real handoff integration. Retain owned-process cleanup evidence.

**Done:** every criterion has current independent Review and Proof.

**Out of scope:** Changing the distinct two unsuccessful review-round stop, refunding future authorized sessions, resetting cumulative budgets, new monitoring infrastructure or product remediation by the crash-fixer.

**Dependencies:** accepted S02 and S04 evidence. S03 consumes S04's step/lifecycle records; it is
not a prerequisite for displaying progress. The starting session balance follows Todd's dated
exclusion decision in the plan and the audited ledger adjustment, not the three unauthorized
launch receipts. Prospective authorized sessions still follow the agreed counting rule.

### S05 — Obtain direct Codex Review automatically

> *This was generated by AI during triage.*

**Category:** enhancement. **Kind:** Machine.
**Summary:** The runner obtains and durably saves a direct Codex review of the exact candidate without manual forwarding.

**Current behavior:** Preserved Review modules provide candidate input, claim/result handling and a bounded Claude adapter. The saved route set and Review gate do not expose a working direct-Codex adapter; JUL-238 implements a different, unfinished plugin story.

**Desired behavior:** Init saves the direct Codex Reviewer selection, the runner sends the complete pinned contract/evidence, and the substantive result, provenance and actual exit survive restart without a duplicate job.

**Key interfaces:** Saved Reviewer selection, ReviewInputSchema, ReviewExecutionSchema, ReviewResultSchema, durable Review claim/store, minimal installed Codex adapter and readback. Model-maker independence is checked on the actual model company.

**Owner:** JUL-228, proposed first-release scope. **Seams:** saved Reviewer selection,
`ReviewInputSchema` / `ReviewExecutionSchema` / `ReviewResultSchema`, existing durable claim/store,
minimal installed Codex adapter and result readback. Reuse JUL-234-237 where qualified.

**Acceptance criteria**

- [ ] 1. Init can save a valid direct-Codex Reviewer connection/model/effort, with model-maker independence
  checked against the Builder. The runner sends the pinned requirements, all criteria, candidate
  and raw evidence references automatically, excluding maker conversations and Claude forwarding.
- [ ] 2. One durable claim launches at most one job. Persist substantive criterion-linked Standards/Spec
  result, exact candidate identity, configured versus observed provenance and actual process exit.
- [ ] 3. Unsupported/auth/transport/malformed/uncertain completion is visibly incomplete, never a PASS,
  product FAIL, silent fallback or permission to redispatch. Candidate drift discards the verdict.
- [ ] 4. Enforce the accepted Reviewer limits and cancellation over the owned job lifetime. Restart,
  repeated clicks and result readback do not duplicate the job or change the original selections.

**Independent review:** audit full requirement/evidence delivery, maker independence, missing
criteria/changed files, job collection, cap/cancel ownership and the difference between verdict
generation and durable publication. Do not use a Codex-made implementation's Codex self-check as
its independent review; use an explicitly authorized different-company reviewer.

**Proof:** after review, independently use the real Init/control-page Review route with the saved
Codex selection and controlled immutable candidate. Observe Codex receive the contract, save its
real verdict and exit, restart/read back, and attempt a repeated Review without another dispatch.
Drive actual cancellation and candidate-drift rejection through supported seams. Use focused
internal tests for clock/count rules; do not exhaust a subscription or paid cap. Retain request,
provenance, result, process identity and pre/post candidate evidence.

**Done:** every criterion has current independent Review and Proof.

**Out of scope:** All-four-role Codex support, JUL-238's Claude/plugin-specific completion, a Claude intermediary, silent model fallback or a second opinion.

**Dependencies:** S01-S04. **Existing-card scope:** triage/confirm JUL-228's Reviewer-only milestone.
Its wider four-role support remains unfinished; do not silently mark the whole card Complete.

### S06 — Connect real Init to gated Build, Review, remediation and Proof

> *This was generated by AI during triage.*

**Category:** enhancement. **Kind:** Machine.
**Summary:** One real Init run reaches an independently reviewed and proven machine candidate, with bounded event-driven judgment when needed.

**Current behavior:** The local page's workflow reaches Build; the CLI's four-role call and richer durable delivery spine are disconnected. Init has four existing role selections and no judgment-role selection or proof-phase integration.

**Desired behavior:** One durable workflow owns the real entry point through checks, Review, remediation and independent Proof. When defined actions are insufficient, it invokes the original Init-selected judgment model and validates the returned diagnosis/revised steps.

**Key interfaces:** Thin Init entry, saved role/snapshot selection extended for judgment, Build/Review results, proposed typed independent-Proof result and typed judgment result, existing durable workflow state and S04 step events. Selections, role limits and candidate identity survive restart.

**Owner:** JUL-226, proposed amendment. **Seams:** actual Init entry, stock durable Mastra workflow,
qualified Build/Review adapters, checks, mapped independent verifier and bounded judgment result.
Init selects and saves the judgment model, connection and effort through the existing model
selection mechanism, as it does for other roles. Do not hard-code a vendor/model or route this
job through Claude; Claude is outside the machine and advises Todd.

**Acceptance criteria**

- [ ] 1. Supported Init creates/resumes one run using the saved authorized issue and selections, then
  reaches Build, deterministic checks, independent Review and independent machine Proof in order.
  No disconnected four-role call can declare delivery complete.
- [ ] 2. An actionable review defect returns exact findings to remediation. A changed candidate repeats
  applicable checks/review/Proof; inconclusive review and machinery crashes are not product FAIL.
- [ ] 3. Known outcomes advance or stop deterministically. An event needing diagnosis invokes one bounded
  judgment job using the original Init-saved model/connection/effort and applicable authorized
  limit. Save configured versus observed provenance; restart uses that selection rather than
  changed defaults. It returns diagnosis/permitted revised steps, not a second workflow.
  No continuous watching or model-mediated empty polling.
- [ ] 4. Judgment/decision output cannot change goal, issue scope, authorization, models, limits, gates or
  verified evidence. Apply revised steps through the same retained history as S04. Preserve the
  existing bounded machinery-repair policy and independent repair-review requirement.
- [ ] 5. Restart/readback does not rerun Build/Review/Proof or duplicate external effects. Save candidate,
  results, failure classification, remaining work and cumulative accounting at each transition.

**Independent review:** trace the actual launcher-to-workflow route, provider/consumer contracts,
resume semantics, evidence invalidation and the judgment role's deliberately restricted authority.

**Proof:** after review, independently drive the supported Init route on a controlled machine
candidate to reviewed-and-proven state. Demonstrate actionable remediation and a changed commit,
restart/resume without duplicate jobs, and a real bounded judgment event using the Init-saved selection with visible revised
steps. Independently inspect the workflow's invocation and retained result of `verify-machine`;
a fake verifier callback cannot prove the Proof phase. Test forbidden judgment actions through
the runner's production validation seam. The outer verifier remains independent of the maker.

**Done:** every criterion has current independent Review and Proof.

**Out of scope:** PR/merge, a general supervisor, Jev integration, continuous monitoring, unlimited recovery or an implicit judgment spend allowance.

**Dependencies:** accepted S05. **Existing-card amendment:** preserve JUL-226's unaffected
criteria, cumulative limits and bounded independently reviewed machinery repair. Record the
three-session/50% policy from S03 and this bounded judgment role explicitly. The older exclusion
of a general chief of staff still rules out a second orchestrator. Product-specific JUL-208 proof
and notifications remain unfinished unless separately delivered. S03 and S06 share one card's
allowances. The judgment selector extends existing Init selection; it is not a new selection
service. Proof must also show that changing defaults after Init does not change the selected job.

### S07 — Connect the machine-only release tail

> *This was generated by AI during triage.*

**Category:** enhancement. **Kind:** Machine.
**Summary:** An authorized reviewed/proven machine candidate reaches one real PR, passing CI and exact-candidate merge.

**Current behavior:** The durable spine ends at technical acceptance. Historical publish/merge helpers use the old App-token route; they do not establish the current ordinary signed-in-GitHub release path or its durable reconciliation.

**Desired behavior:** The workflow persists and reconciles GitHub operations, correlates required checks to the exact candidate, and merges only with applicable authorization and current Review/Proof.

**Key interfaces:** Qualified-candidate handoff, ordinary signed-in GitHub branch/PR/check/merge adapter, exact-head guard and durable external-effect record. GitHub owns the actual PR/check/merge outcome; local completion text cannot substitute for readback.

**Owner:** JUL-227, proposed machine milestone. **Seams:** reviewed/proven candidate handoff,
ordinary signed-in GitHub branch/PR/check/merge operations and durable external-effect records.

**Acceptance criteria**

- [ ] 1. Push only the exact qualified candidate, create or resume one PR, and persist branch/PR and
  check-run identities. Restart reconciles the real external result before repeating a write.
- [ ] 2. CI must pass for the exact PR head being merged; required missing/skipped/unavailable checks
  cannot be treated as successful verification. Failed CI follows the permitted repair policy.
- [ ] 3. Merge requires the applicable recorded authorization plus current independent Review and Proof.
  Re-read candidate/head before merge; mismatch refuses it. Save head, merge result and resulting
  main commit, and verify that GitHub actually merged the intended candidate.
- [ ] 4. Machine Proof is machine UAT. Preserve Julia's preview, smoke, Todd's household UAT and
  production-confirmation requirements for Julia cards; a machine-only branch cannot bypass
  those requirements for product work or claim full JUL-227 completion.

**Independent review:** audit ordinary GitHub authentication, duplicate PR/merge prevention,
actual check coverage and stale-head/authorization races. Do not restore App-only publisher helpers.

**Proof:** after review, independently exercise the actual signed-in GitHub route on an authorized
non-product candidate and real PR. Retain real selected-CI results, restart readback and evidence
that one PR exists. A controlled stale-head case refuses merge. Restore and requalify the final
candidate before the authorized successful merge, then independently read PR/main identities back.
This is a bounded release-feature qualification under JUL-227, using an already reviewed/proven
controlled subject, not delivery through the unqualified Init route. Record the runner candidate
separately from that subject. S08 subsequently proves the whole qualified Init journey; it cannot
be used retroactively as the prerequisite Proof for S07.

**Done:** every criterion has current independent Review and Proof.

**Out of scope:** Julia feature delivery, erasing Julia preview/UAT/production/notification criteria, branch-protection administration, automatic restoration or restoring App-only publishing.

**Dependencies:** accepted S06. **Existing-card amendment:** record this machine milestone without
erasing JUL-227's Julia preview/UAT/production/notification requirements. Reconcile its older scoped-
token wording with current ordinary signed-in-GitHub policy. Do not restore retired publishing.

### S08 — Demonstrate the whole machine on one real card

> *This was generated by AI during triage.*

**Category:** enhancement. **Kind:** Machine.
**Summary:** One genuinely unsatisfied machine card completes the full qualified Init-to-merge journey.

**Current behavior:** The October 17 work has maker implementations and evidence, but no independently proven machine delivery through a real merge. The integrated route is not qualified for delivery.

**Desired behavior:** After S01-S07 qualify the machine, one pinned approved subject reaches actual merge with visible concrete steps and independently supported criteria, without Todd relaying agent messages.

**Key interfaces:** Qualified runner identity, approved subject issue/saved requirements, separate subject candidate identity, exact review/Proof evidence, real PR/CI/merge records and durable restart readback.

**Owner:** JUL-227 journey acceptance; pin an eligible subject issue before Start. Prefer an
existing approved, genuinely unsatisfied machine card. JUL-232 is Build-only and explicitly
excludes PR/merge; JUL-238 is plugin-specific. Neither is silently repurposed. Brief D supplies
a proposed non-product subject only if no suitable existing card can be used; creation requires
Todd's triage approval and the resulting issue must exist before implementation authorization.

**Acceptance criteria**

- [ ] 1. Before delivery use, the integrated candidate passes the complete Windows suite, applicable
  TS tests/typecheck, independent review and maintained verification-map qualification. No pending
  slice Proof is hidden behind the final run. Save the runner identity separately from its
  generated subject candidate.
- [ ] 2. Start the selected card through supported Init with saved requirements/selections and a
  genuinely unsatisfied change. Retain concrete phase steps, elapsed time, additions, cumulative
  session/time/spend/usage, and all review/Proof/candidate identities without manual agent relaying.
- [ ] 3. The independent reviewer and verifier evaluate the exact subject candidate. Required CI and
  merge authorization cover it; the real PR merges it and the resulting main identity is verified.
- [ ] 4. Report each criterion from underlying evidence; preserve all artifacts and only clean owned
  processes. No Julia feature delivery, old plugin-card completion or simulated merge is claimed.

**Independent review:** the qualified runner candidate has its own independent review. The
subject's complete diff and evidence receive another independent review under its issue contract.

**Proof:** an independent outer verifier uses the maintained real Init-to-merge feature recipe,
Doctor before/after and actual Windows/GitHub dependencies. Observe the entire journey and retain
the subject's own machine Proof before merge, the CI/PR/merge receipts and a restart readback.
All earlier slice Proofs remain individually required. A summary, tests-only run or maker-driven
rehearsal does not complete this acceptance.

**Done:** every criterion has current independent Review and Proof, and the real subject has merged.

**Out of scope:** Julia product delivery, old plugin-card completion, simulated merge, passing a partial phase as delivery or substituting the final Proof for earlier slice Proofs.

**Dependencies:** qualified S01-S07, including S04 first; pin the authorized subject before Start.
JUL-227 owns journey acceptance, not an invented new owner issue.

## Brief D — Conditional final-delivery subject

> *This was generated by AI during triage.*

Use only if no eligible existing, genuinely unsatisfied machine card is available. This is a
triage proposal, not a created issue; D is a document label, not an issue number.

**Category:** Machine / non-product proof fixture. **Use:** S08 subject; JUL-227 owns the journey.

**Outcome:** one unique machine-rehearsal artifact reaches main through the qualified machine.

Before Start, approve a run-specific marker path absent from the recorded base and exact UTF-8
bytes including newline. Pin those requirements; do not change them mid-drive to make an already
satisfied fixture appear new.

**Acceptance criteria**
- The approved path is absent at the pinned base and the exact candidate contains all approved bytes.
- The clean, non-empty candidate commit changes only that file.
- Independent review covers the complete diff. Independent Pstack Proof reads the real artifact,
  validates bytes/change list/identity and retains evidence before release.

**Journey:** S08 owns the full Init/Build/checks/Review/Proof/PR/CI/merge acceptance and its outer
Proof. Reference that contract rather than duplicating it on this subject card. Record runner and
subject identities separately. No simulated merge or maker summary satisfies either Proof.

**Dependencies:** qualified S01-S07; an approved existing card or approved triage/publication for D;
explicit start, selections, applicable limits and merge authorization. Excludes Julia product
behavior, modifying JUL-232, plugin completion, weakening gates or adding another controller.

## Retained unauthorized-start evidence

Todd's current dated session decision is recorded in the short plan. The original three launch
receipts remain historical evidence; the ledger adjustment records their exclusion without
erasing actual usage, costs, time or the stop receipt.

Evidence: `C:/Dev/julia-init-merge-run-20261017/JUL-226/`. The stopped operator helper is not a
qualified machine entry point. Its final worker and owned children exited. The isolated tree
`C:/Dev/julia-init-to-merge` at base `ce3897ca` produced no source changes; it holds documentation
reference copies. Nothing was pushed/merged and no independent review or Proof was completed.
The baseline MJS suite exited 0 (221 passed, one skipped); it omitted TS/typecheck and is not full
qualification. Preserve all retained trees, evidence and the dirty root checkout.

## Scope disposition and handoff

**Keep:** the outcomes and failure behavior in each brief; each contributes to that slice's real
Proof. S04's observation-only adapter is necessary to meet the already agreed later-coder visibility.

**Split/defer:** the previously agreed OM/Graphify/Jev integrations, broader four-role Codex use,
Julia preview/UAT/production and notification work. Preserve their existing owners/status. No new
requirement or Parking lot entry is being introduced or posted during this local drafting task.

**Drop from the approach:** Claude as a machine judgment role, continuous model watching,
terminal-only output truncation as a fix for retained history, and reusing the unfinished plugin
chain as a prerequisite. These follow Todd's existing decisions, not a new rejection decision.

**Before Ready:** resolve the recorded design questions with the prescribed planning checks;
confirm each approved card and its actual schema users, installed-version framework map, real
dependencies, accepted limits and mapped Proof. A type sketch is not restart or seam evidence.
Use the approved requirements without silently adding criteria during Confirm.

For Todd: C/A/B were published as JUL-239/JUL-240/JUL-241 in Triage; the three amendments remain Backlog.
For Todd: D was not created. Publication grants no Ready transition, implementation or model/spend authorization.

## Framework references

Pages read under the installed reviewer `node_modules/`:

| Job | Version-matched page read |
| --- | --- |
| Durable waits and restart | `@mastra/core@1.75.0/dist/docs/references/docs-workflows-suspend-and-resume.md` |
| Typed steps, resume data and retry semantics | `@mastra/core@1.75.0/dist/docs/references/reference-workflows-step.md` |
| Existing local snapshot storage | `@mastra/libsql@1.25.1/dist/docs/references/integrations-databases-libsql.md` |
| Replace tool results before persistent history / next model call | `@mastra/core@1.75.0/dist/docs/references/reference-processors-processor-interface.md`, `processToolResult` section |
| Supplementary workspace per-tool output caps | `@mastra/core@1.75.0/dist/docs/references/reference-workspace-workspace-class.md`, tool configuration |
| Distinguish transient prompt trimming from stored-history control | `@mastra/core@1.75.0/dist/docs/references/reference-processors-token-limiter-processor.md` |

Use documented stock capabilities under accepted ADR 0019. Extend the framework map for the
actual adapters changed during implementation; this brief does not claim live credential,
external API or merge verification. Deferred OM/Jev references remain in the interview notes.
