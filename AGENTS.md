# AGENTS.md

Mastra Factory is **RETIRED**. Its server, public endpoint, credentials, database, timers,
and repository source have been removed. Do not create, restart, or repair a Factory route.

New Julia and machine cards live in Linear. Linear owns cards, requirements, acceptance criteria,
and status; GitHub owns code, commits, pull requests, and CI; Run files own execution state. The
intended route is the adapted JUL-122 runner, started on Todd's Windows laptop with `$init JUL-nnn`.
The adapted runner and `$init` wrapper are pending implementation and verification. This
documentation checkpoint does not authorize starting delivery through them. The adapted runner's
complete test suite must pass on Todd's Windows laptop before it is used for delivery. UAT means
Todd testing the Vercel preview before merge, following the card's steps as a household member would.

Use ordinary signed-in GitHub access for delivery. Keep SSH and sudo outside automated runners;
an authorized operator uses the laptop's Tailscale route.

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
route: Factory is retired.

## Server and domain

Keep SSH and sudo outside automated runners; an authorized operator uses the laptop's Tailscale
route. See `docs/agents/server-runbook.md`. Domain model: `GLOSSARY.md`; decisions: `docs/adr/`;
routes: `docs/agents/work-execution.md`. The former Factory decision record is historical only.
