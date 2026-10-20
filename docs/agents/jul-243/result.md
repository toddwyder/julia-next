# JUL-243 result for Todd — 20 October 2026

The restart is incomplete and stopped on a real CommandCode preflight failure. All handoffs are on GitHub. Nothing was sent to the laptop.

## What happened

Created a clean branch from current main and opened [PR #303](https://github.com/toddwyder/julia-next/pull/303). Closed #301 unmerged with a pointer to #303 and deleted its branch. No Gemini `5cfd728` commit, private discovery code or controlled-barrier Proof rig was carried over.

Installed Ubuntu's Codex sandbox prerequisites and loaded the bubblewrap AppArmor profile. A real command executed successfully inside Codex 0.163.0's workspaceWrite sandbox before any model turn: [raw result](evidence/sandbox-command.json). The installed schema confirms no-approval policy `never`.

Twelve focused tests pass, covering long-running commands, Stopped states, idle threshold, distinct/repeated failing commands, retained Finished history after reopening storage, a real suspended Mastra workflow, and delayed persistence/cleanup failure recording: [test output](evidence/focused-tests.txt). This is a partial self-check, not independent review or full Proof. No current phone/browser or full-suite claim is made. Checkpoint source commit: `53ff4ac24aa12ab1599bd4567af847dcb8b94678`.

Then CommandCode's account command failed before it could report the balance:

```
Error: ENOENT: no such file or directory, open '/opt/node-v24.14.1/lib/node_modules/command-code/node_modules/highlight.js/lib/languages/mipsasm.js'
```

[Failure evidence](evidence/commandcode-preflight-error.txt) and [root-cause analysis/proposed plan](jul-243-root-cause.md) are pushed. The file subsequently existed and CommandCode reported 1.84.0 rather than the earlier 1.72.3. I omitted the no-auto-update flag in preflight; an automatic update is plausible but its provenance is not proved. No model was invoked. No package repair was made after this failure.

## Removed and retained

Repository: #301's branch was deleted; a fresh main-based branch excludes the failed discovery and barrier approaches. The approved plan replaces the old plan; only the historical root-cause doc and selected pre-Gemini lifecycle/UI code were carried over, with every kept file and reason listed in #303. Tests and cleanup helper were written anew. Superseded JUL-243 docs were not brought over.

Server: no old server files/packages/services have been removed yet. [Partial inventory](removal-list.md) names the items found and outstanding removal/search work. The retained Round 2 evidence is untouched. Permanent parts, sign-ins and the production initialization database remain. New sandbox packages/profile remain because the settled design uses them. No independent no-trace check has passed.

## Review, Proof and deployment

Review verdict: not run; no reviewer was invoked and no reviewer commits were made by this attempt. Gemini review of the complete candidate and removal list remains required through `review/pr-303`; no request has yet been issued for this unfinished checkpoint. The unrelated PR #302 review remains queued until JUL-243 finishes, as Todd instructed.

Proof: not run. The sandbox record and focused tests are prerequisite/self-check evidence only. Previous failed Round 2 evidence remains at `.artifacts/jul-243-round2-proof/` on OVH and [the original report](https://github.com/toddwyder/julia-next/pull/301#issuecomment-6279707937).

Cost: **$0** in new model calls, credits or purchases. No model inference or reviewer invocation ran. This says nothing about historical billing. The account balance is unverified; free-model-at-zero-credit success is not claimed.

Deployed SHA: **none from this restart**. Production was not merged, deployed or restarted. Existing julia-control.service remains active/running, PID 50029. Its previous deployed SHA is unestablished because `/opt/julia-control/reviewer` is not a Git checkout.

Open: approval of the failure plan; stable documented CommandCode installation; complete server cleanup and exact removal manifest; remaining implementation and regressions; complete real free-provider Proof including actual fifteen-minute idle, phone browser/clean console and dashboard-restart history; independent Gemini review; CI; merge; branch cleanup; deployment and live Tailscale browser confirmation. Nothing is marked finished.

## Proposed next plan

Replace the affected CommandCode installation as a whole with pinned 1.72.3, preserve its sign-in, disable automatic updates on every call, verify startup and account access without inference, then resume the already approved restart. Do not patch a missing dependency file in place. Continue test-first, complete all removal and real Proof requirements, and obtain review on the identical candidate before merge/deploy. Rebuild nothing until Todd approves this failure plan.
