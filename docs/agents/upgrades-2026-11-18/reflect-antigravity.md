# Reflect: 18 Nov 2026 dependency upgrades

Mined from the Antigravity session covering the 18 Nov 2026 dependency upgrades, PR #559, and the `ovh` rollout. No skill was edited.

## Accepted

### 1. Ensure generated formal-verification skills are tracked by git
- **Problem.** `create-formal-verification-skill` instructs the agent to write a project-local verify skill (`.agents/skills/<name>/SKILL.md`), but in repos where `.agents/` is excluded in `.git/info/exclude`, `git add` silently skips the new `SKILL.md` while committing `formal/` and `scripts/`.
- **Proposal.** Under **Generate the verify skill** in `.agents/skills/create-formal-verification-skill/SKILL.md`, add a step to verify the new `SKILL.md` is tracked (`git ls-files`, using `git add -f` if excluded) before handoff.
- **Skill.** `create-formal-verification-skill` (destination: `.agents/skills/create-formal-verification-skill/SKILL.md`).

### 2. Document Windows PowerShell 5.1 command chaining and search fallback
- **Problem.** On Windows hosts running PowerShell 5.1, `&&` fails to parse and `rg` may not be installed, causing wasted failing tool calls before switching to `;` and `git grep`.
- **Proposal.** Under **Harness** in `.agents/skills/poteto-mode/SKILL.md`, add a note that on Windows PowerShell 5.1, commands chain with `;` (not `&&`) and `git grep` replaces `rg` when absent.
- **Skill.** `poteto-mode` (destination: `.agents/skills/poteto-mode/SKILL.md`).

## Rejected

- **Wait for PR and merge-commit CI before reporting.** Already stated in `AGENTS.md` and `poteto-mode` (`Babysit` / `Shipping` playbooks).
- **Prove formal checks fail on a broken variant before handoff.** Already required by `create-formal-verification-skill` (**Able to fail** and **Prove it before you hand off**).
- **Route CLI resume/status through Studio's HTTP API.** Codebase-specific design rule already enforced by `machine/flow/start.test.mjs` and `formal/flow/TwoWriters.tla`, not a general skill edit.
- **Session SHAs, PR numbers, and package versions.** Drift details excluded by `reflect`.

## Backlog

1. **Check tracked verify skills in `scripts/check-skill-names.mjs`.** Fail when a `formal/<area>/` model exists without a git-tracked `SKILL.md`.
2. **Wire TLA+ model checks into `.github/workflows/ci.yml`.** Run `check:recipes-model` and `check:two-writers-model` in CI and reconcile the `tla2tools-1.8.0.jar` SHA256 in `scripts/check-recipes-model.mjs`.
3. **Sync `julia-flow-repo` and `julia-builder` on `ovh` when idle.** Add an idle-only pull-and-restart check for `julia-studio.service` after `main` merges.
4. **Resolve vendored `.claude/skills/` anchor failures in `scripts/check-agent-links.mjs`.** Ignore vendored `.claude/skills/` anchors or rewrite broken upstream anchors during skill syncs.
