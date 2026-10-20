# JUL-243 framework map — partial restart checkpoint

The settled design uses official lifecycle interfaces and explicitly registered launches. No private-file discovery, process scanning, approval handler or controlled-barrier Proof was carried over. This checkpoint is incomplete and is not a passing framework review.

| Job | Retained feature | Documentation read / remaining verification |
| --- | --- | --- |
| Ubuntu sandbox prerequisite | Distribution bubblewrap 0.9.0 and AppArmor 4.0.1 profile | https://learn.chatgpt.com/docs/sandboxing#prerequisites ; `/etc/apparmor.d/bwrap-userns-restrict` loaded with `apparmor_parser -r` |
| Sandbox startup without a model turn | Codex 0.163.0 `command/exec`, explicit `workspaceWrite` | Installed `CommandExecParams` generated JSON schema; https://learn.chatgpt.com/docs/app-server#command-execution ; actual successful command in `jul-243/evidence/sandbox-command.json` |
| No approval requests during Proof | Codex 0.163.0 `approvalPolicy: never` | Installed generated `ThreadStartParams` → `AskForApproval` enum and `codex --help`; Proof not yet implemented |
| Codex native event ingestion | Shared app-server Unix WebSocket, threads, turns and items | Installed `codex app-server --help` and generated schemas; https://learn.chatgpt.com/docs/app-server . Copied observer awaits final review; reconciliation requires further tests |
| WebSocket transport | ws 8.18.3 | Installed `ws/README.md`, usage examples and API-doc link; https://github.com/websockets/ws/blob/8.18.3/doc/ws.md#ipc-connections |
| CommandCode headless lifecycle | Event/result NDJSON, owned child | Installed 1.72.3 `dist/bundled/command-code-knowledge/reference/headless.md` and CLI help were read. Preflight observed runtime replacement with 1.84.0 and a missing-file failure; version matching is now blocked and must be restored before using this adapter |
| Mastra stream/result ownership | `Run.stream()`, awaited result, `Run.cancel()` | Installed `@mastra/core/dist/docs/references/reference-streaming-workflows-stream.md` and `reference-workflows-run-methods-cancel.md`; no barrier step retained |
| Mastra durable observability | `Observability`, `MastraStorageExporter`, persistent LibSQL | Installed `@mastra/observability/README.md`, `@mastra/libsql/dist/docs/references/docs-storage.md`; live persistent traces and cleanup Proof still open |
| Persist launch/event histories | @libsql/client 0.18.0 file client, parameterized batch/execute | Installed `@libsql/client/README.md`, Quickstart; reopen-history tests pass |
| Validate event/projection schemas | Existing Zod v4 contracts | https://zod.dev/api ; schema changes require final framework review |
| Process lifecycle, timers, redacted logs | Node 24.14.1 child_process, readline, crypto, fs | https://nodejs.org/docs/latest-v24.x/api/child_process.html ; https://nodejs.org/docs/latest-v24.x/api/readline.html ; https://nodejs.org/docs/latest-v24.x/api/crypto.html ; https://nodejs.org/docs/latest-v24.x/api/fs.html . Further map verification is open |
| Phone browser Proof | Existing Playwright 1.63.0 | Installed Playwright READMEs and `.agents/skills/playwright-cli/SKILL.md`; https://playwright.dev/docs/emulation#viewport . No current browser Proof yet |
| PR and review handoffs | Installed gh 2.45.0 | `gh pr create --help`, `gh pr close --help`, `gh pr view --help`; Gemini findings must be pushed to `review/pr-303`, never to the PR branch |

The focused test command is `node --experimental-strip-types --test test/jul-243.test.ts` from the reviewer package. The declared `proof:jul-243` command is pending implementation: no Proof file was copied from #301. No model invocation or live-contract test is part of this checkpoint.
