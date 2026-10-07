# AGENTS.md

Mastra Factory is **PAUSED**, not removed. Its code and server service stay as they are; do not
start Factory cards or alter that route. In the retained, inactive Factory route, its reviewer merges the PR
only after review passes and CI is green.

New Julia and machine cards live in Linear. Linear owns cards, requirements, acceptance criteria,
and status; GitHub owns code, commits, pull requests, and CI; Run files own execution state. The
intended route is the adapted JUL-122 runner, started on Todd's Windows laptop with `$init JUL-nnn`.
The adapted runner and `$init` wrapper are pending implementation and verification. This
documentation checkpoint does not authorize starting delivery through them. The adapted runner's
complete test suite must pass on Todd's Windows laptop before it is used for delivery. UAT means
Todd testing the Vercel preview before merge, following the card's steps as a household member would.

GitHub issues and Factory's publisher App remain historical Factory infrastructure. The publisher
App and `scripts/publish-pr.mjs` / `scripts/merge-pr.mjs` must not be used for Linear cards. Keep
SSH and sudo outside the Factory sandbox; an authorized operator uses the laptop's Tailscale route.

## Building and reviewing

Follow the approved plan; it answers the questions skills ask (scope, seams, acceptance criteria,
verification, observability). Build test-first with `.claude/skills/tdd/SKILL.md`; review with
`.claude/skills/code-review/SKILL.md` against [CODING_STANDARDS.md](CODING_STANDARDS.md). The
reviewer records evidence for the five checks in `CODING_STANDARDS.md`, or explains why a check
does not apply.

## Authorization and blockers

Keep Todd's start authorization and explicit model/spend choices. Never ask Todd for an exception
or workaround approval. If an authorization boundary or platform limit blocks the next required
action, park the Linear card with one line explaining why; do not use Factory's Needs attention
route while Factory is paused.

## Server and domain

Keep SSH and sudo outside the Factory sandbox; an authorized operator uses the laptop's Tailscale
route. See `docs/agents/server-runbook.md`. Domain model: `GLOSSARY.md`; decisions: `docs/adr/`;
routes: `docs/agents/work-execution.md` and `docs/adr/0009-mastra-factory.md`.
