# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Laptop sessions are the exception, not the route

The graph does the work. Work reaches it by moving a card to the Ready queue (or by `julia-run`
on the server), not by a laptop session doing it by hand. Before doing anything else, a laptop
session must state, in one plain sentence, **why the graph cannot do this job**. The normal
reason is "the graph is broken and can't repair itself" (for example: the fix needs root, a
sign-in only Todd's account can do, or the thing that broke is the graph's own launcher). If the
honest answer is anything else, stop: put the work in the Ready queue instead and end the session.

## Reaching the server

Do not stop and ask whether you can reach the server. The route is set up and used every day:

- **SSH (over Tailscale):** `ssh -i ~/.ssh/ovh_runner_ed25519 ubuntu@100.125.239.98` (`scp -i` the
  same way; use Git Bash, not raw PowerShell).
- **`ubuntu` has passwordless sudo.** It is the installation channel: install files under `/opt` and
  `/etc`, manage systemd, run a command as another account with `sudo -u <account>`.
- **Publishing runs on the server as `orchestrator-svc`, never with a personal git or `gh`
  credential from the laptop.** Get the commit onto the server (`git bundle` + `scp`), then run
  `publish-pr.mjs` and `merge-pr.mjs` from `/srv/orchestrator-svc/julia-next` via
  `sudo -u orchestrator-svc`, with the App's key loaded from `/etc/orchestrator-svc/.env.publisher`.
  Merging needs `--sha <reviewed-head-commit>`.

Details, the account table and the known traps are in `docs/agents/jul43-coordinator-runbook.md`.

## Project Overview

`julia-next` is the restart of Julia, an offline-first PWA culinary management tool (recipe
intake, menu planning, shopping lists, kitchen prep, full-screen cook mode). The prior codebase
(`toddwyder/Julia`) is frozen as of 2026-09-15. See `docs/adr/0001-restart.md` for why, and
`docs/CONTEXT.md` (once written) for the domain model as it's established.

## Agent skills

### Issue tracker

Issues live in Linear (team Julia-next), via the Linear MCP tools — not GitHub issues. See
`docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`,
`wontfix`), unchanged from the skill's defaults. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root, decisions in `docs/adr/`. See
`docs/agents/domain.md`.
