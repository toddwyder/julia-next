# JUL-225 framework map

| Job | Stock feature or custom piece | Installed-version documentation / evidence |
| --- | --- | --- |
| Start ACP processes and list/select models | Stock `AcpAgent`, `getAvailableModels()`, `setModel()` | `@mastra/acp@0.4.2` `node_modules/@mastra/acp/dist/docs/references/reference-acp-acp-agent.md` |
| Launch Claude's ACP bridge | Stock bridge protocol; global `claude-agent-acp@0.35.0` is pinned because it is the newest tested release that returns the `session.models` contract consumed by `@mastra/acp@0.4.2` | Installed bridge `README.md`; stock 0.90.0 was observed returning only `configOptions`, making the stock Mastra model list empty |
| Run Antigravity and Claude delivery roles | Stock `AcpAgent.generate()` | `@mastra/acp@0.4.2` `node_modules/@mastra/acp/dist/docs/references/docs-connections-acp.md` |
| Reap a standalone Antigravity ACP process on Windows after stock disconnect | Custom parent-owned process cleanup; installed `AcpAgent.connection.disconnect()` did not reliably reap its direct `agy_acp_server.exe` child before CLI exit, so cleanup records only children whose parent is the current CLI process and stops those exact PIDs | `@mastra/acp@0.4.2` `node_modules/@mastra/acp/dist/docs/references/reference-acp-acp-agent.md` (Session lifecycle); installed Windows PowerShell 5.1 `Get-Help Get-CimInstance -Full` and `Get-Help Stop-Process -Full` |
| Construct CommandCode delivery role | Stock `createCodingAgent()` | `@mastra/core@1.75.0` `node_modules/@mastra/core/dist/docs/references/reference-coding-agent-create-coding-agent.md` |
| Send CommandCode chat-completions requests | Stock AI SDK OpenAI-compatible provider | `@ai-sdk/openai-compatible@3.0.68` `node_modules/@ai-sdk/openai-compatible/docs/index.mdx` |
| Send CommandCode Responses requests | Stock AI SDK OpenAI provider | `@ai-sdk/openai@3.0.68` installed `README.md` and exports |
| Send CommandCode Messages requests | Stock AI SDK Anthropic provider | `@ai-sdk/anthropic@3.0.68` installed `README.md` and exports |
| Read the Ready Linear card for `$init JUL-nnn` | Existing Linear GraphQL boundary | Linear `llms.txt`, then indexed `developers/graphql.md`; the API key is supplied only by the Julia vault |
| Discover CommandCode coding models | Custom provider-list read; Mastra has no CommandCode catalog adapter | CommandCode Provider API `https://commandcode.ai/docs/provider#models`; eligibility is a nonempty `supported_endpoints` entry for `chat/completions`, `responses`, or `messages`, excluding System One-only offers |
| Validate workflow handoffs | Stock typed `createStep()` input/output schemas | `@mastra/core@1.75.0` `node_modules/@mastra/core/dist/docs/references/reference-workflows-step.md` |
| Central registration and layout | Stock `Mastra` workflow/storage registry under `src/mastra` | `@mastra/core@1.75.0` `node_modules/@mastra/core/dist/docs/references/reference-project-structure.md` |
| Persist connection records, exact role defaults, admission, and immutable snapshots | Custom Julia policy code; no installed Mastra feature supplies these machine policies | Required by JUL-225; contracts are centralized in `src/mastra/contracts.ts` |
| Verify permanent laptop prerequisites | Custom `verify-machine` Doctor; no framework owns Todd's install inventory | `docs/agents/permanent-machine-parts.json` is the consumed authority |

## Removed authorities and search roots

Exact repository pieces removed: `scripts/julia-connection-adapters.mjs`,
`scripts/julia-connections.mjs`, `scripts/julia-models.mjs`, and their card-specific tests. They
contained the static defaults, cached inventory authority, custom connection type, and custom ACP
adapters. The recorded after-search checks that each exact removed path is absent, then searches
`scripts/` and `ops/mastra-agents/reviewer/src/mastra/` for these exact forbidden patterns:
`STOCK_CONNECTION_TYPES`, `models-cache.json`, `testAcpAdapter`, and
`discoverAntigravityModels`. The framework map is evidence, not an implementation search root.

Laptop search roots are the install locations in `permanent-machine-parts.json`. No laptop piece is
removed: all five entries are permanent prerequisites.

Doctor inventory: `docs/agents/permanent-machine-parts.json`.
