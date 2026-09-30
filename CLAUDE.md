# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Factory does the work

Cards are built and reviewed by Mastra Factory, used the way its makers intend (ADR 0009). A
card starts only when Todd taps it in Factory's Intake column. A laptop session never builds,
reviews, moves, or merges a Factory card by hand, and never uses Factory's GitHub keys. Laptop
sessions set up and look after Factory itself, and write specs and documents.

**Use the product, not a workaround.** Use the built-in feature of Factory, Mastra, or GitHub for
anything they already do; check their docs or package source before saying they can't. Before
any custom script, workaround, or change to Mastra's code, stop and tell Todd the gap, the docs
you checked (with links), and what breaks without it. Todd approves or refuses; approved pieces go
on the exceptions list in `ops/factory/README.md`. Use the stock product first and improve only
what real use shows is lacking.

Factory's Work and Review boards and Needs attention list show progress; do not drive a card through
Linear or manually move its Factory stage. The plan is saved with the pull request. Todd tries
product changes on the live app after merge and can request a revert. For Julia cards, Factory's
reviewer merges the PR when its review passes and CI is green, then moves its Review card to Done.
An agent outside Factory may merge its own setup or document-only pull request via the publisher
App pinned to the reviewed head, never a Factory card.

Factory builds test-first using `.claude/skills/tdd/SKILL.md` and the plan's named seams.
See `docs/agents/work-execution.md` and `docs/adr/0009-mastra-factory.md` for the full route.

## Framework-first rules (JUL-116)

These apply to any code written outside Factory's own sessions too.

1. Read the framework's official docs before writing code, and post a framework map (need → framework feature → docs link) on the card.
2. Start from the framework's own example and change as little as possible.
3. `npm run lint:framework` must pass. Hand-built progress files, retry or wait loops, and controller code over 400 lines are refused unless skipped with an ESLint comment that gives a reason and a docs link, and listed on JUL-115.
4. Before proposing to build anything, name the existing tools checked and why they don't fit.

## Reaching the server

Keep SSH and sudo outside the Factory sandbox. An authorized operator uses the laptop's
Tailscale SSH route; never copy a private key into Factory or request one in chat.

- **Operator SSH (over Tailscale):** `ssh -i ~/.ssh/ovh_runner_ed25519 ubuntu@100.125.239.98` (`scp -i` the
  same way; use Git Bash, not raw PowerShell).
- **`ubuntu` has passwordless sudo.** It is the installation channel: install files under `/opt` and
  `/etc`, manage systemd, run a command as another account with `sudo -u <account>`.
- **Factory card publishing and merging stay in the stock Factory/GitHub route.** An agent
  outside Factory may use the publisher App to merge its own setup or document-only PR pinned
  to the reviewed head; it must never merge a Factory card. See `docs/agents/work-execution.md`.

Details, the account table and the known traps are in `docs/agents/server-runbook.md`.

## Project Overview

`julia-next` is the restart of Julia, an offline-first PWA culinary management tool (recipe
intake, menu planning, shopping lists, kitchen prep, full-screen cook mode). The prior codebase
(`toddwyder/Julia`) is frozen as of 2026-09-15. See `docs/adr/0001-restart.md` for why, and
`CONTEXT.md` for the domain model.

## Agent skills

### Issue tracker

New work goes in GitHub issues, where Factory's Intake picks it up; nothing starts until Todd
taps it. Linear is a read-only historical library, not a route for new work or status changes.
See `docs/agents/issue-tracker.md` for GitHub issue conventions.

### Triage labels

Factory's Intake is the queue; no issue label is required to start work. See
`docs/agents/issue-tracker.md` for current conventions.

### Domain docs

Single-context: `CONTEXT.md` at the repo root, decisions in `docs/adr/`. See
`docs/agents/domain.md`.
