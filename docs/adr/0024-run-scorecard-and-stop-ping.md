# 0024. Run scorecard and stop ping from Mastra Code's own records

Date: 2026-10-26

Status: Accepted (JUL-274). Replaces the spend ledger of [0023](0023-actual-spend-card-cap.md), which left `main` with the old build machine in #354.

## Context

Every Julia card now runs by hand in Mastra Code. Todd wants each card scored on cost, model provenance, stops and success, and wants to hear when a run waits on him. On 26 October two waits went unnoticed for about 2 hours and about 20 minutes.

## Decision

Use Mastra Code's own records and features. Add code only where Mastra Code has none.

| Need | Source | Custom code |
| --- | --- | --- |
| Which card a run belongs to | `mastra.db` messages: a user message `Card: JUL-n`, `Start JUL-n` or `Run JUL-n` starts that card, until the next one | `scripts/scorecard.mjs` |
| Stops | `mastra.db` messages: each user message after the kickoff ends a wait. The wait starts at the last agent activity before it. The question is the `ask_user` question, or the agent's last text | same |
| Cost with tracing on | Mastra Code local tracing (`observability.localTracing`), `observability.duckdb`. Mastra's own cost estimate from its bundled models.dev price table, summed over the `mastra_model_total_input_tokens` and `mastra_model_total_output_tokens` metrics only, per model and agent | same |
| Cost before tracing | Thread `tokenUsage` in `mastra.db`, priced with the same bundled price table. A thread that holds two cards is split by the share of model steps in each card's window. Subagent and memory-model calls have no recorded usage there, so they are counted, not priced | same |
| Model provenance | Requested model: step `model` in messages, or span `model`. Answering model: metric `model` from the provider response. Subagent requests: the `subagent` tool's `modelId` | same |
| Success | Todd's UAT yes is recorded in `docs/scorecards/uat.json` (time, his words, and anything else that question asked), and no stop began before it. The wait that ends in the yes is the UAT and does not count, unless the same question also asked for something else | `docs/scorecards/uat.json` |
| Ping and stop record | Mastra Code `Notification` hook (`ask_question`, `tool_approval`, `plan_approval`, `sandbox_access`, `agent_done`) runs `scripts/stop-ping.mjs`, which appends the stop to `~/.local/state/julia/stops.jsonl`, comments on the card mentioning Todd, and sets Todd an `issueReminder` on the card 30 seconds later. The hook is wired in this repository and, through `node scripts/install-hooks.mjs`, in `~/.mastracode/hooks.json`, so a session opened from the home directory still pings; the global entry skips a project that wires its own. The comment names the resume command with the thread's own directory, because `mastracode -t` is headless-only and opens a new chat. A chat with no card of its own — started in the home directory, no kickoff line, no card in its title, no card branch — pings the card it last pinged about and records that binding in `~/.local/state/julia/thread-cards.json`, so its later stops stay on that card instead of going silent | `scripts/stop-ping.mjs`, `scripts/install-hooks.mjs`, `.mastracode/hooks.json` |

Scorecards are committed at `docs/scorecards/<card>.md` in the card's PR. Mastra Code prunes traces after 14 days, so the committed scorecard is the lasting record.

A comment posted with Todd's own `LINEAR_API_KEY` does not notify Todd, because Linear never notifies a user about their own comment (tested on JUL-274, 26 October). An app identity would fix that, but it needs Todd to turn on client credentials and store a secret, which he declined. An `issueReminder` set with his key needs no setup: it puts an `issueReminder` notification in his inbox, and his settings send reminders to mobile, desktop and email (checked through the API on 26 October). Whether a push reached his phone can only be checked by Todd.

## Consequences

- Local tracing is on in Mastra Code's global settings on the server. DuckDB lets one process write a file, so the launcher gives each session its own file and a second session records its cost like the first. A session started another way can lose its rows, so a card whose sessions started after the launcher and left no rows prints `- Cost incomplete:` with the reason, and the branch check refuses that pull request. A session that was already open when the launcher was installed never got a file from it, so the scorecard recognises it by the missing `MASTRA_OBSERVABILITY_DB_PATH` and prints `- Not counted:` with the count, because no restart can recover rows the launcher never wrote.
- Headless `mastracode --prompt` exits without flushing traces (`@mastra/code-sdk` `headless/cli.js` skips `getMastra().shutdown()`). Cards run in the TUI, which flushes.
- Command Code models (DeepSeek V4.1 Flash) have no price in the bundled table. Their tokens are reported and marked unpriced.
- Scorecards for cards before tracing are estimates and say which parts are missing.
