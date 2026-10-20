# JUL-244 framework map and delivery plan

Scope: extend the registered-run dashboard with Dashboard C in the approved 18 October phone mockup. Preserve agent wording and ticks. Unknown is unavailable, never zero. Handoffs remain unavailable because neither provider supplies an explicit handoff record; collaboration calls are not evidence of a handoff.

The existing registered-launch/event ledger is the normalization seam. Tests drive provider notifications through adapters and the durable store, then inspect cards and the real HTTP/browser surface. Context fullness is rounded `last.totalTokens / modelContextWindow * 100`, bounded 0–100: last model exchange, not cumulative run tokens. Missing/nonpositive capacity is unavailable. Keep raw numerator/denominator in the card for explanation. Compactions are unique completed native item IDs; replay must not double count. Native turn-plan updates replace the checklist, preserving text and statuses. A new turn clears the previous checklist. Older records without captured plan state show unavailable.

| Job | Stock feature and exact documentation read |
| --- | --- |
| Codex telemetry | Installed 0.163.0 `codex app-server generate-json-schema --out`: `v2/ThreadTokenUsageUpdatedNotification.json`, `v2/TurnPlanUpdatedNotification.json`, `v2/ItemCompletedNotification.json`, `v2/ThreadStartParams.json`; https://learn.chatgpt.com/docs/app-server (token usage, plan, compaction). Official page is rolling; generated installed schemas bind field shapes. |
| Durable telemetry | Existing @libsql/client 0.18.0 event ledger, installed `node_modules/@libsql/client/README.md` Quickstart; parameterized event append/reopen. No new database. |
| Validation | Installed Zod v4 and https://zod.dev/api (objects, arrays, nullable, strict); https://zod.dev/basics (safeParse). |
| CommandCode | Installed 1.84.0 `dist/bundled/command-code-knowledge/reference/headless.md` JSON output; `models.md` free model. Headless records expose token usage, no context capacity, plan ticks, compactions or handoffs. Existing Mastra workflow wrapper reuses usage; Dashboard C does not infer missing values. All calls use --no-auto-update. |
| Mastra real proof | Installed @mastra/core 1.75.0 `dist/docs/references/reference-streaming-workflows-stream.md` fullStream/result/usage; `docs-studio-observability.md` Traces. Existing workflow + durable exporter. |
| Browser | Installed Playwright 1.63.0 README, https://playwright.dev/docs/emulation (viewport). Real isolated control page and production Tailscale page; 390×844, clean console, overflow, context/progress/checklist. |
| Linear | https://linear.app/developers/graphql.md; connected issue/comments tools. |
| GitHub | Installed gh 2.45.0 `gh pr view --help`, `gh pr create --help`, `gh pr checks --help`, `gh pr merge --help`; ordinary signed-in access. |
| Deploy | `docs/agents/codex-delivery-profile.md` fixed activation helper; copy reviewed required source files as ubuntu and checksummed readback, then `sudo -n /usr/local/sbin/julia-control-deploy-and-restart`. |

## Runtime dependency matrix

| Principal | Store/API | Mode | Fixture | Real proof |
| --- | --- | --- | --- | --- |
| ubuntu maker | Codex 0.163.0 shared app-server | Read telemetry; owned proof thread writes | Native notifications | `node --experimental-strip-types proof/jul-244.ts EVIDENCE_DIR` |
| ubuntu maker | CommandCode 1.84.0 through real Mastra workflow | Free model execution, read usage | Absent-field fallback | Same proof, poolside/laguna-s-2.1-free only |
| julia-control service | Existing agent SQLite ledger | Read/write normalized events | Temporary real database, reopen and duplicate compaction | Same proof plus live API after restart |
| Tailnet browser | Control page/API | Read | Phone browser test | Same proof then deployed Tailscale smoke |

Preflight: Node 24.14.1, Codex 0.163.0, CommandCode 1.84.0, Playwright 1.63.0 and installed locked dependencies; Codex startup updates off, CommandCode no-auto-update. Existing signed-in access remains inside trusted tools. No pending laptop runner or Factory used. Windows launchers/permanent parts untouched; their Windows-only drives do not exercise this server dashboard. Machine Proof is the real affected server journey, as for JUL-243. Reviewer cap is $1/card per AGENTS.md; no paid API calls authorized here. Signed-in Codex and free CommandCode only.

Finish: test-first, full relevant checks, pinned candidate behavioral proof, adversarial Standards/Spec review of all files and evidence, exact-candidate CI, merge, deploy, fixed restart, live browser and checksummed maker readback, Linear completion and owned temporary cleanup. If a stop policy applies, remove any nonconforming card code from repository/deployed machines rather than work around it; offer revert or clean-main carryover before patching in a restart plan.
