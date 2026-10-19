# JUL-243 framework map

The dashboard keeps provider records as the source of truth and projects them through one Julia-owned normalization boundary.

| Need | Feature used | Version-matched documentation |
| --- | --- | --- |
| Persist and read Mastra activity | `Observability` with `MastraStorageExporter`; `ObservabilityStorage.listTraces()` and `getTrace()` | `ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-studio-observability.md`, “Quickstart” and “Traces”; `ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/storage/domains/observability/base.d.ts`, `listTraces` and `getTrace` |
| Shut down buffered trace export before closing storage | `Observability.shutdown()` | `ops/mastra-agents/reviewer/node_modules/@mastra/observability/dist/default.d.ts`, `flush` and `shutdown` |
| Retain Codex detail beside the existing run store | Public `@libsql/client` file client and parameterized upsert into a Julia-owned table | `ops/mastra-agents/reviewer/node_modules/@libsql/client/README.md`, “Quickstart” |
| Verify the phone dashboard in a real browser | Playwright Chromium with a 390px viewport | `ops/mastra-agents/reviewer/node_modules/playwright/README.md` |

## Julia-owned adapters

- Codex and CommandCode JSONL readers translate provider-owned session records without copying prompts or raw tool output into dashboard labels.
- The Mastra adapter translates persisted root traces and their complete span list.
- `projectAgentCards` alone owns the 15-minute inactivity and three-identical-failures classification.
- `julia_agent_activity_records` is a namespaced table in the configured initialization database. It retains normalized Codex detail across server restarts and does not query or modify Mastra-owned tables.

The stock gap is the cross-provider business projection: Mastra persists its own traces but does not define Codex/CommandCode discovery, Julia card labels, or Julia's `Looks stuck` rule.
