# AGENTS.md

GitHub issues enter Factory's Intake; Todd starts them, and Factory plans, builds and reviews.
Todd tests product changes on the live app after merge and can request a revert. For Julia cards,
Factory's reviewer merges the PR when its review passes and CI is green, then moves its Review card
to Done for Todd's live UAT. Open PRs stay outside Done. An agent outside Factory may merge only
its own setup or documentation PR through the publisher App pinned to the reviewed head, never a
Factory card. Keep SSH and sudo outside the Factory sandbox; an authorized operator uses the
laptop's Tailscale route.

## Building and reviewing

Follow the approved plan; it answers the questions skills ask (scope, seams, acceptance criteria,
verification, observability). Build test-first with `.claude/skills/tdd/SKILL.md`; review with
`.claude/skills/code-review/SKILL.md` against [CODING_STANDARDS.md](CODING_STANDARDS.md). The
reviewer records evidence for the five checks in `CODING_STANDARDS.md`, or explains why a check
does not apply.

## Authorization and blockers

Keep Todd's start authorization and explicit model/spend choices. Never ask Todd for an exception
or workaround approval. If an authorization boundary or platform limit blocks the next required
action, park the card through Factory's existing card/Needs attention route with one line explaining
why.

## Server and domain

Keep SSH and sudo outside the Factory sandbox; an authorized operator uses the laptop's Tailscale
route. See `docs/agents/server-runbook.md`. Domain model: `CONTEXT.md`; decisions: `docs/adr/`;
routes: `docs/agents/work-execution.md` and `docs/adr/0009-mastra-factory.md`.
