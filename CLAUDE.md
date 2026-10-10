# CLAUDE.md

## Delivery route

Mastra Factory is **RETIRED**. Its code, server service, public endpoint, credentials, database,
timers, and repository source are gone. Do not create, restart, or repair a Factory route.

New Julia and machine cards live in Linear. Linear owns cards, requirements, acceptance criteria,
and status; GitHub owns code, commits, pull requests, and CI; Run files own execution state. The
intended delivery route is the adapted JUL-122 runner, started on Todd's Windows laptop with
`$init JUL-nnn`. The adapted runner and `$init` wrapper are pending implementation and verification.
This documentation checkpoint does not authorize starting delivery through them. The adapted
runner's complete test suite must pass on Todd's Windows laptop before it is used for delivery. UAT
means Todd testing the Vercel preview before merge, using only the card's household-facing steps.

## Authorization and blockers

Keep Todd's start authorization and explicit model/spend choices. Never ask Todd for an exception
or workaround approval. If an authorization boundary or platform limit blocks the next required
action, park the Linear card with one line explaining why.

## Building and reviewing

Follow the repository's [AGENTS.md building and reviewing requirements](AGENTS.md#building-and-reviewing).

## Reaching the server

Keep SSH and sudo outside automated runners. An authorized operator uses the laptop's Tailscale
route; never copy a private key into a runner or request one in chat.

- **Operator SSH (over Tailscale):** `ssh -i ~/.ssh/ovh_runner_ed25519 ubuntu@100.125.239.98`.
- **`ubuntu` has passwordless sudo** as the installation channel; manage systemd and run commands
  as another account with `sudo -u <account>`.

Details and the account table are in `docs/agents/server-runbook.md`.

## Domain and tracker

Domain model: `GLOSSARY.md`. Decisions: `docs/adr/`. New Julia and machine work goes in Linear;
Linear owns cards, requirements, acceptance criteria, and status. GitHub owns code, commits, pull
requests, and CI. Run files own execution state. GitHub issues are not the active card tracker.
