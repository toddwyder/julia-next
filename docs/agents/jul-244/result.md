# JUL-244 result — 20 October 2026

Not delivered. Two real Proof rounds failed; the existing AGENTS.md two-round stop policy applies. No independent review, merge, source deployment or privileged restart occurred. Production remains active on its prior deployment. Awaiting approval of the [restart plan](restart-plan.md); the [root-cause report](root-cause.md) proposes no fix.

Latest implementation candidate: `c208766b40f6f7c5b1936ed97286f8db40e16441`. Round 1 failed before inference while resuming a thread with no rollout. Round 2 recorded real context use, but the model reported no `update_plan` tool, ended with no checklist, and the Proof timed out awaiting a plan event. The real compaction and CommandCode-through-Mastra portions were not reached. Cleanup's attempt to interrupt the already-ended turn also failed; dashboard exit and further maker readback are retained.

Six focused checks, typecheck, framework lint and build pass. Earlier package run: 182 pass, one existing opt-in skip. Fixture success does not satisfy the missing real evidence. No paid API/CommandCode call or purchase; one signed-in Codex model turn, with no separate API charge. Reviewer spend $0.

Reversible fixes made in the permitted repair round: capture native evidence through the registered monitor instead of resuming an unmaterialized second observer; preserve checklist state during reconciliation. These fixes remain unreviewed on the draft branch and are not deployed.

[evidence/sha256.json](evidence/sha256.json) identifies raw command output, native records, candidate identities, initial phone screenshot and checksummed deployed-file/service self-checks. All server checks are maker self-checks, never independent review. The six deployed affected modules contain no JUL-244 deltas; contracts.ts matches the earlier JUL-243 deployment rather than later main.
