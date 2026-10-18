# Init-to-merge: source findings for draft triage

Date: 2026-10-17. Source research plus the coordinator's read-only discovery assertion below.
No sketch, prototype, candidate test suite, model-provider job, live feature drive or Proof performed.
This is supporting research, not acceptance criteria or a readiness decision.

## Source convention

`R/` means `C:/Dev/julia-next/`; `I/` means preserved `C:/Dev/jul233-integration/`.
`M/` means `R/ops/mastra-agents/reviewer/src/mastra/`.
`D/` means `R/ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/`.
Installed versions: core 1.75.0, libSQL 1.25.1, libSQL client 0.18.0 (each package's `package.json:3`).

## S04 first: existing observation surfaces and the bootstrap gap

- **Existing durable Init:** `M/initialization.ts:123-165` configures a local LibSQLStore,
  obtains the saved workflow through `getWorkflowRunById`, and projects saved Init/Build state.
  `M/initialization.ts:264-275` lists those workflow runs and reads each back.
- **Existing local page:** `M/control-server.ts:55-69` uses the existing
  `~/.julia/initialization.db` by default and supplies `runtime.list()` to the page.
  `M/control-page.ts:76-87` reads `/runs`, shows the card identifier plus phase state and raw
  Build JSON; it refreshes on page load or button action. There is no concrete-step view here.
- **Existing Build lifecycle:** `M/build-phase.ts:44-103` reads/atomically publishes Build
  evidence; `:331-390` saves a pre-spawn handoff, launches a detached worker and publishes its
  PID plus creation identity. `:405-448` arbitrates the launch lock. `:484-485` records a stale
  launch as interrupted. These are useful precedents, not an external-job observation interface.
- **Existing counters are insufficient:** `M/initialization-observability.ts:8-36` records
  dispatch/inference/Linear operation counts in an in-memory array; it does not persist concrete
  step transitions, added-step history, waiting states or coder-job observations.
- **New S04 work:** durable step identity/history and projections; actual job-event ingestion
  from the authorized development path; live/readback behavior on the existing page.
- **Bootstrap design unknown:** no existing attach-only interface was found that accepts an
  externally authorized coder job into the existing run store. `/build` goes to `runtime.build`
  (`M/control-server.ts:70-74`), which launches the current delivery Builder, rather than merely
  observes an independently authorized development job. The draft must not treat that launch
  path as already qualified for delivery.
- **Question before Ready:** what is the smallest observation-only adapter and shared schema
  that can associate issue/run/step with process identity, real start/current/exit evidence and
  uncertain observations, without granting launch authority or becoming another controller?
  Which existing development launcher supplies its events? This needs design qualification.
- Removing S03 as S04's prerequisite is coherent: display and lifecycle facts need no session
  admission policy. S03 can later supply its own durable admission/limit events to this view.

## S01: test gate omission is an existing fact

- `R/scripts/julia-runner-suite.mjs:36-49` discovers only `.test.mjs` files.
- `R/.github/workflows/ci.yml:85-100` runs that suite in the selected Windows job;
  `:141-154` makes the aggregate depend on its outcome.
- `R/ops/mastra-agents/reviewer/package.json:8-12` already names TS-specific test commands
  and `typecheck: tsc --noEmit`. Wiring the active TS inventory/typecheck into the selected gate
  is new; inventing another CI platform is unnecessary. Hosted behavior remains unverified.

## S02: public processor seam exists; error/batch coverage remains design work

- `D/reference-processors-processor-interface.md:705-711` specifies `processToolResult`
  before message-list persistence and the next inference, replacement via
  `messageList.updateToolInvocation`, and explicitly excludes thrown `tool.execute()` errors.
- The same document `:376` says prompt changes are transient and do not alter stored messages.
- `M/routes.ts:301-321` constructs the stock coding agent for the direct CommandCode route,
  scoped by `basePath`; it does not configure memory or a result guard here.
- `M/build-builder.ts:87-145` wraps provider requests for spend measurement, then uses
  `agent.generate` with step callback. It does not save token/context trends or bounded history.
- **Unknowns:** how to cover thrown errors and aggregate concurrent results before every next
  inference, safely write/retrieve complete artifacts, and capture actual retained history plus
  later outbound request. The public result hook alone does not settle these rules.

## S03: durable-launch precedent exists; count and context handoff are new

- Build already tracks launch ID, process identity, start time and measured terminal usage
  (`M/contracts.ts:192-224`; `M/build-phase.ts:281-311`). Its per-build paid/subscription
  enforcement is not a durable three-session-per-card admission ledger.
- `M/build-builder.ts:108-127` consumes usage for cost accounting; `:134-142` has a step callback.
  The Builder result interface (`M/build-phase.ts:17-18`) returns text/time/spend and optional
  memory/limit status; no usable-context numerator/denominator or handoff result is exposed.
- **Fact/design unknown:** verify the selected runtime's genuine usable-window telemetry and
  safe interruption/resume interface before promising a measured 50% handoff. Host RSS and
  cached-input usage are not that denominator. Counts, crash reconciliation and cumulative
  limits require a new persisted state model, using existing launch-identity precedents.
- Todd's exclusion makes JUL-226's prospective balance zero; historical receipts/cost remain.

## S05: Review storage/contracts can be reused; direct Codex cannot be assumed

- `I/ops/mastra-agents/reviewer/src/mastra/review-store.ts:24-34,55-87` puts durable claim/result
  rows in the existing run database; primary-key insert arbitration selects one claimant.
- `I/ops/mastra-agents/reviewer/src/mastra/review-phase.ts:74-90` builds Review input from
  saved requirements/candidate/evidence; `:211-233` reads existing claim/result before dispatch.
  `:239-247` projects saved observations without dispatching. These are useful S04 precedents too.
- `I/ops/mastra-agents/reviewer/src/mastra/contracts.ts:315-383` defines Review input and
  substantive criterion-bearing result schemas. Review route support is explicitly Claude-only
  (`I/.../review-phase.ts:25-26`), so a direct-Codex adapter plus route/selection/identity/cancel
  qualification is genuinely new. Existing plugin-specific work is not this adapter.

## S06-S08: unification and release remain genuine integration work

- Current Init has four roles, not judgment (`M/contracts.ts:38-44`;
  `M/control-page.ts:55-74`). Model offers/selections can be reused, but adding judgment to the
  form, schemas, saved snapshot and dispatch is new. No Claude machine role is required by Todd.
- Current CLI's Start dispatch (`M/cli.ts:92-129`) enters the four-role execution workflow;
  `M/workflows/delivery.ts:27-58` iterates roles rather than the planned gated lifecycle.
- A richer durable workflow exists separately: `R/ops/mastra-agents/reviewer/src/delivery-workflow.mjs:291,330-374,411-433`
  includes build/check/review rounds and technical acceptance suspension; its runtime
  `delivery-workflow-runtime.mjs:18-54,113-145` persists, inspects and resumes it.
  Neither this fact nor saved Init proves one connected Init-to-Proof-to-merge route today.
- Stock snapshot/readback support is documented in `D/docs-workflows-snapshots.md:7-27`
  and `D/reference-workflows-workflow-state-reader.md:7-25`; choose one durable owner, not a
  new progress controller. New restart/side-effect and judgment interfaces need design qualification.
- Old release helpers import the GitHub App publisher (`R/scripts/publish-pr.mjs:20`;
  `R/scripts/merge-pr.mjs:10,39-49`). Exact-head merge is a precedent, but current ordinary
  signed-in GitHub authorization requires a qualified adapter, not silently reusing retired auth.
- S08 requires a real eligible subject and the already-qualified route. A final successful drive
  cannot replace each earlier slice's independent Proof or complete broader Julia card criteria.

## Redundancy / prior rejection check

Existing page, durable store, Build identity/checkpoints and Review claim/readback must be reused
where suitable; step history, external-job attachment and judgment selection are not already built.
No `.out-of-scope/` directory was found in root or preserved integration during this check; no
prior-rejection record is asserted. A missing KB does not mean all enhancements are authorized.

## Coordinator's CI coverage reproduction

Root candidate: `e75bbaaedafeb1e6ac36a993650ca353a1bee9d0`; preserved integration:
`ce3897ca589bf80525d405589621e23ed7e5d196`. Existing dirty files were preserved.
A read-only Node assertion imported the actual `discoverRunnerTests()`, compared it with the
reviewer test directory's active `.test.ts` inventory and checked the actual workflow commands.
Observed: **4 TS files present, 0 selected, no typecheck wired; actual exit 1**, as expected for
this coverage assertion. This confirms the discovery/wiring defect, not execution or failure of
the omitted TS tests. It does not establish a hosted GitHub result. No provider or credentials used.
