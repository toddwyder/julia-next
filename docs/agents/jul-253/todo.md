# JUL-253

The earlier parking decision is superseded by Todd's instruction to build all independent work and request only the account actions.

## Feature playbook

1. `how` over the affected subsystem. Done. The Sol explorer traced jobs, stock connection resolution, transport and the card ledger.
2. `architect` for parallel design exploration. Two shapes were compared: shared stock stores and a separate provider/accounting service. Selected shared stores. Sol supplied the initial exploration; the DeepSeek review still has to challenge that design against the final candidate.
3. Write the throughput checkpoint as four todo items.
   - Blocking first steps. Source/lockfile lookup and credential-path inspection are complete. Todd's authorizations run alongside independent work.
   - Independent workstreams. Sol implemented the hard accounting changes. DeepSeek implemented pstack role/review changes through the guarded adapter. Comment review ran separately.
   - Shared mutable state. A common card-keyed ledger owns all production roles and runs. Code changes and mutation probes were serialized.
   - Smallest safe decomposition. Retained the stock SDK, one credential store and one accounting boundary instead of adding a provider service.
4. Delegate code-writing to a subagent using your configured feature model. Done. DeepSeek completed the scoped pstack implementation. Sol handled the hardest ledger/transport work.
5. Verify on the matching surface. Local tests, mutations, SDK learning tests and CommandCode requests run. Both subscription requests remain pending account authorization.
6. Rebase into small, ordered commits. Stack follow-ups. Implementation and evidence are being committed together after the checks.
7. If the design is contested, `interrogate` before shipping. DeepSeek adversarial review is next. No full-review pass is claimed while subscription proof is missing.
8. Run **Opening a PR**. Pending publication and exact-head CI.

## Card work

- [x] Replace the zero-spend trial with the $2 total across roles and runs.
- [x] Retain unknown reservations and prevent concurrent overspending.
- [x] Configure prices, sources, context/output bounds and long-context price tiers.
- [x] Configure the agreed Sol/DeepSeek/Beam split.
- [x] Add stock ChatGPT device sign-in and Claude hosted paste-code sign-in commands.
- [x] Start both stock sign-ins and give Todd the account steps.
- [x] Record the settled Claude ADR and remove the active $0 instructions.
- [x] Pass the affected tests, SDK learning checks and mutation probes.
- [ ] Complete Todd's ChatGPT account approval. The first device code expired; issue a fresh code before the next handoff.
- [ ] Complete Todd's Claude Pro account approval using the already-started stock flow.
- [ ] Verify each subscription with a real request. Do not use another Claude connection if Pro fails.
- [ ] Publish review/evidence and get exact-head CI green.

## Restart completion

- [x] Inherit the exact-head green result for `ab6e94a`.
- [x] Refresh the standalone server checkout and drive JUL-255 through the real Tailscale Start page.
- [x] Retain the terminal failure, exact ledger totals, clean worktree readback, and browser evidence.
- [x] Restore the normal route and services after the failed attempt.
- [x] Add a red/green regression and repair the builder/host ownership boundary.
- [ ] Publish the boundary repair and retained evidence, then obtain exact-head CI.
- [ ] Obtain Todd's approval for the post-repair practice-card triage brief before creating a new issue.
- [ ] Complete the final real Start proof on a fresh approved card.
- [ ] Run the final adversarial review against that exact successful candidate and proof bundle.

## Structural fence repair

1. [x] Reproduce it yourself on the matching surface via the control skill (Non-negotiables), even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
2. [x] Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with `how` over the affected subsystem and the **why** skill for regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Drive a long or stubborn hunt with Cursor's `/loop` command. Confirm the surviving *mechanism* with runtime evidence before the step-3 architect/interrogate fan-out.
3. [x] Plan the fix. If it crosses a function boundary, `architect` first. Delegate implementation to a subagent using your configured bug-fix model (default `grok-4.7-xhigh-fast`) with a specific scope.
4. [x] Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
5. [x] Stage the commits so the failing repro lands before the fix in git history. See the **tdd** skill for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear.
6. [ ] Run **Opening a PR**.

- Blocking first steps. Define the sparse-checkout, command sandbox, plan artifact, and model-table contracts; add executable red attempts.
- Independent workstreams. Architecture and history investigations run in parallel while the maker builds the red harness.
- Shared mutable state. Only the maker edits the checkout; investigators are read-only. Server route changes remain serialized around the final proof.
- Smallest safe decomposition. Land the red fence tests first, then checkout isolation, command isolation, planning evidence, and research-role routing as separately verified units.
