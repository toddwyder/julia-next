# CLAUDE.md

## Factory does the work

Cards are built and reviewed by Mastra Factory, the way its makers intend (ADR 0009). A card
starts only when Todd taps it in Factory's Intake column. The plan is saved with the pull request.
For Julia cards, Factory's reviewer merges the PR when its review passes and CI is green, then
moves its Review card to Done for Todd's live UAT. Open PRs stay outside Done. An agent outside
Factory does not build, review, move, or merge a Factory card.
The publisher App remains limited to the Factory-card route; machine-card GitHub writes use
ordinary authorized access as documented in `docs/agents/work-execution.md`.

Factory's plan names `.claude/skills/implement/SKILL.md` for feature cards and
`.claude/skills/diagnosing-bugs/SKILL.md`, then `.claude/skills/code-review/SKILL.md`, for
defect cards. See `docs/agents/work-execution.md` and `docs/adr/0009-mastra-factory.md`.

## Authorization and blockers

Keep Todd's start authorization and explicit model/spend choices. Never ask Todd for an exception
or workaround approval. If an authorization boundary or platform limit blocks the next required
action, park the card through Factory's existing card/Needs attention route with one line explaining
why.

## Reaching the server

Keep SSH and sudo outside the Factory sandbox. An authorized operator uses the laptop's Tailscale
route; never copy a private key into Factory or request one in chat.

- **Operator SSH (over Tailscale):** `ssh -i ~/.ssh/ovh_runner_ed25519 ubuntu@100.125.239.98`.
- **`ubuntu` has passwordless sudo** as the installation channel; manage systemd and run commands
  as another account with `sudo -u <account>`.

Details and the account table are in `docs/agents/server-runbook.md`.

## Domain and tracker

Domain model: `GLOSSARY.md`. Decisions: `docs/adr/`. New work goes in GitHub issues, where Factory's
Intake picks it up; Linear is read-only history. See `docs/agents/issue-tracker.md`.
