# Handoff — 22 Oct 2026, 12:45 Pacific

Next session: Todd is deciding two open questions on the guardrails card (JUL-249), then Codex builds it. Read this, the retro notes (`retros/2026-10-22-retro-notes.md`) and memory before answering.

## How to work with Todd (today's lessons — bind)

- **When Todd pastes from Codex: discuss first, act only when he says so.**
- **Never take Codex's report as gospel.** Ask: is the blocker real? why does it need this? is it a design flaw? Codex is lazy and gets Claude or Todd to do work it could do itself — hand that work back ("figure it out").
- Verify on GitHub/Linear before stating anything. Plain English; Todd is a non-technical PM.
- Never ask Todd to edit files, type commands or approve things he can't evaluate.
- One consolidated paste-ready instruction for Codex; never pieces to combine.
- Problems on the path: either it blocks the first working run (fix now) or it's accepted with a one-line reason and closed. No deferred lists. Rules only after a problem actually happens.
- On risk, explain the concrete risk and ask what's acceptable; don't decide for him or add process.
- Claude's workspace reads GitHub and Linear and can edit Linear cards; it cannot push to GitHub (session not linked to his GitHub). Todd's laptop is linked; Claude in Chrome works there (signed in to CommandCode, Linear, Sentry, Axiom).

## Standing rules now in AGENTS.md / cards

- **Ask Todd only (09:52):** (1) a step physically needs Todd in his own account and work can't continue; (2) spending would exceed the cap; (3) a choice about what Julia does for the household. Agents decide everything else (incl. security/credential calls), record one line, continue. Report only at merges.
- **Accepted risks (09:08):** builder works as `ubuntu` with admin rights; could read the control-page vault pass, change runner limits, use the deployed-code route. `julia-agent` account exists, unused. CommandCode key exposure in a test accepted, not rotated.
- **Review (11:54):** code review = Pocock `/code-review`, once at the end of `implement`, builder's own model, no paid model. Adversarial review = separate step after implement, by **Gemini**, at most two rounds per card (one round = one candidate, all angles; recheck = round two; no round three). DeepSeek has no review role. No adversarial review until Todd names the Gemini model and route.
- **Spending:** runner adapter holds keys, enforces model allowlist and $1/card total covering everything paid.
- **Free models:** only for machinery checks (2 model-side tests), Beam (`reflection/beam:free`). Real building = Codex GPT-6 Sol on Todd's ChatGPT plan.
- Linear statuses: Triage, Backlog, Ready, Implementation, Code review, Evidence review, Remediation, Staging/smoke test, UAT, Complete ("In Progress" does not exist).

## State

- **JUL-250 (key route) MERGED** — PR #313, main 97724ad. Agents use one 1Password route: "Julia agents" vault (copies of CommandCode, Linear, Sentry, Axiom), service-account pass at `/home/ubuntu/.config/julia-agents/service-account-token`, `op run` with `scripts/julia-agents.env`. Spend on that card ~$0.93 (mostly code review wrongly sent to DeepSeek).
- **JUL-249 (guardrails) Ready.** Walked through with Todd 12:26–12:33; he kept steps 1–6 as written (adapter/allowlist/cap/keys/memory; framework lint; layer 1 bypass refusal; layer 2 exact-commit checks; runner-only review + every-commit observer; same driver in Husky/Proof/CI + remove old Framework Map rules).
- **JUL-231 (Build card)** parked; restarts on the guardrails core after JUL-249 merges.

## Open decisions for Todd (asked, not answered)

1. **Formal verification** in JUL-249's proof stage — keep or cut. Claude's view: biggest time cost; real runs plus restart tests cover most of it.
2. **Gemini** for adversarial review — exact model and route (CommandCode, or Google's own API with a new key in the agents vault?). Without it the card stops at adversarial review.

## Pending Codex message (12:23, drafted — check whether Todd sent it)

1. Ornith is not free (account shows $0.0297) — remove from card/allowlist; back to Beam. "Free on your plan" doesn't count if the account shows cost.
2. A 429 means wait, not switch: today's 429s came from CommandCode's server for Beam, Glyph and Laguna alike (burst throttling). In the JUL-249 adapter: wait and retry (Retry-After or growing waits), never change models on a 429; model-side test requests one at a time; keep 429 bodies/headers; standing rule replaces only models that are actually gone.
Then build JUL-249 under the 09:52 rule.

## Watch for

- Codex stopping for things outside the three cases — point it at the 09:52 card rule.
- Codex loosening limits (e.g. the cost tracker) instead of respecting them.
- The cost tracker must record each request's cost from the response, never ask for receipts.
- Retro will be big — keep adding to `retros/2026-10-22-retro-notes.md`. Todd wants implementation and testing redone once the machine works.
