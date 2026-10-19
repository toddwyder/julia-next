# JUL-243 framework map

The dashboard keeps provider records as the source of truth and projects them through one Julia-owned normalization boundary.

| Need | Feature used | Version-matched documentation |
| --- | --- | --- |
| Persist and read Mastra activity | `Observability` with `MastraStorageExporter`; paginated trace reads | `ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-observability-tracing-configuration.md`, “Storage exporter”; `ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-studio-observability.md`, “Traces” |
| Flush observability and storage during custom-server shutdown | `Mastra.shutdown()` | `ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-configuration.md`, “handleShutdownSignals” |
| Retain Codex detail beside the existing run store | Public `@libsql/client` file client and parameterized upsert into a Julia-owned table | `ops/mastra-agents/reviewer/node_modules/@libsql/client/README.md`, “Quickstart” |
| Read bounded native session windows and rank recent records | Node `fs/promises` `open`, `read`, `stat`, and `readdir` | [Node.js File system promises API](https://nodejs.org/docs/latest-v24.x/api/fs.html#promises-api) |
| Keep repeated-failure identities private and stable | Node `crypto.createHash()` | [Node.js `crypto.createHash`](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptocreatehashalgorithm-options) |
| Validate retained and public dashboard boundaries | Zod strict objects, arrays, and `omit` | `ops/mastra-agents/reviewer/node_modules/zod/README.md`, “Basic usage” and “Object schemas” |
| Verify the phone dashboard in a real browser | Playwright Chromium with a 390px viewport | [Playwright emulation — viewport](https://playwright.dev/docs/emulation#viewport) and [Playwright screenshots](https://playwright.dev/docs/screenshots) |

## Julia-owned adapters

- Codex and CommandCode JSONL readers translate bounded provider-owned session windows without copying prompts or raw tool output into dashboard labels.
- The Mastra adapter translates persisted root traces and their complete span list.
- `projectAgentCards` alone owns the 15-minute inactivity and three-identical-failures classification.
- `julia_agent_activity_records` is a namespaced table in the configured initialization database. It retains normalized Codex detail across server restarts and does not query or modify Mastra-owned tables. Retention never determines live dashboard membership.

The stock gap is the cross-provider business projection: Mastra persists its own traces but does not define Codex/CommandCode discovery, Julia card labels, or Julia's `Looks stuck` rule.
