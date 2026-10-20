# JUL-243 result for Todd — 20 October 2026

**Outcome: failed OVH Proof; stopped pending approval of the proposed repair plan.** Nothing was merged or deployed. All handoffs are pushed GitHub files.

Created [PR #303](https://github.com/toddwyder/julia-next/pull/303) from current main. Closed #301 unmerged with a one-line pointer to #303 and deleted its branch. The new PR lists every kept #301 file and its reason. No Gemini `5cfd728`, private-file discovery or controlled-barrier Proof rig was carried over. The approved plan replaces the prior plan, the historical root-cause record remains, and superseded JUL-243 docs were not copied.

## Removed from OVH

[204 exact earlier-run paths](server-removed.json) were removed and verified absent: obsolete scripts, smoke/test workspaces and databases, old evidence except Round 2, temporary review tooling and duplicate handoffs. [Removal and retention details](removal-list.md) and [24 retained browser packages](retained-browser-packages.json) are recorded. Permanent prerequisites, sign-ins, production initialization state and Round 2 evidence remain.

CommandCode was replaced as a whole with current stable **1.84.0**, preserving sign-in and disabling updates for the rest of the run. That fixed the transient incomplete-installation error without patching a dependency file. Startup/account access passed without inference. Real free-model completion and mid-request cutoff contracts passed. This was the smallest reversible machine repair authorized by Todd's continuation decision.

Codex’s Ubuntu sandbox prerequisites were installed and its AppArmor profile loaded without disabling the namespace restriction. Current-stable Codex **0.163.0** ran a real workspaceWrite command successfully before any model turn. Its generated schema confirms no-approval value `never`. No approval-handling code was added.

## Proof and review

Failed candidate: **`3d68cef9dfef59042769cafd9538992c474c9339`**, clean-tree digest recorded in [identity](evidence/proof-2026-10-20/identity.json).

The real Proof exposed concurrent ledger `SQLITE_BUSY` errors and overlapping Playwright navigations. Its completion wait then stranded the process; it exited **13** without writing its own failure/result/cleanup records. [Root cause and proposed plan](jul-243-root-cause.md) describe the demonstrated defects and unproved cases. No source repair or repeat Proof followed this failure.

Evidence: [manifest](evidence/proof-2026-10-20/manifest.json), [console](evidence/proof-2026-10-20/console.log), [native Codex commands/cancellation](evidence/proof-2026-10-20/operator-native-cancellation.json), [CommandCode result](evidence/proof-2026-10-20/commandcode-native.json), [Mastra paused state](evidence/proof-2026-10-20/mastra-paused.json), [retained real trace](evidence/proof-2026-10-20/operator-mastra-traces.json), and [operator cleanup](evidence/proof-2026-10-20/operator-cleanup.json). Raw databases remain at `.artifacts/jul-243-proof-2026-10-20/` on OVH.

Operator cleanup interrupted the owned long Codex turn through the official API, confirmed terminal native state, terminated/joined only the identified Proof process tree and removed its temporary workspace. No owned process remained at readback. These operator records do **not** turn the missing script cleanup record into a pass; Mastra result-promise settlement was not proved. Production remains active, PID 50029.

Before full Proof, **21 focused tests**, **three real provider contracts**, package tests, typecheck, framework lint and production build passed. These are maker checks and did not catch the real concurrency failures; they do not approve delivery. The complete long-wait/15-minute-idle/dying/restart/console Proof journey did not pass.

**Independent review verdict: not run.** Failed Proof blocks the review gate. No Gemini reviewer was invoked and no reviewer commits were added. `review/pr-303` review request/findings remain outstanding. PR #302's unrelated review remains queued until JUL-243 finishes.

## Cost, deployment and open work

**New cost: $0.** CommandCode used documented free `poolside/laguna-s-2.1-free`; Codex used the existing ChatGPT sign-in. No paid API fallback or credit purchase was used. The account's real observed extra-credit balance was $5; Todd approved free-model use with $0 spend instead of requiring a zero balance. No balance was altered. Historical billing is not claimed to be zero.

**Deployed SHA: none from this restart.** No merge, deployment or service restart occurred. The existing deployed SHA is unestablished because `/opt/julia-control/reviewer` is not a Git checkout.

Open: approve the [proposed repair plan](jul-243-root-cause.md); fix and guard the ledger/browser/completion/cleanup failures test-first; establish the real native long-wait and idle seams; rerun complete Proof on a new pinned candidate; obtain independent Gemini review and repository/server no-trace confirmation; complete CI, merge, both branch deletions, deployment and live Tailscale dashboard/clean-console verification. Failed-Proof evidence remains retained; no failed requirement is marked complete or silently skipped.
