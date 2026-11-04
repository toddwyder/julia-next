# Handoff, 3 Nov 2026, 16:12 PT (advisor to Todd)

Read first: `claude/session-handoff-2026-11-03-0811.md` (earlier state and the rules Todd enforced), `claude/machine-list-2026-11-03.md`, `claude/machine-one-workflow-spec-2026-11-02.md`, and the first card of the new plan, `claude/spine-card-2026-11-03.md` (live copy on the Linear card JUL-334). This file does not repeat them.

## Where Todd is
Frustrated (his word; not angry) at three weeks of back-and-forth, patch after patch, and no cleanup of patches that failed. His stated goal order stands: the machine processes a real card, then visibility, then metrics. New this session: he wants the machine conformed to stock Mastra agents and workflows and stock pstack, the old custom pieces completely deleted, and he wants it now. The dashboard is frozen until the machine works; visibility on the dashboard comes next. His view: the visibility and metrics trouble came from build and review being two different kinds of agent.

Rules he enforced this session (do not repeat these mistakes):
- Verify before answering. "Unverified" is not an acceptable answer when the repo, Linear, GitHub or the installed packages can settle it. Do not relay an agent's claim as fact.
- Subscription models are not free. They count at API prices and draw down plan quota. Free means the free CommandCode models only. Real cards use a paid model; practice cards and memory helpers use a free model if capable.
- No model names in rules, criteria or code. Formal verification belongs in the process (done means for any order-of-events rule, and maintenance after merges, which fits the cleanup sweep). The "declined at setup" ledger row was my plan, not his.
- Cards go through Triage, then `/tighten`, then Todd reviews, then he says "settled", then Ready. I broke this twice by creating cards straight in Ready.
- Never interrupt an agent that is mid-task. Do not propose an addition without naming what it deletes. Do not spend time on micro-controls stock Mastra already provides. Leftover paperwork with no use gets deleted, not annotated.
- One question at a time, answers sized to the question, no tables, plain English. Prompts to the server agent are one block, open with the poteto-mode line, end with `END OF CARD` or `END OF REPORT`.

## Decisions (his words or a clear yes)
- Stock Mastra and stock pstack all the way through. Every stage is a plain Mastra agent as a workflow step, not Mastra Code's agents. He noted subscriptions worked with plain agents under Factory.
- Order: build, then (for product cards) a pause for his acceptance, then pstack's Shipping verifies each PR independently and lands it. His UAT is pstack's human "land" step. Machine cards skip the pause. Merge is part of Shipping, not a separate machine.
- Start: Mastra Studio's run form for now, then a dashboard Start button. No polling. Do not close the first-slice pull request; wait until the dashboard.
- JUL-333 (my custom review-counter card) is canceled. He wanted stock Mastra to cap reviews, not new code.
- JUL-334 text was "settled" at 16:04 and set to Ready. Reviewer for it: Kimi K3.1 Pro (my reading of "kimi flash 3.1 pro", unconfirmed with him).

Proposed to him, not yet answered: four drift locks (a CI conformance check, the ledger as an approval lock, every machine card naming its stock feature and what it deletes, and removing takeover paths such as reviews posted under the runner identity); nine ledger and rule changes (formal verification accepted, models out of rules and code, settings out of the ledger, missing custom pieces added, memory on a free model, reviews posted under the runner, a mechanical colour wrapper, no record pull request, retry stays the one exception for now). He wanted to understand them first. Do not apply any without his yes.

## State
Verified by me: main is at 4f02d41. JUL-334 is Ready in Linear with no comments; no branch for it on GitHub at 00:12Z. JUL-333 is Canceled with a comment. The first-slice branch `feat/jul-329-one-workflow` (PR 433, open) holds the parent workflow, `machine/run.mjs` and the runs page; main still has `scripts/start-machine.mjs`. PR 436 (parser fix) is open and held.

Agent-reported, not checked by me: JUL-334 was launched once at 00:09:19Z, detached (PID 837344), log at `/home/ubuntu/julia-builder/.artifacts/start-machine/JUL-334/launch.log`, building via the old launcher with Kimi reviewing. The dead JUL-333 run's 14-file diff (67,886 bytes, including a new 171-line custom ledger module) is saved at `/tmp/JUL-333-operator-checkout.diff` on the server, and the checkout is restored to main. Its run record still reads "running"; nothing on main reads it. The first JUL-333 run died about 12 minutes in, cause unrecorded (my inference: it was launched from an agent's shell session).

## Research already done (do not redo)
- Retry: stock Mastra gives agents we build an error-processor option with match rules, and workflow steps a retry count. Mastra Code builds its own agents with a fixed list, and stock checks "retryable" before the cause chain, so the local patch stays until agents are plain or upstream fixes the order.
- Colour: Mastra Code forces colour on after copying the environment, with no setting, even in the newest release.
- Runner identity: the Julia Runner GitHub App exists and opened a pull request as itself; everything the machine posts or merges today is authored by Todd's account.
- Ask-human: the ask-user tool is built into `@mastra/core` using native suspend and resume; no copy needed.
- Plain-agent audit (agent report this session): subagents via the `agents` option, one child agent per role-model; shell and files via workspace; skills via the `skills` option; abort signal for time limits; loops via scheduled workflow or `dountil`; nesting works when an agent is called directly inside a step; the stock subagent tool breaks the trace tree; thread id needs a memory store.
- pstack order: Babysit never merges; Shipping verifies then lands with a patch-id check. The machine does not run Babysit today.
- Metrics pipeline is about 1,800 lines across six files plus 21 committed scorecards.
- Run history from the machine's records: ten cards launched since 1 October, two clean; review runaways come from hand reruns and agent takeover, not the machine's own caps (limits are per run, not per card); no spend ceiling by his 25 October decision; the merge gate has no author check.
- Free models served today: Glyph, MiniMax M3.1 Flash, Ornith 1.5 122B; free Beam's daily quota reset at 16:00 PT. The reasoning-field error belongs to the stock request path against CommandCode and is only seen on Beam.

## Open items, in order
1. Watch JUL-334 from Linear and GitHub only. When its pull request appears, read the primary evidence (the trace proof the card requires, the diff against the card) before any recommendation to approve or merge. Check the builder did step 1 (the plain-agent proof) first and cited installed package lines.
2. Next slices, each through triage, tighten, "settled": review as a plain agent step with the stock two-round loop and stock retry config; Shipping verify-and-land with the patch-id rule; the acceptance pause by suspend and resume; metrics from the run's own trace with the scorecard pipeline deleted; the cleanup sweep.
3. Rewrite the parent spec and the two Ready cards JUL-331 and JUL-332 to the new plan; do not start them as written.
4. Get Todd's yes on the drift locks and the nine changes.
5. Later decisions for him: the review model route for real cards, GitHub branch protection (one account-owner approval), how many cards run at once (I recommend one), native notifications.
6. Cleanup candidates: the stale dashboard copy the stop-ping hook points at, the stale retry ledger row, PR 436, and my dead draft `claude/review-cap-card-2026-11-03.md` (ask before deleting).

## Unverified
Whether the build launched and is healthy beyond the first three minutes; whether subscription providers run inside plain agents here; whether a suspend from a plain agent surfaces as a suspended workflow run; whether Studio runs on the server; why the first run died.

## Files and places
Project docs written this session: the spine card, the dead review-cap card, this handoff. Cloud container only (disposable): clone `/home/claude/julia-next` at main; unpacked latest `@mastra/code-sdk` and `@mastra/core` under `/tmp/cs` and `/tmp/mc`. The container cannot reach the server or the GitHub API; WebFetch of github.com pages works. Linear tools work, but the token cannot delete comments by other authors. A scheduled check on JUL-334 (trigger at 00:33Z) lives in the previous session and may not reach you.

## Suggested skills
- `anthropic-skills:advisor` before every reply to Todd and before relaying any agent report.
- `anthropic-skills:julia-route-check` before any prompt, card or recommendation.
- `anthropic-skills:tighten` before filing or editing a card (`node scripts/check-agent-brief.mjs <file>` in the clone).
- `anthropic-skills:sharpen` when he asks for a plan.
- `anthropic-skills:julia-retrospective` only if he says "retrospective".

## Coach log (route-check "Missed")
Created cards straight in Ready, bypassing Triage; proposed a custom counter instead of stock; re-proposed a fit-gap already done several times; called subscription models free; relayed an agent's "paid model" label unchecked; answered "unverified" where I could check; told him to send a cleanup prompt that would have interrupted a running task.
