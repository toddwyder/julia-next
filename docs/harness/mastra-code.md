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
| `environment: "cloud"`, a Cursor cloud agent, or the Shipping verifier | `agentType: "execute"`, non-forked, working in its own worktree checked out at the PR head (`skills/poteto-mode/SKILL.md:107`). Never `explore` or `plan`: they have no `execute_command`, so a verifier spawned that way cannot run the change and can only return an inconclusive read (PR #355). The verifier is a fresh agent that did not write the code (`playbooks/shipping.md:5`): give it the PR number and the control skill, not the author's results, and require the commands it ran and their exit codes in its verdict. |
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

## Shell environment

Every `execute_command` shell gets `FORCE_COLOR=1` and `CLICOLOR_FORCE=1` on top of the parent environment (`@mastra/code-sdk@1.14.0 dist/agents/workspace.js:12-20`). `CLICOLOR_FORCE=1` makes `gh` colour `--json` output even into a pipe, so a JSON parser sees an escape byte. `NO_COLOR=1` does not override it.

| pstack command | Run it in Mastra Code as |
| --- | --- |
| `scripts/watch-pr/watch-pr ...` (poteto-mode) | `env -u CLICOLOR_FORCE .agents/skills/poteto-mode/scripts/watch-pr/watch-pr ...`. Without it every GitHub status query fails with `JSON Parse error: Unrecognized token`, the watcher retries every 60s and shows no statuses. |
| Any script that parses `gh ... --json` output | Prefix it with `env -u CLICOLOR_FORCE`. |

Two habits that go with this shell:

- Reclaim a port by port or process group (`fuser -k 3114/tcp`, or `process.kill(-pid)`), never by command name. `pkill -f "node server.js"` also matches the shell running it and kills its own command, so the check you were about to run never starts.
- Write each gate's output to a file and echo its exit code (`npm run lint > /tmp/lint.log 2>&1; echo $?`). Tool output is truncated to the tail, so a green last line can hide the first failing gate in a chain.

`execute_command` runs `/bin/sh`, which on this host is dash, not bash. It has no `PIPESTATUS`, no `<( )` process substitution and no arrays: `echo "exit=${PIPESTATUS[0]}"` prints `Bad substitution` and the exit code it was meant to print is lost, and `cmp <(git show ...) file` fails before `cmp` runs. Check a pipeline through a file (`... | tail -5 > /tmp/out; echo $?`), and compare against a saved copy (`git show HEAD:file > /tmp/before; cmp /tmp/before file`).

An edit tool that refuses a file it last read before another write ("File was modified externally", or an `assert old in s` guard in a hand-written patch failing) means the text moved, not that the patch is wrong. `view` the file again and re-apply; `sed -i` and python heredocs guess at the exact text and cost a round each time they miss (11 of 117 failed commands in the 30 October session were this).

## CI on a branch

A push that has a PR starts two runs on the same commit: one under `push` (group `CI-refs/heads/<branch>`) and one under `pull_request` (group `CI-<pr>`). They are separate concurrency groups, so `cancel-in-progress` does not dedupe them and both build at once. The `pull_request` run is the one the PR shows.

The `web` job flakes on `next/font/google`, which fetches fonts during `npm run build` (`app/layout.jsx:3`): `Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'`, sometimes with `Error while looking up import map: next/font/google queries have exactly one entry`. On 30 October the `push` twin of a failing `pull_request` run passed on the same commit, so read the twin and run `npm run build` locally before treating the branch as broken.

You cannot retry a run or edit a workflow with this token. `gh run rerun` and the API answer `403 Resource not accessible by personal access token` (no `actions: write`), and a push touching `.github/workflows` is rejected (no `workflow` scope). `gh pr close` followed by `gh pr reopen` starts a fresh `pull_request` run on the same unchanged commit, which is how PR #382 got a green `pull_request` run after its first one hit the font flake; an empty commit does the same and leaves noise in the history. `gh pr edit` also fails on this repo on its Projects-classic lookup: patch the body with `gh api -X PATCH repos/toddwyder/julia-next/pulls/<n> --input body.json`.

After a squash merge the branch is not an ancestor of `main`, so `git branch -d` refuses. Confirm the trees match (`git diff --stat main <branch>` prints nothing) and delete with `-D`.

## Hooks

Mastra Code loads hooks from the session's project directory and from the user-level `~/.mastracode/hooks.json`. A session started outside the repository, such as `/home/ubuntu`, loads no project hooks at all, so a hook wired only in the repository never runs there: Julia's stop ping posted nothing for sessions opened from `~`.

`node scripts/install-hooks.mjs` writes the user-level entry: a `Notification` hook that runs `stop-ping.mjs --global`, which exits silently where the project already wires the ping. It keeps every other global hook and is safe to re-run after an upgrade. Verify it from a session opened outside the repository, then read `~/.local/state/julia/stops.jsonl` to see whether the stop was recorded.

## A reset, a retry, and a retry that never comes back

`api.commandcode.ai` cuts long generations mid-stream, so the AI SDK reports `AI_APICallError: Failed to process successful response` for an HTTP 200 that had already started. A server-side patch, `~/.local/share/mastracode/patches/apply-retry-fix.py`, re-applied by a `SessionStart` hook, makes `@mastra/core` look for a retry policy in the error's cause chain before the generic fallback. The reset then matches the transient-connection policy, whose budget is `MASTRACODE_TRANSIENT_CONNECTION_MAX_RETRIES = 10` (`@mastra/code-sdk/dist/index.js:80-140`), instead of the one-retry default. `emitTransientRetry` is the only place that carries `retryAttempt` and `maxRetries`, so `retry 1/10` on screen means that policy was chosen.

That retry runs inside the same turn: `canRetryError` (`@mastra/core/dist/agent-Blan8B5o.js:31813`) returns `callBail: false` and re-runs the step, so a retried attempt that never answers leaves the turn open with nothing to show. Nothing bounds it. The custom provider is built as `createOpenAICompatible({ name, baseURL, apiKey, headers })` (`@mastra/code-sdk/dist/agents/mastracode-gateway.js:291`), which uses the global `fetch` and passes no signal. Measured on this host: a 20 MB POST to a peer that never read sat for the full 20 s until our own `AbortSignal` fired (`TimeoutError`, undici code 23).

On 29 October that shape cost 100 minutes. The turn stopped after a memory save at 23:39:18.597, the last span written for the thread, and the next recorded message is the human's at 01:18:36; one `retry 1/10` notice was all the screen showed. Tracing for the process stopped nine minutes later (23:47:27), so the store cannot show what happened after that. The patch fixes which policy matches, not the missing deadline: the durable answer is a deadline per API call upstream, plus the runner's own turn timeout (PR 6 of `docs/plans/jul-276-start-screen.md`). A cut-stream repro cannot stand in for it, because headless `mastracode -p` ends the turn about 6 s after a silent stream instead of hanging.

## Unproven

- Setting reasoning effort per subagent. Mastra Code 1.14.0 exposes no field for it at the tool or subagent-definition level; only the session `thinkingLevel` exists.
