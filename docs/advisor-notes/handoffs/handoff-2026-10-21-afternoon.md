# Handoff — 21 Oct 2026, 13:52 Pacific

Next session: get every server commit pushed to GitHub automatically, then verify the framework-guardrails Shape and carry it through pre-plan. The Build card (JUL-231) restarts only after the guardrails card is live.

## How to work with Todd

Rules from the morning handoff still bind (`/mnt/user-data/uploads/attachment.txt` in that session; summary: verify before stating, name who did what, one complete paste-ready instruction, plain English, no card numbers in prose, stop him only for an account action, money beyond the limit, or a product decision). Added today:

- Read AGENTS.md and the relevant skill before answering. Every miss today came from answering first.
- Use the repo's existing skills (Pocock's, poteto's) before inventing a procedure.
- Claude does not write card content. Todd's decisions go into pre-plan; pre-plan and triage write cards.
- Todd is non-technical: Codex does installs and setup; Todd only signs in or clicks Allow.
- Prefer the simplest route that already works. Pushing to GitHub is the evidence route; the Google Drive detour was rejected as too complex.

## State

- **JUL-231 (Build card): stopped, not live.** Two product Proof rounds failed on the free-model route. Root cause and restart plan: `docs/agents/jul-231/root-cause-2026-10-21-second-stop.md` and `restart-plan-after-second-stop-2026-10-21.md` on `julia-build/jul-231` at `e5a007a`. Restart plan not approved. Claude's review of it: it omits the builder fixes below and tests the free-model connection against a fake.
- **Why four rounds failed:** all were wrong assumptions about `@mastra/code-sdk` (memory disabled, model ID format, two settings files) plus one test fault. The Framework Map that should have prevented this reaches neither builder nor reviewer: `ops/build-runner/sdk-worker.mjs` passes only card identifier, title and description; `linear.ts` `cardAdmissionInput` saves only the newest map comment (on JUL-231 that is a builder's 16:47 draft, not pre-plan's 16:23 map); only the Start admission check reads it.
- **AGENTS.md on `julia-build/jul-231`:** `e5a007a` added a push rule for stop reports but placed it between "Every restart plan and brief must state…:" and its three bullets. It needs moving below the bullets. The rule is not on main.
- **Framework-guardrails Shape: waiting for Todd's approval, unverified by Claude.** Codex reports Shape at `/home/ubuntu/julia-framework-preplan/docs/agents/framework-guardrails-shape-2026-10-21.md`, commits `f30e82b` (SDK learning-test prototype: 4 pass, 1 fails on the canonical model override) and `0a5ad03`. Neither commit is on GitHub. Check why a learning test fails: it should assert actual behavior and pass.
- **Pending Codex instruction (sent 13:50):** stop the Drive setup and shut the temporary remote screen on port 8443; install a server-wide post-commit push for `/home/ubuntu/julia*` checkouts; add to AGENTS.md on main that every report and its evidence is committed under `docs/agents/<card>/` and pushed before reporting; push the pre-plan branch. Todd then asked to use Pocock's skills: Husky via `.claude/skills/setup-pre-commit/SKILL.md` (with a post-commit push) is the repo-native version of the server hook. Reconcile the two before more work.
- **Drive evidence setup:** abandoned. Record on `ops/drive-evidence-setup-20261021`. rclone remote and Google Cloud project `julia-evidence-20261021` exist on ovh, unused. Confirm the port-8443 remote screen is stopped.

## Todd's decisions today (bind)

- Review runs automatically after ready-for-review; no Review button. Goes into the Review card (replacing JUL-233) through pre-plan.
- Framework Map lives in the repo as learning tests under `framework/<package>/`, never in Linear.
- Pre-plan writes learning tests: its prototype step commits them under `framework/` and nothing else.
- Guardrails card ships before the JUL-231 restart.
- Gates repo-wide now; learning tests for `@mastra/code-sdk` now, other packages when a card first touches them, enforced by a coverage check.
- Earlier (11:35, still binding): Codex GPT-6 Sol builds JUL-231; DeepSeek via CommandCode under $1 reviews; free models for all four roles in Proof; test faults don't count as rounds.

## Open items for the guardrails card

- Builder prompt must name `implement`, `tdd`, `code-review`, the card's Proof and the learning tests.
- `lint:framework` targets the missing `graph/langgraph` and always passes.
- CI never runs `ops/build-runner` tests.
- Proof driver gate on passing learning tests (hooks can be skipped with `--no-verify`).
- Whether Mastra Code hooks (`disableHooks: true` in `ops/build-runner/runtime.mjs`) or permission policies can block `--no-verify`: unanswered, needs a learning test.
- Historical replay: checks must go red on `f50e509`, `1cc879d`, `92f337d`.

## Access facts

- Claude's workspace reaches GitHub (read) and Linear; not the server. GitHub write needs Todd to link GitHub in claude.ai Connectors (not done).
- Laptop bridge works; `~/.ssh` and `G:` cannot be granted; the Claude app cannot be controlled by computer use.

## Suggested skills

- `pre-plan` (`.claude/skills/pre-plan/SKILL.md`): carrying the guardrails Shape through Triage, Confirm, Admission.
- `setup-pre-commit` (`.claude/skills/setup-pre-commit/SKILL.md`): Husky hooks.
- `git-guardrails-claude-code`: blocking `--no-verify` for Claude Code agents.
- `adversarial-review` (`.agents/skills/adversarial-review/SKILL.md`): checking the Shape and later reviews.
- `writing-for-agents` (`.claude/skills/writing-for-agents/SKILL.md`): every instruction for Codex.
- `retro` (`.claude/skills/retro/SKILL.md`): poteto's "encode lessons in structure" principle (`cursor/plugins` `pstack/skills/principle-encode-lessons-in-structure`) is the lens.
