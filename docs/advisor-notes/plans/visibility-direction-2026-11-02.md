# Visibility direction, 2 Nov 2026 (advisor session, ~12:37 PT)

Read with `claude/session-handoff-2026-11-02-1105.md`. Written because Todd said yes (12:37) to recording the long-term direction and keeping the stopgaps throwaway.

## The problem (Todd confirmed, 11:55)
See what the machine is doing, and know when it stops. Case: the JUL-319 build exited after ~27 s (08:18:35 to 08:19:02 PT) and nobody knew for 34 minutes.

## Long-term direction (Todd's yes, 12:37)
The machine should be one Mastra workflow with the build as one step, so one stock tool shows every stage the same way. Today there are three mechanisms: build = headless Mastra Code session (`mastracode -p`, checklist in `~/.local/share/mastracode/mastra.db`); Shipping / Remediation / merge = stock Mastra workflows with per-run files; `start-machine` = glue script with its own state file. **Cost and timing of the unified machine are not decided.** An earlier session sketched it as a parent workflow, a small Mastra server and Studio hosted on the server, plus the build as a step (the dashboard's worker-core slice). That sketch is a proposal, not a decision.

## Stock-only rule (Todd's yes, 13:02)
Rule for the unified machine: **add, never edit stock Mastra or pstack, with one listed exception** (the server-side retry patch) until Mastra fixes it upstream. Option A of three (B: drop the patch and accept one retry; C: switch to a model service that doesn't cut streams, likely costs more).

Research behind it (13:00, cheap subagents; key lines checked by Claude):
- pstack: `.agents/` byte-identical to mirror `fad8d01`; CI `scripts/check-pstack-pin.mjs` enforces it. No custom agents; steps call stock `subagent` (`agentType: 'execute'`). No patches/overrides/copies of Mastra in the repo. `docs/pstack-deviations.md` has 14 rows, mostly settings.
- Overwrite 1, **thread table edit**: `machine/remediation/builder.mjs:69-74` (`makeNewest`) updates `mastra_threads.updatedAt` so boot picks the wanted thread. Stock replacement exists in versions already installed: boot with `createInitialThread: false` (code-sdk 1.14.0 `index.js:1169`), then `session.thread.switch({ threadId })` (core `agent-controller/session.d.ts`). Throws ThreadLockError if another process holds it. **Not tested; not decided to change.**
- Overwrite 2, **retry patch**: `~/.local/share/mastracode/patches/apply-retry-fix.py`, re-applied by a SessionStart hook (`docs/harness/mastra-code.md:87`). Patch file not read (server only). Stock `findMatchingPolicy` walks the error cause chain but returns the default policy early when the outer error carries retryable provider metadata (core 1.78.0 `agent-Blan8B5o.js:1055-1072`; same shape in latest 1.81.0 `agent-DtdQ6un6.js:1393-1410`), so the inner ECONNRESET-type cause that earns `MASTRACODE_TRANSIENT_CONNECTION_MAX_RETRIES = 10` (code-sdk `index.js:90`, hardcoded, no env var) is not reached. Inferred still needed on latest. Core supports `modelSettings.timeout` (totalMs/stepMs/firstChunkMs), but mastracode sets only `{ temperature: 1 }` and exposes no option.
- **Gap:** the retry patch is not a row in `docs/pstack-deviations.md`.
- Added-not-overwritten mess: duplicate retry loops (`machine/shipping/workflow.mjs:45-57`, `machine/merge/retro.mjs:70-80`), three separate Mastra stores, glue scripts.
- Latest stable: code-sdk 1.17.0, core 1.81.0, mastracode 0.48.2 (30 Oct). Installed per docs: 1.14.0 / 1.78.0 / 0.47.1.

Follow-ups for A (not started): add the deviation row; file an upstream request with Mastra (cause-chain early return; expose per-call timeout in mastracode).

## Stopgaps (throwaway, to be removed when the unified machine exists)
1. **Checklist viewer (Todd said "ok lets do that", 12:33). Built by the server agent, 12:41.** Datasette 0.65.5 in `~/datasette-viewer/venv`, systemd user service `datasette-viewer` (linger on), query at http://100.119.112.9:8801/mastra/builder_checklists, bound to the Tailscale address only. Read-only (`mode=ro`; writes rejected, agent-tested). Installed system package `python3.12-venv` with sudo. Unchecked: live updates during an active build; Claude cannot reach the URL.
   Follow-up (12:47): of 51 lists, two come from headless builds by opening-prompt text (no DB field marks headless): JUL-290 build `a8eb407a` 7 items **0 done**, JUL-317 `86cbdffc` 6/6. About a dozen headless Shipping/remediation lists. JUL-319 build `3f965b3c`: no list. Conclusion: viewer is a partial window (only when the builder keeps a list) and cannot tell running from stopped; JUL-320 covers stops.
2. **Stop comment: JUL-320** filed in Triage 12:39 with Todd's yes. `start-machine`'s `stop()` (scripts/start-machine.mjs lines 136-141) saves state and logs only.

## Verified this session (sources)
- Studio would not show running vs stopped for a mounted builder. Read from files: `@mastra/playground-ui` 67.0.0, `@mastra/server` 1.81.0, `mastra` CLI 1.37.0 (server agent, scratch folder `/tmp/studio-research` on the server, left in place; Todd decides when it goes). `code-agent` WOULD appear in GET /agents after mount init. Studio has no controller/session pages. Traces list refreshes about every 10 s. On code-sdk 1.14 a mounted builder drops traces unless the host supplies observability; 1.17 passes it.
- The server has `GET /agent-controller/:controllerId/active-runs`; Studio does not call it.
- Checklists: Mastra task tools (`task_write` replaces the whole list; `task_update` changes one item; `task_complete`; `task_check` reads). Stored in `mastra_thread_state`, type `task`, one value per thread (latest state only, no history). `mastra.db` opened read-only with no lock: 51 task lists. The JUL-319 build thread (3f965b3c...) has none (server agent report). The nearby JUL-319 list belongs to a separate investigation thread.
- Kickoff prompt tells the builder to follow poteto-mode, whose rule is to open a todolist; the repo's adapter doc maps that to the task tools.
- Existing stop-ping fires only on Mastra Code Notification events, not on process exit.

## Not verified
- Whether hooks run in the headless builder; whether a PostToolUse hook could append a history line per checklist change (proposed: file, not card comments).
- Reading `mastra.db` while a build is actively writing.
- Whether task history lines exist in saved messages or traces.
- Cause of the JUL-319 death (hangup when Todd typed `exit`, or a DuckDB temp-directory limit; both unverified).

## Rules reinforced today
- Claude does not code or run tests. "Find out" means research.
- Verify before presenting; label anything unchecked in the same sentence. Todd's one-word challenge is "unverified?".
- Solve for the simplest thing; throwaway stopgaps must be small enough to remove.
