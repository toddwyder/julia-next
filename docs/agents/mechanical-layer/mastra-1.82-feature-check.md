# Stock Mastra 1.82.0 features for this card

Docs are under `node_modules/@mastra/core/dist/docs/references/`, code under `node_modules/@mastra/core/dist/`.

| Need | Verdict | Option or API | Doc | Code |
|---|---|---|---|---|
| Helper step budget set by our code | Yes, via hook | `delegation.onDelegationStart` returning `modifiedMaxSteps`, in the Lead's `defaultOptions`. Mastra passes a caller value below the helper default through as-is. | `docs-subagents.md:63-78` | `agent-BP9OWM6D.js:79167`, `:82778-82779`, `:82830-82834`, `:82922` |
| Helper ends with a written answer | Likely; confirm by test | `processInputStep` (or `prepareStep`) returning `{ toolChoice: 'none' }` on the last step. | `docs-agents-processors.md:233-270`, `:651-655` | `agent-BP9OWM6D.js:74462-74463`, `:74524-74527` |
| Command execution off or gated | Yes | Workspace `tools: { [WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]: { enabled: false } }`; `requireApproval`; `hooks.beforeToolCall` returning `{ proceed: false }`. Both the Lead's and the helpers' workspaces carry a shell today (`machine/flow/agents.mjs:22-35`). | `docs-sandbox-overview.md:58-76`; `reference-workspace-workspace-class.md:116`, `:185-196` | `workspace-iIUnzVkl.js:11406`, `:11485`, `:11573-11579` |
| Tool output size | Already capped | `maxOutputTokens` per tool, code default 2000; stdout and stderr keep the newest 1 MiB. | `reference-workspace-workspace-class.md:122` | `workspace-iIUnzVkl.js:9327`, `:9412-9424`, `:9658-9659` |
| Run and trace size | Age-based only | `retention` with `maxAge`, plus `storage.prune()`. Candidate cause of the memory kill, unmeasured: full helper tool results carried in `subAgentToolResults`. | `docs-storage.md:94` | `agent-BP9OWM6D.js:79173-79180`, `:83032` |
| Resume after a crash | Partly | `recovery.workflows` (default `'auto'`) restarts runs on boot; `run.restart()` resumes from the last active step. The build is one agent step today, so it replays whole. Durable agents checkpoint each step; a helper delegation still replays whole. | `docs-workflows-overview.md:487-528`; `docs-harness-durable-agents.md:279-289` | `mastra-D4MXu5BN.js:1094-1096`, `:2892-2908` |
| Signals for warnings | Partly | Per-step usage (`step-finish` chunk, `usage_update`); provider errors through `processAPIError`, with a 429 marked retryable. Context size and restarts have no built-in signal. | `docs-guides-streaming.md:148`; `docs-agents-processors.md:336-345`, `:1067-1087` | `agent-controller-BDds1y5w.js:1088`; `agent-BP9OWM6D.js:63912` |

## Confirm by test

- `stepNumber` in `processInputStep` counts from 0.
- `onDelegationStart` in the Lead's `defaultOptions` reaches `agents` helpers.
- The 7 Nov restart came from the boot-time recovery sweep.
