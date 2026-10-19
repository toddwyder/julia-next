# JUL-243 restart plan — official lifecycle interfaces only

Date: 2026-10-19  
Status: Part 1 research and plan only. No implementation is authorized until Todd approves this document.  
Starting point: PR #301 at `8368117fe7d2f25d0280deb1a8fa7727acfca467` and the evidence in `C:\Dev\handoffs\2026-10-19\jul-243-root-cause.md`.

## Decision the plan asks Todd to approve

The dashboard will report **Julia-monitored agent runs**, using supported lifecycle/event interfaces. It will not claim that saved transcripts, editor processes, lock files, or log text prove an agent is running.

That distinction matters for CommandCode. CommandCode 1.72.3 has an official event stream for a run Julia launches, but no official global observer that can attach to every arbitrary interactive session already running on the machine. The implementation will therefore launch monitored CommandCode work through its documented headless interface. Supported interactive hooks can be added later for sessions that start with the hook configured, but they cannot retroactively or completely observe arbitrary existing sessions.

For Codex, the installed 0.163.0 CLI does expose a shared app-server daemon and a documented protocol for listing threads and receiving lifecycle events. For Mastra, Julia owns the runtime and can attach to its documented streams, workflow status, and persistent observability store.

## Research method and version evidence

One low-cost research agent was assigned to each provider. Each began at the provider's complete official documentation index rather than a targeted search and then checked the installed version locally. No private session, lock, IDE, or log file was used as documentation.

| Provider | Installed version | Official index read first | Version qualification |
|---|---:|---|---|
| Codex | `codex-cli 0.163.0` | [Codex documentation](https://developers.openai.com/codex/) and its [complete machine-readable index](https://learn.chatgpt.com/docs/llms.txt) | The web documentation is current rather than release-pinned. The installed CLI supplies `app-server generate-json-schema`/`generate-ts`; OpenAI documents those outputs as specific to the installed Codex version. Part 2 will generate and test against the 0.163.0 schema. |
| CommandCode | `command-code 1.72.3` | [CommandCode documentation](https://commandcode.ai/docs) | CommandCode does not publish a 1.72.3-tagged docs index. The installed package's CLI help and bundled `headless.md`, `hooks.md`, and `sessions.md` verify the selected interfaces. The live Mods catalog is explicitly experimental and not version-pinned, so it is not the production contract. |
| Mastra | `@mastra/core 1.75.0`, `@mastra/observability 1.20.1`, `@mastra/libsql 1.25.1` | [Mastra's complete documentation index](https://mastra.ai/llms.txt) | The web docs call themselves the current reference, not a versioned snapshot. Exact installed declarations verify tracing events, observability storage queries, and `MastraStorageExporter`; tests will compile and run against the locked installed packages. |

## Shared model and definitions

All three adapters will emit the same Julia-owned append-only event shape, but they will not pretend that the providers have the same native record format. Each event will preserve provider, provider run/thread ID, Julia launch ID, explicit card/role/model/stage/round metadata, provider event kind, action ID/type/name, provider status, timestamp, and an optional bounded error code/message. Card identity and role metadata will be registered when Julia launches a run; they will never be extracted from prompt text or a session filename.

The dashboard terms will mean:

- **Running:** an official start/in-progress event has been observed and no matching official terminal event has been observed. An owned child exiting or a provider connection closing without a terminal event becomes an explicit `disconnected`/`unknown` terminal condition; it is not silently treated as healthy. Idle historical sessions are not running cards.
- **What it did:** completed or in-progress structured actions supplied by the provider, such as a command item, tool call, file-change item, workflow step, or model step. Labels come from event type plus structured fields. Julia will not search arbitrary stdout, prompts, or prose to invent an action or outcome.
- **Failed:** the provider reports an error/failed/canceled/interrupted status, or an owned CLI returns one of its documented non-success results/exit codes. Successful output that happens to contain text such as `exit_code: 1` is not a failure.
- **Kept records:** events are written at receipt to persistent server-side storage, independently of browser requests. Completion removes a run from the live-card query but does not delete its event history. Records survive dashboard and service restarts until the operator deliberately removes the database under the server's retention policy.
- **Working:** the run is officially running, its last progress event is under 15 minutes old, and it has fewer than three consecutive identical explicit failures.
- **Looks stuck:** the run is officially running and either has had no official progress event for 15 minutes or has three consecutive identical explicit failures. A failure fingerprint is built from provider, structured operation/tool/step name, provider error/status code, and normalized error category—not arbitrary output text. A new turn/run/action lifecycle event advances the activity clock.

Raw text deltas will not continuously reset the inactivity clock. Run/turn/item/tool/step lifecycle events will. This makes the threshold about observable progress while avoiding both the old stale-action bug and a false appearance of progress from repeated text streaming.

## Codex 0.163.0

### Official features found

- [App Server](https://learn.chatgpt.com/docs/app-server) provides thread/turn/item lifecycle requests and notifications, streamed events, explicit turn completion states, thread status changes, and persisted thread/history reads. The installed CLI also exposes `codex app-server daemon`, `proxy`, version-local schema generation, and `codex agents`, described by its help as browsing all sessions on the shared local app-server daemon.
- [Hooks](https://learn.chatgpt.com/docs/hooks) provides session, subagent, stop, interrupt, prompt, tool, permission, and compaction boundaries. Hooks are callbacks, not a replayable global activity feed; `transcript_path` is explicitly not a stable interface, and async hook notifications are not all exposed through app-server.
- [`codex exec --json`](https://learn.chatgpt.com/docs/non-interactive-mode) emits JSONL thread/turn/item/error events to its caller and has an explicit `--ephemeral` mode. It is useful when Julia owns a non-interactive child but is not a general subscription to other runs.
- [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk) wraps local thread execution; the docs direct richer clients needing streamed lifecycle, history, and approvals to app-server.
- [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) exposes progress in supported Codex clients. Machine-readable subagent identity is available through app-server collaboration/thread events rather than through the UI description itself.
- The hosted OpenAI Agents API also has sessions, events, observability, and traces, but it is a separate product and is not evidence about local Codex CLI sessions. It will not be used for JUL-243.

### Interface selected and exact meanings

The dashboard will connect as an app-server client to the shared Codex daemon. On connection it will use the installed 0.163.0 schema, list/read threads to establish current state, and subscribe to thread/turn/item and collaboration notifications. After reconnect it will reconcile from official thread/turn/item reads; it will not try to replay private rollout files.

- **Running:** app-server reports an active/in-progress thread/turn; terminal completed, interrupted, failed, canceled, idle, or system-error state ends or changes the live card according to the protocol's explicit status.
- **What it did:** authoritative item lifecycle records—commands, file changes, MCP calls, web searches, messages/plans where suitable, and subagent collaboration—project into action rows. `item/completed` is authoritative for the final action status.
- **Failed:** explicit failed/interrupted turn status, failed item status, or protocol error. The stored failure retains the structured error detail supplied by app-server.
- **Kept records:** Codex's official persistent thread/history remains the provider record; Julia also stores the received typed lifecycle events and stable provider IDs server-side so dashboard history is not dependent on an open browser or a currently loaded thread.

App-server does not document a heartbeat or guarantee replay of every notification dropped while disconnected. Julia will use explicit protocol state plus reconciliation, and will surface a connection loss as unknown/disconnected. It will not invent liveness from process lists, writer locks, or file modification time.

## CommandCode 1.72.3

### Official features found

- [Headless mode](https://commandcode.ai/docs/headless) emits an NDJSON event stream for `-p ... --output-format json`, followed by a final result with success/error/max-turns semantics; the CLI has documented non-zero exit categories. This interface is present in the installed 1.72.3 help and bundled reference.
- [Hooks](https://commandcode.ai/docs/hooks) provides documented session/tool/stop boundaries and stable session IDs to hook programs. Hooks may write an audit record, but CommandCode does not supply a complete durable external event ledger for them.
- [Mods](https://commandcode.ai/docs/mods) exposes the richest in-process run/turn/model/tool/subagent event bus and an explicit persistence surface. It is marked experimental, and the exact live event catalog is not shipped in version-pinned 1.72.3 declarations, so it will not be the required production path.
- [Sessions and checkpoints](https://commandcode.ai/docs/sessions) persist committed append-only conversation history and describe entries as a tree, not a flat list. They are historical records, not a live liveness API, and interrupted uncommitted work can be absent.
- [Background tasks](https://commandcode.ai/docs/background-tasks) reports managed shell/background task IDs, status, PID, and output, but only for those tasks—not for all agent runs.
- [ACP](https://commandcode.ai/docs/acp) streams replies and tool rows to an ACP host; [IDE integration](https://commandcode.ai/docs/ide-integration) reports editor connectivity/context; and [remote control](https://commandcode.ai/docs/remote-control) streams answers to chat platforms. None is documented as a complete external agent inventory and retained lifecycle feed.

### Interface selected and exact meanings

Julia will launch monitored CommandCode work with the installed `command-code -p ... --output-format json` interface and own the child process plus its NDJSON stream. The adapter will accept only documented structured frames and the final result; unknown frames will be stored as unknown, not reverse-engineered. Hooks remain an optional later path for interactive sessions that start with the hook installed.

- **Running:** the Julia-owned child has started and the official event stream has begun, with no final result or child exit yet.
- **What it did:** structured progress/tool frames from the NDJSON stream. Action outcome comes from the frame's structured result/error, not from scanning tool output.
- **Failed:** a structured tool error, final `error`/`max_turns` result, documented non-zero exit, or premature stream/process termination. These remain distinct error categories.
- **Kept records:** Julia writes every accepted structured frame and the final result to its server-side event ledger as received. CommandCode's committed session history may remain available, but the dashboard does not parse or depend on it.

There is no official 1.72.3 global observer for arbitrary already-running interactive sessions. The alternative is an operational boundary: work that must appear on the dashboard is launched through Julia's monitored headless entrypoint. A future interactive integration may install the official hooks before session start, but it cannot promise full run events, crash detection, or retroactive coverage. PR #301's IDE heartbeat/process/session-file approach will not return.

## Mastra 1.75.0 / observability 1.20.1 / libsql 1.25.1

### Official features found

- [Observability overview](https://mastra.ai/docs/observability/overview) and [tracing](https://mastra.ai/docs/observability/tracing/overview) define trace/span execution paths, timing, tool/model/workflow operations, status, and errors. Sampling means absence of a trace is not proof that no run exists.
- [Streaming](https://mastra.ai/docs/guides/streaming) provides real-time agent and workflow start, step/tool/model progress, finish, pause/suspend, and cancel events to the connected caller. Streams are not documented as a durable, replayable liveness registry.
- [Workflow error handling](https://mastra.ai/docs/workflows/error-handling) provides explicit success/failed/suspended/tripwire results and terminal callbacks. The docs state callbacks are awaited but are not durable or retried.
- [Agent lifecycle](https://mastra.ai/docs/guides/agent-lifecycle) and [processors](https://mastra.ai/docs/agents/processors) provide supported instrumentation points around input, model, tool, and output stages; they are not a built-in global active-agent inventory.
- [Storage](https://mastra.ai/docs/storage) and [MastraStorageExporter](https://mastra.ai/docs/observability/integrations/exporters/mastra-storage) persist observability data when a durable backend is configured. The exact installed declarations expose trace/span query methods and buffered exporter retry/flush behavior.
- [Structured observability logging](https://mastra.ai/docs/observability/logging) can correlate logs with trace/span IDs. [OpenTelemetry](https://mastra.ai/integrations/observability/opentelemetry) can export traces/logs to another backend. Neither alone proves current liveness.

### Interfaces selected and exact meanings

Julia owns this Mastra runtime. It will consume the real-time stream/workflow lifecycle where the run is created, set explicit Julia card/role/model/stage/round metadata at creation, and retain the official trace/span record through the existing persistent `MastraStorageExporter` and LibSQL backend. Sampling will be disabled for dashboard-managed runs. Terminal workflow state, not trace age, decides completion.

- **Running:** a Julia-owned agent/workflow stream has emitted its start event or the workflow state is explicitly running, and no finish/failure/cancel/suspend terminal boundary or stream termination has occurred. Suspended is displayed as suspended rather than guessed to be running.
- **What it did:** structured tool/model/step events from the live stream, reconciled with trace spans for completed details. Julia-defined workflow step names remain valid because Julia owns them; generic free-form span output is not classified by regex.
- **Failed:** explicit workflow failed/tripwire/canceled result, stream error, or trace/span error status. Each retains the provider's structured status and error.
- **Kept records:** MastraStorageExporter persists traces/spans/logs in LibSQL; Julia's event ledger keeps lifecycle transitions and the trace/run IDs needed to retrieve them. Exporter flush is awaited at terminal boundaries and verified after restart.

Mastra does not document a process-independent heartbeat or global query that proves every generic agent is alive. Therefore only runs created in the instrumented Julia runtime are claimed. Other Mastra processes must be configured to emit the same official stream/trace lifecycle into Julia before they can appear; trace recency alone will never be used as liveness.

## What will be kept from PR #301

The following concepts are useful and can be retained after being separated from the unsupported discovery code:

- The dashboard route, one-card-per-run rendering structure, polling of Julia's own API, and the `Working`/`Looks stuck` presentation.
- The typed dashboard/card contract and a pure projection layer, revised to consume Julia-owned provider events rather than provider files.
- The persistent LibSQL store concept, revised into append-only event ingestion plus current-state projection. Writes occur when events arrive, not when a browser polls.
- Mastra's configured `Observability`, `MastraStorageExporter`, persistent LibSQL adapter, and official trace read path.
- The 15-minute/no-progress and three-identical-failures policy Todd settled, with the corrected progress and failure definitions above.
- The real Mastra integration-test pattern, 390 px Playwright coverage, server runbook location, and proof-artifact structure.
- Existing provider-independent UI styling that matches the approved mockup after the separate presentation defects are corrected.

## What will be dropped from PR #301

These pieces encode the failed design and will be removed rather than patched:

- All recursive reads of `~/.codex/sessions`, bounded head/tail JSONL parsing, writer-lock discovery, transcript-shape assumptions, and card-ID extraction from prompt text.
- All reads of `~/.commandcode/projects` and `~/.commandcode/ide`, IDE heartbeat/PID/process matching, newest-session selection, flat transcript parsing, and reliance on an editor process as agent liveness.
- Output regexes that infer success/failure, action labels inferred from command/prose text, and provider-specific “last serialized role” liveness rules.
- Browser-request-driven discovery/retention and any cache whose refresh is required to capture a completed run.
- Tests that bless private fixture shapes, lock/IDE heuristics, bounded transcript windows, or synthetic provider semantics.
- Framework Map claims that unpublished file formats are acceptable because fixtures pin them. The map will be rewritten to cite the official interfaces above and to keep unsupported coverage explicit.

Concretely, `jsonlFiles`, `codexLockIds`, `activeCodexFiles`, CommandCode IDE/process inspection, `sessionRows`, `readCodexActivity`, `readCommandCodeActivity`, `nativeRunning`, `commandCodeRunning`, text-regex `failed`, and prompt-derived identity logic are not reusable. The names may disappear or be replaced; their behavior will not survive.

## Separate Gemini findings included in the rebuild

- **Phone time wrapping:** use the mockup's short time form and a non-wrapping time cell, then assert at 390 px that each timestamp occupies one line and no horizontal overflow occurs.
- **Copy mismatch:** use the approved mockup text exactly, including “From the tools' own records” and the action disclosure/show-all behavior represented by the mockup.
- **Error logging:** log a bounded structured error chain (`name`, `message`, provider/run/event context, and nested `cause`) so a wrapper error cannot erase the provider/root cause. Secrets, prompts, and arbitrary tool output remain excluded.
- **Documentation citations:** every Framework Map assertion will link to the exact official page or exact installed-version declaration/help evidence. An unversioned or experimental interface will be labeled as such.

## Tests first

Part 2 begins by replacing the assumption-based JUL-243 tests with red contract tests before production edits:

1. **Common state tests:** multiple simultaneous runs; start/progress/terminal ordering; reconnect reconciliation; a new turn resets inactivity; three structured identical failures trigger `Looks stuck`; successful output containing failure-looking text stays successful; unknown/disconnected is not healthy running; completed runs leave live cards but remain stored.
2. **Codex contract tests:** generate the app-server schema with installed 0.163.0; validate fixtures against it; test thread list/read reconciliation, active and terminal turn statuses, item completion, explicit failure, subagent IDs, dropped-connection behavior, and durable ingestion without an HTTP dashboard request.
3. **CommandCode contract tests:** spawn installed 1.72.3 headless mode in a controlled local smoke run; capture real NDJSON frames and final result; test success, structured tool failure, non-zero/premature exit, two concurrent runs, and persistence. No private directory is read.
4. **Mastra contract tests:** run the locked packages with real persistent storage; assert stream/workflow lifecycle, success/failure/suspend states, trace/span details, exporter flush, restart retrieval, and disabled sampling for dashboard-managed runs.
5. **Boundary tests:** fail CI if production code references Codex session/lock paths or CommandCode project/IDE paths. Test that no ingestion depends on `/api/agents` polling.
6. **UI tests:** 390 px screenshot and DOM assertions for three provider cards, both statuses, exact mockup copy, short single-line times, show-all behavior, outcomes, no horizontal overflow, and no console errors.
7. **Logging tests:** nested provider error causes survive structured serialization while secrets and unbounded output do not.

The package suite, JUL-243 suite, typecheck, lint, and production build must all pass. Test evidence will pin the candidate commit and installed provider versions.

## OVH proof plan

Proof will use the candidate commit on OVH and only the selected official interfaces. Before the journey, the evidence bundle will record the Git SHA, OS/service version, Codex/CommandCode/Mastra versions, app-server schema hash, and configuration showing persistent storage and no observability sampling.

The live journey will keep three genuine provider runs active at once:

1. Start a Codex turn through the shared app-server and hold it at a controlled long-running action so its official turn/item state is live.
2. Start a CommandCode 1.72.3 headless run through Julia. In the `Looks stuck` journey it will produce three identical genuine structured tool failures, then remain in the same live run at a controlled pending action; the proof will not inject a dashboard row or edit timestamps.
3. Start a real Mastra workflow/agent stream with persistent tracing and hold it at a controlled step/barrier so its official workflow/stream state is live.

The dashboard must simultaneously show at least one Codex, one CommandCode, and one Mastra card, with both `Working` and `Looks stuck` present. Evidence will include provider event excerpts with IDs/statuses, the API response, process/service state, a 390 px screenshot, HTTP 200, no browser-console errors, and an assertion that timestamps do not wrap.

After capture, the proof will release the controlled actions and observe official terminal events. It will close/reopen the dashboard and restart the dashboard service, then verify the completed runs are absent from live cards but their stored event/trace records remain queryable. That proves retention is event-driven rather than browser-driven. Logs will also include a deliberately nested, non-secret provider error to prove its root cause is preserved.

No hand-built rows, private transcript reads, lock files, IDE files, altered clocks, or synthetic provider fixtures count as server proof.

## Review, two-round limit, merge, and deployment

Each candidate round follows this order: tests and static checks; Gemini adversarial review through signed-in Antigravity; then the OVH proof above. The PR comment will record the exact Gemini model name, maker **Google**, Antigravity conversation/run identifier, candidate SHA, findings, and verdict. A non-Gemini model does not satisfy the gate.

If round 1 finds a defect, only evidence-backed repairs within this approved design are made, the tests are extended first, and the full Gemini review and OVH proof are rerun as round 2. If round 2 fails either gate, work stops and reports the new root cause; there is no third round.

Only a passing Gemini verdict and passing OVH proof authorize merging PR #301. After merge: delete its remote branch, deploy OVH from the resulting `main` commit, restart the service, and confirm the dashboard loads with HTTP 200 and a clean browser console. The deployed SHA and final dashboard check go on the PR.

## For Todd

Codex will use its shared app-server; Mastra will use its live stream, workflow state, and stored traces.
CommandCode can be reliable only for runs Julia launches through its official JSON event stream; it cannot officially observe every arbitrary existing terminal session.
The old session-file, lock-file, IDE-file, process, and output-text guesses will all be removed.
Server proof will show three real provider cards together, both statuses, and records surviving a service restart.
Please approve this monitored-run boundary and plan before Part 2 starts.
