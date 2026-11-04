# Handoff, 3 Nov 2026, 19:20 PT (advisor to Todd)

Read first: `claude/stock-machine-plan-2026-11-03.md` (the current plan, a draft Todd asked to see; not yet settled), then `claude/session-handoff-2026-11-03-1612.md` for earlier rules and state. This file does not repeat them.

## Where Todd is
Frustrated by months of the machine drifting into custom code, with the agent and the advisor both adding it. He asked how professionals stop drift, compared my answer with GPT's, and had me write the plan. He said "never recommend stopping." He hasn't said "settled" on anything in the plan yet.

## New rules he enforced this session
- Never recommend stopping.
- Don't make him relay back and forth. Send one prompt that does everything when steps chain.
- Don't keep a bad rule "just in case" or work around it on a card. Fix the source (that's how PR 438 happened).
- No requirement on a card unless it names the stock feature that provides it. Per-call card tagging was mine and unneeded.

## What happened (verified unless marked)
- JUL-334 run stopped by the server agent before the pull-request step. Nothing merged. PR 437 is open: its build wraps the old Mastra Code session (`machine/build/run.mjs` imports `machine/shipping/harness.mjs`), and it cites a findings file that doesn't exist. Agent-reported; I read the README and PR page, not the diff.
- PR 438 merged as `e4e4c65`: removed the AGENTS.md line sending agents to `docs/harness/mastra-code.md`. I verified it on main.
- JUL-335 (plain-agent spike), in Triage. Answer posted as a Linear comment: it works. A plain `Agent` from `@mastra/core` 1.81.0 with three child agents ran on a free model with one nested trace. Evidence: `/home/ubuntu/jul-335-spike/` on the server (agent-printed; I read the raw trace tree, didn't re-run).
- The second read of `run.mjs` found eight non-stock pieces. The plan keeps only the needed ones. Native tags are root-only, but `tracingOptions.metadata` reaches every span with no custom code (the agent proved this with a probe). The key mismatch is fixed by one line in `scripts/julia-agents.env` plus the wrapper's allowed list and its test. Don't split workspace roots (relative writes land in the repo). Use `abortSignal`, not a timeout race. `subAgentResults` isn't a real field. Mastra records no trace unless observability is configured.
- GPT found `scripts/lint-framework.mjs` targets a missing `graph/langgraph` folder and passes anyway. I verified this on main.
- I corrected myself to Todd: the JUL-334 scorecard was required by AGENTS.md, not a builder mistake.

## Next step
Todd reviews the plan. If he settles it, draft card 1 (walking skeleton) through Triage, then `/tighten` (`node scripts/check-agent-brief.mjs`; acceptance criteria may not use implementation words like "files", "package", "code", or negations), then his review. One step at a time.

## Unverified
Whether a suspend from a plain agent shows as a suspended workflow run. Whether Mastra Studio runs on the server. Whether subscription providers work in plain agents. The 3822 vs 3842 word-count mismatch from the spike.

## Places
- Cloud container (disposable): clone at `/home/claude/julia-next` on main `e4e4c65`. It can't push; the GitHub token is invalid. WebFetch of github.com pages works. Linear tools work.
- Draft card text: `/home/claude/spike-card.md` (stale; the Linear card is the source).

## Suggested skills
- `anthropic-skills:advisor` before every reply and every relayed report.
- `anthropic-skills:julia-route-check` before any card, prompt or recommendation.
- `anthropic-skills:tighten` before filing or editing a card.
- `anthropic-skills:sharpen` when he asks for a plan.

## Coach log (route-check "Missed")
Wrote JUL-334 criteria that let the old session pass. Carried an unneeded tagging requirement into JUL-335. Kept a bad AGENTS.md line and worked around it instead of fixing it. Made Todd relay twice. Recommended stopping. Proposed a custom checker and a ratchet before checking for stock tools (dependency-cruiser).
