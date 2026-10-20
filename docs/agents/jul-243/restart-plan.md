# JUL-243 restart plan after the Round 2 Proof stop

Date: 2026-10-20
Status: Proposed; awaiting Todd's approval. Documentation only is authorized now.

## Authorization and starting point

Work remains stopped. Do not rebuild, install server prerequisites, change permissions,
run a model review, run Proof, merge, or deploy until Todd approves this restart plan.
Writing and pushing this document does not approve its execution.

The starting candidate is `5cfd728e94348f6a0b09bd0dda2ada0de3acea5f` on
`julia-build/jul-243-dashboard-a-b`, [PR #301](https://github.com/toddwyder/julia-next/pull/301).
The [19 October approved plan](jul-243-plan.md) still defines the monitoring boundary
and live journey: only Julia-launched CommandCode runs are monitored. Private session,
lock, IDE and process-file discovery remains excluded. Factory and the pending delivery
runner are not routes for this work.

The previous two rounds are exhausted. Approval of this proposal would authorize one
explicit restart attempt: baseline independent audit, test-first repairs, independent
review of the repaired candidate, then one complete OVH Proof. It is not permission to
silently reset the old round counter or keep retrying. A failed candidate review or
Proof stops this attempt: root cause, report, then another proposed plan for Todd.

## Root cause and evidence

The binding diagnosis is the [Round 2 Proof report on PR #301](https://github.com/toddwyder/julia-next/pull/301#issuecomment-6279707937).
Its evidence is retained in `.artifacts/jul-243-round2-proof/` on OVH, tied to
`5cfd728` and the clean-tree digest
`sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

- The controlled-action readiness check expected HTTP 200 and timed out receiving 0.
  Codex's official thread readback says its sandbox could not start and its escalation
  approval request failed. Julia's client responds to every server request with
  JSON-RPC `-32601`, including supported approval methods. Codex's controlled command
  therefore never started. A completed turn did not prove the requested command ran.
- Failed-Proof cleanup released the Mastra barrier and immediately shut down Mastra
  and storage. It did not await the monitored workflow promise. The workflow was still
  persisting its result and failed with `CLIENT_CLOSED`; an unhandled rejection stopped
  cleanup before `cleanup.json` was written.
- Gemini wrote `5cfd728` and approved it. Maker **Google** checking Google's work was a
  self-check, not the independent gate required by `AGENTS.md`. Its PASS cannot approve
  this restart or stand in for independent inspection of the failed journey.

Read-only checks on 20 October found Ubuntu 24.04.5, Codex 0.163.0, no `bwrap` on the
operator's PATH, no `/etc/apparmor.d/bwrap-userns-restrict` or extra-profile source,
`kernel.unprivileged_userns_clone=1`, and
`kernel.apparmor_restrict_unprivileged_userns=1`. These match a missing prerequisite
described by OpenAI; the old evidence does not contain the underlying sandbox errno.
Do not claim a particular kernel denial was proved. Confirm startup directly after
provisioning, before any model turn or paid CommandCode run.

## 1. Start the Codex sandbox and implement its approval contract

### Server prerequisites, after approval

Use OpenAI's [Linux sandbox prerequisites and Ubuntu 24.04 instructions](https://learn.chatgpt.com/docs/sandboxing#prerequisites).
An authorized operator, outside any automated runner, performs the missing setup:

```sh
sudo apt update
sudo apt install bubblewrap apparmor-profiles apparmor-utils
sudo install -m 0644 \
  /usr/share/apparmor/extra-profiles/bwrap-userns-restrict \
  /etc/apparmor.d/bwrap-userns-restrict
sudo apparmor_parser -r /etc/apparmor.d/bwrap-userns-restrict
```

Check the package-supplied profile exists before copying; retain package versions,
resolved `bwrap` path, profile-load exit code and effective kernel settings. Use the
distribution helper and loaded profile rather than disabling the AppArmor restriction
globally. Do not substitute unrestricted execution or `externalSandbox`: the latter
means isolation already exists outside Codex, which has not been established here.
If setup or its startup check fails, preserve the actual error and stop before spending.

Keep the existing shared daemon and official Unix WebSocket route. Under the same
`ubuntu` identity, PATH and working directory as Proof, use the documented
[`command/exec`](https://learn.chatgpt.com/docs/app-server#command-execution) request
to run a bounded local Node command with an explicit `workspaceWrite` policy. It must
write/read a marker inside the temporary workspace, start the same loopback HTTP
barrier, answer `/ready`, accept `/release`, and exit 0. Also check an unauthorized
write outside writable roots fails. This is a real sandbox/OS boundary check without
an AI turn; it cannot replace the later genuine Codex-turn Proof.

Create the Proof thread with explicit `cwd`, model, `sandbox: "workspace-write"`, and
`approvalPolicy: "on-request"`. Start its turn with an explicit
`sandboxPolicy: { type: "workspaceWrite", writableRoots: [workspace], networkAccess: true }`:
the controlled loopback HTTP server needs network operations. Record the effective
policy and restrict the approved Proof commands to the local barrier. Do not inherit
an unspecified sandbox/approval configuration again.

### Typed responses to supported server requests

Follow OpenAI's [app-server approvals contract](https://learn.chatgpt.com/docs/app-server#approvals),
checked against generated **installed 0.163.0** schemas. In that installed schema,
`ThreadStartParams.approvalPolicy` uses `on-request` and `sandbox` uses `workspace-write`;
`turn/start.sandboxPolicy.type` uses `workspaceWrite`. Current web examples may use
different spelling. Regenerate and validate locally instead of copying those spellings.

For `item/commandExecution/requestApproval`, preserve the request's JSON-RPC ID and
thread/turn/item identity, including `approvalId` when present. Respond with a normal
result, for example:

```json
{ "id": 42, "result": { "decision": "accept" } }
```

`accept` is one approval; `decline` refuses the action; `cancel` also interrupts the
turn. Scope any automatic acceptance to the registered Julia Proof launch and its
already authorized, exact barrier command, workspace, script digest and pending item.
Validate the actual native command/wrapper against that explicit manifest; missing,
changed or ambiguous scope fails closed. This is not permission to accept arbitrary
model commands or another client's requests. Do not grant session-wide approval or
persist an execution-policy amendment for this one command.

Known file-change requests receive their schema-defined decision; unrequested edits
are declined. Permission requests grant only an authorized requested subset; unrelated
filesystem/network access is not granted. Managed-network requests are checked as
network requests, not inferred from command preview text. Reserve `-32601` for genuinely
unsupported methods, not these documented approval methods. Observe
`serverRequest/resolved` and the authoritative final item status; an accepted request
alone is not success.

Keep request IDs, operation, scoped decision, sandbox error and nested cause in bounded,
redacted logs. Never log prompts, secrets or arbitrary command output. A passive observer
must not approve work it does not own; launch ownership and approval responsibility
must be explicit.

Write regression tests first for exact response IDs, acceptance/decline/cancel,
unowned and mismatched requests, concurrent requests, supported versus unknown methods,
and the previous `-32601` failure. Validate request/response fixtures against generated
0.163.0 `CommandExecutionRequestApprovalParams/Response` schemas. Exercise the real
shared-daemon sandbox seam too; fixtures alone do not prove execution on OVH.

## 2. Settle Mastra before shutting down storage

Use the installed locked packages' `Run.stream()` and `Run.cancel()` contracts:
`ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-streaming-workflows-stream.md`
and `reference-workflows-run-methods-cancel.md` in the same directory. The stream exposes
`fullStream` and a final `result` promise; cancellation requires a step that responds
to its abort signal. Preserve persistent LibSQL storage and `SamplingStrategyType.ALWAYS`.

Register cleanup as each resource becomes available. Attach rejection handlers to every
provider task immediately, retaining outcomes through `Promise.allSettled`, so an early
browser/assertion failure cannot leave an unhandled Mastra rejection.

On both success and failure, cleanup must follow this dependency order:

1. Release the owned barriers. On a failed journey, cancel the owned workflow/turns
   as appropriate, and abort the owned CommandCode child. The Mastra barrier must also
   release on cancellation, not merely wait forever on a promise.
2. Await `mastraRun` (the complete `monitorMastraStream` task), stream result and all
   outstanding event/snapshot writes while their storage is still open. Await the
   other owned provider tasks and child exits too. A cancellation request is not proof
   execution has settled.
3. Await the observability flush. Then shut down exporters and Mastra, stop/join the
   candidate dashboard and monitor, and only then close remaining ledger/storage
   clients. Each owner closes its own client; nothing closes a client's outstanding
   workflow work.
4. Attempt every remaining cleanup even if one fails, preserve the original journey
   error and secondary errors, and always write/read back a cleanup record in an outer
   `finally`. Record process exits and remaining owned resources. Cleanup failure
   prevents PASS; it must never replace the initial failure with a success summary.

Bound settlement/cancellation waits explicitly. If a task cannot settle, terminate and
join its isolated owning process before closing its storage; record FAIL and unfinished
work, not a successful cleanup. Do not kill the shared Codex daemon or permanent tools.

Add red tests for failure before all providers start, an assertion failure while Mastra
is held, cancellation, and delayed real LibSQL snapshot/trace completion. They must
demonstrate no client is closed early, no unhandled rejection, all owned resources
settled, and a readable cleanup record even after a failed journey. Use a real locked
Mastra workflow and durable storage; close/reopen and verify terminal events and traces.

## 3. Independent audit and candidate review

After approval, first independently audit **exact commit `5cfd728`**, including its five
changed files and their complete PR context against `b2f0dfdb83b14e64b6867f9efce858f850829177`.
Use a fresh **Anthropic** reviewer through the existing signed-in Antigravity subscription:
proposed selection `claude-sonnet-5-5-medium` (Claude Sonnet 5.5, Medium). That model is
listed by this server's CLI on 20 October; execution is not claimed yet. Approval of
this plan selects this different maker for the independent gate. It is independent
of both Gemini/Google's repair and OpenAI's earlier implementation; do not assign the
repair author to review its own work.

The audit must challenge the repaired CommandCode completion semantics, Codex failure
identity, Ajv contract typing, tests and documentation, not simply repeat the Gemini
summary. Require a disposition, with evidence, for **every** prior finding, including
Mastra retry identity, suspended-state presentation and claimed trace reconciliation.
Do not silently drop them because the second comment omitted them. Separate proved
defects from unsupported allegations and missing post-review Proof.

Then make only approved, evidence-backed repairs test-first. Run the package suite,
focused JUL-243 suite, affected real-service contracts, typecheck, framework lint and
production build. Retain commands, exit codes, skips, versions and exact candidate
commit/dirty-tree digest. Review the resulting complete candidate with the same
independent maker in fresh Standards and Spec contexts, following the adversarial-review
and code-review skills. Execute concrete counterexamples, audit test discrimination,
account for every changed file and all five coding-standard checks. Record model,
maker, conversation IDs, findings and scoped verdicts on PR #301; re-read its head after
each decision. Gemini's earlier self-check never becomes an independent PASS.

Preserve the approved review-then-Proof order: the pre-Proof code verdict can pass,
but end-to-end OVH evidence and final merge authorization remain unverified until the
next section passes on that identical candidate. No model fallback to paid API keys,
credit purchase or subscription upgrade. Keep the existing $1-per-card reviewer limit;
this restart does not replenish it. If the subscription/account/location/budget cannot
support the selected independent reviewer, stop and report that gate unavailable.

## 4. Exact OVH Proof and finish line

Keep the 19 October live journey. Repair its execution and cleanup, not its acceptance
criteria. Use the existing `proof/jul-243.ts` entrypoint through the server's restricted
Julia-vault operator route, then drop to the `ubuntu` Proof identity. SSH/sudo stay outside
the automated Proof. Use a new evidence directory, for example
`.artifacts/jul-243-2026-10-20-restart-proof/`; preserve the old failed evidence. Record
this as a new **approved restart attempt**, not a retrospective rerun of old Round 2.
The script's legacy round field can be `1` only with that explicit restart identity.

Before launching: pin candidate SHA/dirty digest, OS and service/runtime versions,
Codex 0.163.0 schema hash, CommandCode 1.72.3, locked Mastra versions, daemon endpoint,
effective sandbox/approval policy, database path, persistent configuration and disabled
sampling. Confirm sandbox startup and signed-in credentials without a model call.
Record the actual remaining CommandCode credit; the original $5 is not a fresh allowance.
If balance cannot be established, do not invent it or start another paid run.

Run the checked candidate's `npm run proof:jul-243 -- <absolute-evidence-directory>`
from `ops/mastra-agents/reviewer` with `JULIA_REVIEW_ROUND=1` and the recorded restart
identity. Start a separate dashboard child with `JULIA_CONTROL_PORT=0` and an isolated
persistent database; do not replace production to make the check pass.

1. Start a genuine Codex turn through the shared daemon. Its controlled foreground
   command is `node <workspace>/barrier.cjs <codex-port>`; the loopback server holds for
   release, with the existing 90-second upper bound. Prove its native command item is
   in progress and `/ready` returns 200; an agent message or completed turn is insufficient.
2. Launch one real CommandCode headless run through Julia, **at most six turns**. Request
   exactly three separate sequential `shell_command` calls: `pwd` with
   `cwd=<workspace>/does-not-exist`. Require three genuine identical structured tool
   errors, then the same run's foreground `node <workspace>/barrier.cjs <command-port>`
   action, also bounded to 90 seconds. Do not fake errors, add retries to reach three,
   inject cards, edit timestamps or read private provider files.
3. Hold a real Mastra `jul-243-proof` workflow at its `controlled-barrier` step, using
   the persistent exporter, explicit launch metadata and always-on tracing. All three
   provider runs must be live together. Verify both native HTTP barriers by name/port
   so a readiness failure identifies the provider rather than only reporting 0.
4. In a real 390-pixel browser, require dashboard HTTP 200, three provider cards together,
   both `Working` and `Looks stuck`, exact approved copy, outcomes/show-all behavior,
   short single-line timestamps, no horizontal overflow and no unexpected console or
   page errors. Save screenshot, API response, native event IDs/statuses and child/service
   process state, all tied to the candidate. Preserve the deliberately nested non-secret
   provider error and its root cause in logs.
5. Release both HTTP barriers and Mastra's step. Await authoritative native terminal
   events and provider tasks; require live cards to disappear while histories remain.
   Close/reopen the browser, stop/join the candidate dashboard, then start a fresh
   dashboard process on the same database. Open a fresh browser again: HTTP 200, empty
   live list, clean console. Reopen storage and retrieve complete event histories and
   the real flushed Mastra trace/step. Run and read back the dependency-ordered cleanup.
6. Re-read SHA/digest and fail if anything changed. Save final result, provider-labelled
   failures, exit codes, cleanup and retention readbacks even on failure. Capture native
   CommandCode usage/final result on every exit path. Export the exact session through
   its documented CLI if interrupted; distinguish committed cost subtotal, estimates
   and actual billing. The prior $0.001721022 subtotal excluded an interrupted turn;
   never claim it was the full bill or assume unknown spend was zero.

Only a passing independent code review **and** this complete Proof permit the previously
authorized merge/deploy finish line. Post evidence and cost to PR #301, confirm CI and
the reviewed head, merge it, delete the branch, deploy the resulting `main` commit to
OVH, restart the existing service, and verify the actual Tailscale dashboard returns
HTTP 200 with a clean browser console. Record deployed SHA. On any failed review,
Proof or cleanup, leave production alone, stop and report root cause; no extra round
is implied by this plan.

## For Todd

The server needs Codex's Linux sandbox helper and Ubuntu setup before another run.
Julia must answer approved Codex requests and wait for Mastra before closing its records.
A different maker will independently review Gemini's code and the repaired candidate.
The same three-agent server test must pass before merge or deployment; nothing restarts until you approve.
