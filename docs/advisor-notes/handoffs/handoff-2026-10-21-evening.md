# Handoff — 21 Oct 2026, 22:48 Pacific

Next session: Todd has (or is about to) paste the 22:46 Shape-approval instruction to Codex. Verify Codex's result on GitHub/Linear, then carry the guardrails card through "settled" → build → the Build card's restart.

## How to work with Todd

- Verify on GitHub/Linear before stating anything. Read AGENTS.md and the relevant skill before answering.
- Todd is non-technical: plain English, no card numbers in prose, one question at a time when walking through decisions.
- Give one complete, consolidated, paste-ready instruction for Codex. Never ask Todd to combine pieces. Write instructions with `.claude/skills/writing-for-agents/SKILL.md`: short, leading words, positive phrasing.
- Passing tests mean nothing until shown red with their guard broken.
- When something fails: no patch-on-symptom. Use `.claude/skills/diagnosing-bugs/SKILL.md` (a loop that goes red before any theory), and clean up failed attempts. Today's main failure was Claude answering each symptom with a new instruction ("quick patch loop").
- Todd never receives command-approval prompts. Codex on ovh runs approval_policy never + danger-full-access, persisted in /home/ubuntu/.codex/config.toml.
- Claude's workspace reads GitHub (clone https://github.com/toddwyder/julia-next works) and Linear; it cannot reach ovh or write to GitHub. Codex's work reaches GitHub through the server's automatic post-commit push.

## Stop rule (on main, AGENTS.md "Standing stop policy", 1c6777f)

A **problem** (failing test, setup error, wrong tool fact): diagnose with diagnosing-bugs, fix test-first, continue. A card **stops** only on two failed adversarial review/Proof rounds, a spend/time cap, or a decision only Todd can make. On a stop: diagnose to a proven cause, restart plan, Todd approves. Pre-plan points to this rule.

## State

- **main 2ba10cf.** Live Codex rules on ovh match main byte for byte; deploy helper allowed. Learning helper `/usr/local/sbin/julia-framework-learning-run` (root-owned, no args) runs the learning suite with the free-model key; kept.
- **Guardrails Shape** on `preplan/framework-learning-tests` at 5d37cfd: `docs/agents/framework-guardrails-shape-2026-10-21.md`. Evidence: `docs/agents/framework-guardrails/evidence/2026-10-22/result.md`.
- **Learning tests:** 17 under `framework/@mastra/code-sdk/`, all passed in one run, each shown red with its guard broken. Cover: three runner layers (refuse `--no-verify`/bypass via PreToolUse; check staged candidate before commit, refusal fed back via a Mastra input processor because the raw refusal causes HTTP 400; observe/recheck every commit via postToolObserver), memory on, thread-before-model ordering, saved model answers without runMC override, override refused ("Unknown model"), single settings file (red vs 92f337d), observational memory on/off, after-write feedback discarded (a Mastra limit), local push.
- **Build card (JUL-231):** stopped, Backlog. Four failed rounds, each a wrong Mastra fact, now pinned by learning tests. Its runner exists only on `julia-build/jul-231` (934df04, includes Proof driver failed-request logging fix). Restart needs a restart plan Todd approves.
- **Dashboard C (JUL-244):** Remediation; needs real saved runs from the Build card. Branch `julia-build/jul-244-dashboard-c` at 92f28f5 (its four commits only).
- mastra-trial folder deleted; runner installs from its own lockfile. Google Cloud project julia-evidence-20261021 scheduled for deletion 21 Nov.

## Todd's decisions tonight (bind)

- Enforcement lives in Julia's runner and holds for any model; no per-vendor (Codex) hooks. Three layers: bypass refusal, check-before-commit, recheck-every-commit.
- No test fakes an outside service; unavailability fails as "provider unavailable".
- 22:40–22:46 Shape approval decisions:
  1. The guardrails card builds the runner's core on main (stock SDK adapter under ops/build-runner, own lockfile install, three layers). The Build card is later rebuilt on top and owns only Start-to-saved-result. Nothing carried over from jul-231 except via approved restart.
  2. Memory: Mastra's stock Auto memory model (uses the free builder model, $0). DeepSeek pin removed.
  3. Memory test runs only when memory config, the observational-memory switch, or @mastra/code-sdk/@mastra/core version changes, and in CI on main. Its first free-model run happens inside the guardrails build; failure there is a problem under the stop rule.

## Pending instruction (22:46, may already be sent)

Approve the Shape with the three decisions above and continue pre-plan from Triage: card in Linear, Confirm, Admission, one "For Todd" summary asking him to say "settled".

## Next steps

1. Verify Codex's card and admission result in Linear and the Shape changes on GitHub; walk Todd through the summary; he says "settled".
2. Codex builds the guardrails card (adversarial review + verify-machine Proof; merge per AGENTS.md).
3. Build card restart plan for Todd's approval, rebuilt on the guardrails runner core.
4. Todd presses Start with the practice card.

## Known open risks

- No free-model build has ever reached a model and saved a result end to end.
- Proof's two "connection refused" browser errors were never explained; the driver now records failed request URLs/timestamps.
- Free observational memory is unproven on a free model until the guardrails build runs it.
- Item 23: `sudo` token-read route exists outside the learning helper (sudoers lockdown prepared earlier, not installed; Todd hasn't decided).
- Older branches `toddwyder/jul-206-...` and `toddwyder/jul-231-build-hold` still exist; not reviewed.
