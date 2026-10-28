# Handoff — 22 Oct 2026, 22:00 Pacific

Next session: confirm the guardrails card is closed, then carry the Build card (JUL-231) through the hybrid way of working. Read this, `retros/2026-10-22-hybrid-trial-notes.md` (full trial story) and memory before answering.

## How to work with Todd (today's lessons — bind)

- **One thing at a time.** One question per reply. Several decisions in one reply is too much.
- **Read the docs before answering.** Installed skill files, repo, Linear, GitHub. Twice today Claude answered from memory and was wrong.
- **Cards only through the standard route** (pre-plan/triage run by Codex). Claude never writes card text; it adds unnecessary content.
- **One consolidated paste-ready instruction**, never two to send together.
- **Technical and architecture calls are Claude's** under the 09:52 rule. Todd is a PM: ask him product, risk-acceptance and money questions only, in plain words.
- **Discuss Codex pastes first;** verify on GitHub/Linear; never take reports as gospel.
- **Give the real implication of a decision** (e.g. "merging = adopting pstack as standard"), not a reassurance.
- Plain English, no jargon (define "helper", "panel" etc. if used).

## State

- **Hybrid way of working adopted on main on probation** (Todd 21:16). Main's `AGENTS.md` is now the ~20-line pstack rulebook (merge 7c37c63, PR #314). The Build card runs the same way; its retro decides keep, adjust or revert.
- **pstack:** 59 skills from the backnotprop mirror (Codex support) in `.agents/skills`; `~/.agents/pstack-models.md` on the server sets every role to the parent model, panels (arena, architect, interrogate) to two helpers. No formal-verification skill. `verify-machine` removed (stale, laptop-era); `verify-julia` kept.
- **JUL-251 Complete:** model-neutral connection core under `ops/build-runner` — Mastra stock routing; model and per-token price per role are settings; one $1/card ceiling (tokens × API price; subscriptions at API rates; free = $0; unpriced refused; priced request with missing usage refused). Keys and sign-ins kept out of builder commands. Stock Auto memory on. Evidence: `docs/agents/jul-251/`.
- **CI restructured:** where a test runs is decided by its nearest package/lockfile; `server` folders run on the server (receipts as git notes; CI waits up to 30 min); skill tests live in their skill; Windows laptop gate retired. Todd accepted the server dependency.
- **Maintenance on merge:** a server timer starts one fresh Codex session per merge to run maintain-verification-skill; first real run clean.
- **Retro:** Codex's (branch `docs/jul-251-retro-20261023`, merged in) plus Claude's trial notes. Verdict: build was ~28 min unattended at $0; pstack gets partial credit (short rulebook and better handoff also helped).

## Pending / open

1. **Guardrails card (JUL-249) close** — instruction given 21:21: close with one-line reasons (items 2/6 covered by structural CI; 3/4/recheck closed until a problem happens); move review control (runner-only reviews, max two rounds) into the Review card via triage. Check whether Todd sent it and verify.
2. **Rulebook stale pointer:** says learning tests are "under framework/"; they're at `ops/build-runner/framework/`. Fold the fix into the next instruction.
3. **No-fakes question (Todd's call):** JUL-251's paid-cost proofs used a local stand-in provider; Todd's 21 Oct rule bans stand-in providers. Raise when relevant to the next proof.
4. **Build card (JUL-231):** its card text is the old heavy version (four failed rounds, "Read the Framework Map comment", runner-core allocation). It needs a loose pre-plan pass through triage on top of the new core, then a fresh session: "Use the poteto-mode skill to build JUL-231." Old Framework Map comment rules still live in the pre-plan skill and Start's admission check; remove them if they get in the way.
5. **Gemini for adversarial review:** under probation, pstack's own `/interrogate` reviews (same model, two helpers). The Gemini decision only matters if Todd wants a second model family back.

## Todd's decisions today (bind)

- 13:20–13:38 trial design; 13:48 criteria are about what Todd needs, not QA; 13:55 nothing model- or provider-specific in code; 13:59–14:04 token × API-price ceiling, free models $0; 14:27 missing usage refused only for priced models; 14:38–14:49 setup-pstack, no formal-verification skill, two-helper panels; 15:27 publish with `gh`; 20:00 structural fixes, never manual lists; 20:06 maintenance on every merge; 21:16 adopt on probation; 21:21 close guardrails card.
- Todd's idea (20:28): the dashboard should show poteto-mode's checklist (Dashboard C's checklist criterion; Codex's checklist tool is now on server-wide).

## Suggested skills

- `triage` (`.claude/skills/triage/SKILL.md`) and `pre-plan` (loose pass only): reshaping the Build card.
- `poteto-mode` and `setup-pstack` (`.agents/skills/`): know what the build session will do before discussing it.
- `writing-for-agents` (`.claude/skills/writing-for-agents/SKILL.md`): every Codex instruction.
- `retro` (`.claude/skills/retro/SKILL.md`): the Build card's probation retro.
