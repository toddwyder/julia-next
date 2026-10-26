# pstack in Mastra Code

Read this file once per session, then map each Cursor name in a pstack skill with the tables below. `<pstack>` means the installed pstack folder: skills are under `.agents/skills/`; pstack's own docs are under `.agents/docs/` (the guide is `.agents/docs/guide/` and the Claude Code adapter is `.agents/docs/harness/claude-code.md`). If a Cursor field has no row, drop it and say so. Never pass a field or value the tool schema rejects.

Mastra Code's stock coding agent and stock subagents are used. There are no custom agents.

## Tools

| Cursor | Mastra Code |
| --- | --- |
| `Task` | The built-in `subagent` tool. Input is `{ agentType, task, modelId?, forked? }` (`@mastra/core@1.78.0 dist/agent-controller/tools.d.ts:62-71`). |
| `subagent_type: generalPurpose` | `agentType: "execute"`. The stock subagents are `explore`, `plan`, and `execute` (`@mastra/code-sdk@1.14.0 dist/index.d.ts:37-38`). |
| `readonly: true` | `agentType: "explore"` (`explore.md` in `dist/agents/subagents/explore.js:4-8`: read-only, `view`, `find_files`, `search_content`, `file_stat`). Use `plan` for read-only planning (`plan.js:4-8`). |
| `readonly: false` | `agentType: "execute"` (`execute.js:3-8`: edits files and runs commands). |
| `AskQuestion` | The built-in `ask_user` tool (`@mastra/core dist/agent-controller/types.d.ts:179`; `tools.d.ts:6,9`). If the host removed it with `disableBuiltinTools`, ask in plain text (`@mastra/code-sdk dist/index.d.ts:56-61`). |
| Open a todolist | The built-in task tools: `task_write` first, then `task_update`, `task_complete`, and `task_check` (`types.d.ts:179`; `tools.d.ts:11`). The list persists in session state under `tasks` (`dist/schema.d.ts:108`). |

## Models

| Cursor | Mastra Code |
| --- | --- |
| A role's model slug, such as `anthropic/claude-opus-5-5` | Pass it as `modelId` on that `subagent` call (`tools.d.ts:66-71`). The call override wins over the controller's per-type model and the definition's `defaultModelId` (`dist/agent-controller-DRiP9C5v.js:6429-6432`). |
| `auto` or `inherit-parent` | Pass the parent chat's model id as `modelId`. Omitting `modelId` does not inherit the chat model; it falls through to the per-type session model, then the definition default (`tools.d.ts:66-71`; `DRiP9C5v.js:6429-6432`). |
| A role value `<model> <effort>`, such as `anthropic/claude-opus-5-5 xhigh` | Pass `<model>` as `modelId`. There is no per-subagent effort field in the tool or in `AgentControllerSubagent` (`tools.d.ts:66-71`; `types.d.ts:120-168`). Effort is session-scoped: `thinkingLevel` in session state (`dist/schema.d.ts:100`) and `modeThinkingDefaults` or `preferences.thinkingLevel` in settings (`dist/onboarding/settings.d.ts:218,275`). Mark the effort part **unproven** per subagent. |
| `~/.cursor/rules/pstack-models.mdc` | `~/.agents/pstack-models.md` (`skills/setup-pstack/SKILL.md:12`). Read it at task start if it exists (`skills/poteto-mode/SKILL.md:109`). Mastra Code does not load it by itself; the root `AGENTS.md` tells every session to read it. |
| A panel list | One `subagent` call per entry, with that entry's model as `modelId`. The list length sets the fan-out (`skills/setup-pstack/SKILL.md:37`). |

## setup-pstack

Mastra Code has no plugin slash commands for these skills. Run `/setup-pstack` by reading `.agents/skills/setup-pstack/SKILL.md` and following it.

- Detect: the real slugs are the `modelId` values your host's model catalogue offers. `inherit-parent` and `auto` always pass (`skills/setup-pstack/SKILL.md:20`).
- Write: `~/.agents/pstack-models.md`, without frontmatter, starting at the first `#` line (`skills/setup-pstack/SKILL.md:45`).
- Read: sessions read it because the root `AGENTS.md` names it.

## Project instructions

Mastra Code loads global instruction files first, then one project file. It prefers `AGENTS.md` over `CLAUDE.md` and checks the project root, `.claude/`, then `.mastracode/`, stopping at the first file it finds (`@mastra/code-sdk dist/agents/prompts/agent-instructions.js:11-22,148-156,188-201`). `sessionInstructionRoots` can add roots, the session's own checkout first (`agent-instructions.js:209-234`).

Because the root `AGENTS.md` wins over `.mastracode/AGENTS.md`, Julia names this adapter and the models file in the root `AGENTS.md`. A `.mastracode/AGENTS.md` would never load while the root file exists.

## Paths

| Cursor | Mastra Code |
| --- | --- |
| Transcripts in `~/.cursor/projects/<slug>/agent-transcripts/` | No per-session JSONL folder. Threads and messages persist in the LibSQL store at `~/.local/share/mastracode/mastra.db` (tables `mastra_threads` and `mastra_messages`). The path comes from `getAppDataDir()` and `getDatabasePath()` (`dist/utils/project.js:132-152`), and `getStorageConfig()` defaults to `file:<that path>` (`project.js:187-229`). Read or resume a session through `session.thread.listThreads` and `listMessages` (`@mastra/core dist/agent-controller/session.d.ts:148-160`). `MASTRA_APP_DATA_DIR` moves the whole store. |
| `~/.agents/pstack-models.md` | A plain file, not a rule the harness loads. The root `AGENTS.md` names it so sessions read it. |

## Unproven

- Setting reasoning effort per subagent. Mastra Code 1.14.0 exposes no field for it at the tool or subagent-definition level; only the session `thinkingLevel` exists.
