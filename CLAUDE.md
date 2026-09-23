# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Laptop sessions are the exception, not the route

The graph does the work. Work reaches it by moving a card to the Ready queue (or by `julia-run`
on the server), not by a laptop session doing it by hand. Before doing anything else, a laptop
session must state, in one plain sentence, **why the graph cannot do this job**. The normal
reason is "the graph is broken and can't repair itself" (for example: the fix needs root, a
sign-in only Todd's account can do, or the thing that broke is the graph's own launcher). If the
honest answer is anything else, stop: put the work in the Ready queue instead and end the session.

**Tick as you go.** Tick each checkbox on the card you're working the moment its evidence is posted, in the same step. Never tick at the end, and never tick before the evidence exists. The checkbox count is Todd's only view of progress.

**Finish the card.** When the work is done and the report is posted, move the card to UAT and assign it to Todd. Never leave a finished card in Backlog, and never move it to Complete; acceptance is Todd's.

## Framework-first rules (JUL-116)

1. Read the framework's official docs before writing code, and post a framework map (need → framework feature → docs link) on the card.
2. Start from the framework's own example and change as little as possible.
3. `npm run lint:framework` must pass. Hand-built progress files, retry or wait loops, and controller code over 400 lines are refused unless skipped with an ESLint comment that gives a reason and a docs link, and listed on JUL-115.
4. Before proposing to build anything, name the existing tools checked and why they don't fit.

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

Details, the account table and the known traps are in `docs/agents/server-runbook.md`.

## Project Overview

`julia-next` is the restart of Julia, an offline-first PWA culinary management tool (recipe
intake, menu planning, shopping lists, kitchen prep, full-screen cook mode). The prior codebase
(`toddwyder/Julia`) is frozen as of 2026-09-15. See `docs/adr/0001-restart.md` for why, and
`docs/CONTEXT.md` (once written) for the domain model as it's established.

## Agent skills

### Issue tracker

Issues live in Linear (team Julia-next), via the Linear MCP tools — not GitHub issues. See
`docs/agents/issue-tracker.md`.

**Clean up every test or throwaway card you create.** Any test or throwaway Linear card an agent
creates must be cancelled by that same agent, with a one-line reason, before its ticket counts as
done. Leftover test cards count as unfinished work, not board noise — five of them sat on the
board for two days before Todd found them.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`,
`wontfix`), unchanged from the skill's defaults. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root, decisions in `docs/adr/`. See
`docs/agents/domain.md`.
