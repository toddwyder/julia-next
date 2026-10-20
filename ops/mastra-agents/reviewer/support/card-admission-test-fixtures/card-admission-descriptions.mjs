export const completeCardDescription = `## Outcome

One outcome.

## Requirements

One requirement.

## Contracts

One contract.

## Acceptance criteria

One acceptance criterion.

## Proof

One proof.
`

export const legacyFinishConditionsCardDescription = completeCardDescription
  .replace('## Acceptance criteria', '## Finish conditions')
  .replace('One acceptance criterion.', 'One finish condition.')
// Exact docs/agents/jul-243-framework-map.md at 8368117fe7d2f25d0280deb1a8fa7727acfca467.
export const refusedFrameworkMap = "# JUL-243 framework map\n\nThe dashboard keeps provider records as the source of truth and projects them through one Julia-owned normalization boundary.\n\n| Need | Feature used | Version-matched documentation |\n| --- | --- | --- |\n| Persist Mastra activity | `Observability` with `MastraStorageExporter` | `ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-observability-tracing-configuration.md`, “Storage exporter”; `ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-studio-observability.md`, “Traces” |\n| Read persisted Mastra traces programmatically | Paginated `ObservabilityStorage.listTraces()` plus `getTrace()` | Framework gap: the installed `@mastra/core@1.75.0` documentation has Studio trace browsing but no public programmatic trace-read page. The versioned public storage-domain declarations expose these methods; consequence: Julia owns this narrow adapter and pins it with a real persisted-workflow regression test. |\n| Flush observability and storage during custom-server shutdown | `Mastra.shutdown()` | `ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-configuration.md`, “handleShutdownSignals” |\n| Retain Codex detail beside the existing run store | Public `@libsql/client` file client and parameterized upsert into a Julia-owned table | `ops/mastra-agents/reviewer/node_modules/@libsql/client/README.md`, “Quickstart” |\n| Read bounded native session windows and rank recent records | Node `fs/promises` `open`, `read`, `stat`, and `readdir` | [Node.js File system promises API](https://nodejs.org/docs/latest-v24.x/api/fs.html#promises-api) |\n| Identify live native sessions without guessing from transcript age | Codex provider-owned writer-lock IDs; CommandCode provider-owned IDE PID/workspace records; Node `child_process.execFile` + `util.promisify` with PowerShell `Get-Process` on Windows; bounded `/proc` reads plus `getconf CLK_TCK` on the Ubuntu service host | [Node.js child process `execFile`](https://nodejs.org/docs/latest-v24.x/api/child_process.html#child_processexecfilefile-args-options-callback), [Node.js `util.promisify`](https://nodejs.org/docs/latest-v24.x/api/util.html#utilpromisifyoriginal), [Microsoft `Get-Process`](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/get-process), [Linux `getconf(1)`](https://man7.org/linux/man-pages/man1/getconf.1.html), and [Linux proc PID stat](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html). Julia requires the live process name to match the provider IDE name and its start time to precede the provider record timestamp, preventing stale records from becoming live after PID reuse. Provider record formats have no published API page; consequence: Julia's narrow readers are fixture-pinned and process-probe failures fail the dashboard request with sanitized context. |\n| Keep repeated-failure identities private and stable | Node `crypto.createHash()` | [Node.js `crypto.createHash`](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptocreatehashalgorithm-options) |\n| Validate retained and public dashboard boundaries | Zod strict objects, arrays, and `omit` | `ops/mastra-agents/reviewer/node_modules/zod/README.md`, “Basic usage” and “Object schemas” |\n| Verify the phone dashboard in a real browser | Playwright Chromium with a 390px viewport | [Playwright emulation — viewport](https://playwright.dev/docs/emulation#viewport) and [Playwright screenshots](https://playwright.dev/docs/screenshots) |\n\n## Julia-owned adapters\n\n- Codex and CommandCode JSONL readers translate bounded provider-owned session windows without copying prompts or raw tool output into dashboard labels.\n- The Mastra adapter translates persisted root traces and their complete span list.\n- `projectAgentCards` alone owns the 15-minute inactivity and three-identical-failures classification.\n- `julia_agent_activity_records` is a namespaced table in the configured initialization database. It retains normalized Codex detail across server restarts and does not query or modify Mastra-owned tables. Retention never determines live dashboard membership.\n\nThe stock gap is the cross-provider business projection: Mastra persists its own traces but does not define Codex/CommandCode discovery, Julia card labels, or Julia's `Looks stuck` rule.\n"
