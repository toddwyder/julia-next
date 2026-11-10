# Run view: technical checks

Date: 10 Nov 2026.

Goal: answer the open technical questions in section 7 of the Run view design brief, so the card can be written without guessing. This was research only. No code or card was changed.

Checked on: the julia-next repo on the server, main at `37a2720`. The live dashboard (port 4313) runs from `/home/ubuntu/julia-dashboard` at `8da32d3`.

Section 7 asks six things. Each has its own section below.

1. Where each quota number comes from.
2. Whether every helper keeps a step list.
3. Live tokens through Mastra's onStepFinish, and how the build reports tokens.
4. How the model picker page is laid out.
5. Whether the Claude quota route is allowed under "Claude models stay off the machine".
6. How the Run view should show each helper's steps now that none keeps a list.


## 1. Quota: where each number comes from

Short answer: all three can be read automatically. Each uses a sign-in already stored on the server, so Todd does nothing. Each call was made once on 10 Nov and returned the amount used, the limit, and the reset time. Only the shape of each reply was printed, never the key or token values.

### ChatGPT

- Route: `GET https://chatgpt.com/backend-api/wham/usage`, sent through Mastra's stored ChatGPT sign-in (`buildOpenAICodexOAuthFetch`).
- The picker already uses that same helper for its model list: `dashboard/lib/account-models.js` lines 6 to 15.
- What came back: HTTP 200 with `rate_limit.primary_window` (5 hours) and `rate_limit.secondary_window` (weekly). Each has `used_percent` and `reset_at`. The reply also carries `credits.balance` and `plan_type`.
- Official docs: learn.chatgpt.com/docs/pricing names only the usage web page (chatgpt.com/codex/settings/usage) and the `/status` command. The endpoint itself is undocumented.
- Cross-check: Codex's own session logs on the server carry the same numbers (`rate_limits.primary.used_percent` and `resets_at` in `~/.codex/sessions/2026/11/08/rollout-*.jsonl`).
- Status before this check: unchecked.

### Claude

- Route A, recommended: `GET https://api.anthropic.com/api/oauth/usage` with Mastra's stored Claude sign-in. Mastra's `AuthStorage.getApiKey('anthropic')` refreshes the token first (`@mastra/code-sdk` `dist/auth/storage.d.ts` line 203). No model runs.
- What came back: HTTP 200 with `five_hour` and `seven_day`, each with `utilization` and `resets_at`.
- One catch: the stored token had expired. The first try returned HTTP 401 ("OAuth access token has expired"). It worked after Mastra's stock refresh, with nothing from Todd.
- Official docs: none. This endpoint is undocumented.
- Route B, documented: run Claude Code headless (`claude -p "Reply with OK." --model haiku --output-format stream-json --verbose`). It emits a `rate_limit_event` with `unifiedWindows.five_hour` and `seven_day`, each with `utilization` and `resetsAt`.
- Docs for route B: the Agent SDK TypeScript reference documents it as `SDKRateLimitEvent` (code.claude.com/docs/en/agent-sdk/typescript.md, around line 5909). The status line docs list the same windows (code.claude.com/docs/en/statusline).
- Route B runs a Claude model on every read. Section 5 says why that rules it out.
- Status before this check: unchecked.

### CommandCode

- Route: `GET https://api.commandcode.ai/alpha/billing/credits`, using the API key the CommandCode CLI stores in `~/.commandcode/auth.json`.
- What came back: HTTP 200 with `credits` (monthly, purchased, free) and `windowLimits.fiveHour` and `windowLimits.weekly`, each with `used`, `cap` and `resetAt`.
- Billing period: `GET /alpha/billing/subscriptions` gives `currentPeriodEnd`.
- Official docs: commandcode.ai/docs/resources/pricing-limits now documents a CLI `/usage` command with "credit balance plus live 5-hour and weekly limit meters". The `/alpha/...` paths are undocumented. They are the paths the installed CLI (version 1.88.3) calls: `~/.local/lib/node_modules/command-code/dist/cli.mjs`, constants `Nr`, `Fr` and `_r`.
- Status before this check: "web-only (24 Oct)". That is now out of date.

### Gotchas for all three

- All three routes call undocumented endpoints, and CommandCode's are marked "alpha". They can change without notice. The Run view should show "unknown" when a read fails, never an old number.
- All three use rolling windows (5 hours and 7 days). CommandCode also has a monthly credit period.
- Dollar figures stay labelled as estimates.


## 2. Step lists: which helpers keep one

Short answer: none.

The 2 Nov "headless builder" (`mastracode -p`) no longer exists. Source: `docs/advisor-notes/plans/visibility-direction-2026-11-02.md` line 9. The build is now the Lead agent, run as a step of the workflow, with the pstack helpers as Mastra subagents under it.

- Lead (`flow-build`) has no list. Source: `machine/flow/agents.mjs` lines 70 to 80. Its tools are the graphify tools (`src/mastra/index.ts` line 27) and the workspace tools. It has no task tools and no `signals`.
- Every pstack helper (`pstack-<role>-<n>`) has no list. Source: `machine/flow/agents.mjs` lines 56 to 69. They get the same tools as Lead.
- The Shipping, Remediation and Retro stand-ins have no list. Source: `machine/flow/agents.mjs` lines 91 to 114. They are told "No tools".
- A search of `machine/` and `src/` for `todo`, `task_write` and `checklist` finds nothing outside the tests.

What exists: Mastra 1.82.0 has four built-in task tools (`task_write`, `task_update`, `task_complete`, `task_check`) and `TaskSignalProvider`, which registers all four at once. Source: `node_modules/@mastra/core/dist/docs/references/reference-tools-task-tools.md`. They need agent memory. Lead and the helpers already get memory when the budget is on (`agents.mjs` lines 32 to 40).


## 3. Tokens: how the build reports them, and onStepFinish

Short answer: every model call's tokens are already recorded, helpers included, from Mastra's tracing. onStepFinish cannot be used on the build, and is not needed.

How the build reports tokens today:

- Each model call writes a `model_inference` span to the run's DuckDB trace file. Sources: `machine/flow/mastra.mjs` lines 20 to 38, and `src/mastra/index.ts` line 38.
- While the build runs, the `build-budget` span processor reads each finished `model_inference` span and records and prices its tokens. Sources: `agents.mjs` lines 149 to 158, `machine/budget/control.mjs` lines 202 to 216, and `priceUsage` at `control.mjs` lines 15 to 38.
- After the run, `machine/flow/trace.mjs` reads the trace file back and counts one call per `model_inference` span (lines 1 to 4 and 88 to 94).
- Helper calls are included. Every helper's model is wrapped by the same budget under its role name (`agents.mjs` lines 28 to 31 and 63).

onStepFinish:

- It cannot be used on the build. Mastra's docs say: "Per-request fields such as requestContext, resourceId, threadId, and onStepFinish are managed by the workflow engine and excluded." Source: `node_modules/@mastra/core/dist/docs/references/reference-workflows-workflow-methods-agent.md` line 24. The build is exactly that kind of step, `createStep(agents.build)` at `machine/flow/steps.mjs` line 91.
- When an agent is called directly, onStepFinish does fire "after each LLM step within a sub-agent execution". Source: `reference-agents-network.md` line 119. That is not how the build runs.
- Shipping, Remediation and Retro call `.generate()` directly (`steps.mjs` lines 108, 130 and 219), so they could take onStepFinish. None of them passes it today.

Unknown:

- Whether the trace file can be read while a run is still writing it. `trace.mjs` reads it only "after the run has stopped writing to it" (lines 2 and 3). To settle it, open the trace read-only during a live run. If that fails, the live numbers come from a span processor like `build-budget` (registered at `mastra.mjs` line 38), which sees every span as it ends.
- How the memory observer and reflector calls (`agents.mjs` lines 35 and 36) should appear. They are counted under the role name plus `:observer` or `:reflector`. Showing them is a design choice.


## 4. Model picker page: layout and how it is built

- Address: `/start` on the dashboard, port 4313, reached at `https://ovh.tail91f394.ts.net/`. The home page links to it as "Model settings" (`dashboard/app/page.jsx` line 21). `/start/<card>` is the same page with the card title (`dashboard/app/start/page.jsx` lines 1 to 5).
- Stack: Next.js 16.3.5 (app router), React 19.3.0 and a plain CSS module (`dashboard/package.json` and `start.module.css`).
- Serving: a custom `dashboard/server.js` runs Next in production mode, so a change needs `next build` and a restart.
- Layout: the server component `app/start/[card]/page.jsx` loads the models, prices and settings, then renders a back link, a header and the client component `StartScreen` (lines 52 to 63).
- `StartScreen` stacks three sections: Settings, Effort and Models (`start-screen.jsx` lines 148, 161 and 181). It also has a pop-up model chooser (line 276). The live page shows the same three headings.
- Tabs: none exist. There is no tab component, no `role="tab"` on the live page, and no shared navigation in `dashboard/app/layout.jsx`, which has one `<main>` wrapper. The `TABS` in the root `app/site-nav.jsx` belong to the Julia app, not the dashboard.
- Adding a tab: the smallest change is a tab bar in `app/start/[card]/page.jsx` around the existing `StartScreen`, with Run view as a second client component beside it. Keep the chosen tab in the address (`?tab=run`) so a reload keeps it. The page already calls `connection()`, so it renders fresh on every request.
- Checks to keep green: `dashboard/scripts/lanes.mjs` and `scripts/check-model-picker.mjs` both drive this page in a browser.


## 5. Does the Claude quota route break "Claude models stay off the machine"?

The rule, quoted from `docs/plans/path-forward.md` line 145 (30 October decisions, in the Shipping item): "Its model is the Shipping pick on the Start screen, Kimi K3.1 Pro by default, from a different company than the builder's. Claude models stay off the machine."

What "the machine" means, from the same file, line 19: "**Machine**: runs one pstack session per Ready card (orchestrator + coder), then the steps after the PR."

The likely reason, from line 132: "the Opus orchestrator used 34% of the weekly Claude quota". The file links the rule to this reason only by date. It does not state it.

Current state: no machine role uses a Claude model. `~/.config/julia/lead-model` holds a CommandCode model, and `~/.config/julia/lead-role-models.md` contains no "anthropic" or "claude".

Verdict:

- Route A (the usage endpoint with the stored sign-in) is allowed. It runs no Claude model and spends no Claude quota. It reads a number over the same sign-in Mastra already keeps on the server. It is not part of a card's pstack session or its later steps.
- Route B (headless Claude Code) is not allowed. It runs a Claude model (Haiku) from the server on every read and spends Claude quota, which is what the rule appears to guard. The rule's text names no exceptions.
- Use route A. Fall back to "unknown" when it fails, not to route B.


## 6. How the Run view should show each helper's steps

Short answer: show each helper's actions from the run trace now, and label them "actions", not "steps". A real checklist needs the Mastra task tools added to the agents. That should be its own card.

Evidence that the trace can supply this:

- Run checked: the 8 Nov helper-card run, `~/.local/state/julia-scratch/helper-card-run/trace.duckdb` (main file only; its WAL file was not read). It was opened read-only from a copy.
- The trace has an `agent_run` span for each agent, including one for the helper that ran: `agent run: 'flow-build'`, `agent run: 'pstack-feature-refactoring-1'`, `agent run: 'flow-shipping'` and `agent run: 'flow-retro'`.
- Every `tool_call` and `model_step` span traces up its parent chain to exactly one `agent_run`.
- Counts in that run: Lead made 21 tool calls and 17 model steps. The feature-refactoring helper made 13 tool calls and 14 model steps. Shipping and Retro made 1 model step each.
- Tool names are readable, for example `tool: 'mastra_workspace_read_file'`, `tool: 'mastra_workspace_execute_command'`, `tool: 'skill'` and `tool: 'agent-featureRefactoring'` (Lead handing work to the helper).
- Span types in the run: `agent_run`, `model_step`, `model_inference`, `tool_call`, `workspace_action`, `skill_action`, `workflow_step` and others.

So the Run view can show, under each helper, a running list of what it did and when ("read file X", "ran command Y", "loaded skill Z", "handed work to Feature"), plus its tokens from the same spans.

What it cannot show: a plan with steps ticked off. No agent writes one (section 2). Showing tool calls as a "step list" would mislead Todd, because the number of actions is not progress toward done.

If Todd wants real ticked-off steps: add `TaskSignalProvider` to Lead and each helper, and tell each to keep its list (`reference-tools-task-tools.md`). This changes how the agents work, so it needs a run to show the agents actually keep the lists. The 2 Nov evidence shows headless builds kept lists unreliably, even with the tool available: JUL-290's build listed 7 items and ticked 0, JUL-317's ticked 6 of 6, and JUL-319's kept no list (`visibility-direction-2026-11-02.md` line 26).

Unknown: whether the trace can be read live during a run (see section 3). That decides whether the action list updates as it happens or only after each step ends.


## Sources

- learn.chatgpt.com/docs/pricing (redirected from developers.openai.com/codex/pricing)
- code.claude.com/docs/en/statusline
- code.claude.com/docs/en/agent-sdk/typescript.md
- commandcode.ai/docs/resources/pricing-limits
- Mastra docs installed with `@mastra/core` 1.82.0, in `node_modules/@mastra/core/dist/docs/references/`
