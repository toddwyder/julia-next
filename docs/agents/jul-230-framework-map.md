# JUL-230 framework map

| Job | Tool or framework feature | Version-matched documentation |
| --- | --- | --- |
| Define the initialization boundary as typed deterministic work | Mastra `createStep()` and `createWorkflow()` with Zod input, output, and suspend schemas | Installed `@mastra/core@1.75.0` `ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-workflows-step.md` and `docs-workflows-overview.md` |
| Stop before any role runs and recover the saved state | Mastra step `suspend()`, persistent snapshots, `getWorkflowRunById()`, and `createWorkflowStateReader()` | Installed `@mastra/core@1.75.0` `ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-workflows-suspend-and-resume.md` |
| Persist initialization across process and laptop restart | File-backed `LibSQLStore` registered on `Mastra` | Installed `@mastra/libsql@1.25.1` `ops/mastra-agents/reviewer/node_modules/@mastra/libsql/dist/docs/references/integrations-databases-libsql.md` |
| Discover and select ACP models without inference | `AcpAgent.getAvailableModels()` and the existing exact-model selection adapter | Installed `@mastra/acp@0.4.2` `ops/mastra-agents/reviewer/node_modules/@mastra/acp/dist/docs/references/reference-acp-acp-agent.md`; existing approved adapter details remain in `docs/agents/jul-225-framework-map.md` |
| Advertise route-supported Antigravity and Claude effort choices | Installed CLI `--effort` contracts | Installed `agy.exe --help` and `claude --help`; both advertise `low`, `medium`, `high`, `xhigh`, and `max` |
| Discover CommandCode coding models and retain its common supported effort choices | Existing provider model-list boundary; the page exposes the route's bounded `low`, `medium`, and `high` choices | [CommandCode Provider API](https://commandcode.ai/docs/provider), [available models](https://commandcode.ai/docs/reference/cli/models), and [BYOK model `reasoningEfforts`](https://commandcode.ai/docs/byok) |
| List real Ready Linear cards without mutation | Linear GraphQL `issues` query with a server-side state filter, API-key authentication, GraphQL error checks, and required-field parsing | [Linear GraphQL API](https://linear.app/developers/graphql) |
| Serve one loopback-only page and JSON boundary | Node `http.createServer()` bound explicitly to `127.0.0.1`, with a checked loopback Host header | [Node 24 HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html) |
| Open the named page from the one-click Windows launcher | Repository PowerShell launcher plus a short-lived hidden `Start-Process` child | Installed PowerShell 5.1 `Get-Help Start-Process -Full`; [Node 24 child process](https://nodejs.org/docs/latest-v24.x/api/child_process.html) |
| Validate every browser/server/workflow handoff | Shared strict Zod schemas inferred once in `src/mastra/contracts.ts` | [Zod API](https://zod.dev/api) |

The task-specific HTML form is custom because Mastra Studio exposes generic
workflow JSON input, not the settled Ready-card/four-role form. The server uses
Node's built-in HTTP boundary and Mastra's workflow/storage primitives; it does
not recreate Factory or add a second delivery orchestrator.
