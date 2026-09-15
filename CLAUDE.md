# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Project Overview

`julia-next` is the restart of Julia, an offline-first PWA culinary management tool (recipe
intake, menu planning, shopping lists, kitchen prep, full-screen cook mode). The prior codebase
(`toddwyder/Julia`) is frozen as of 2026-09-15. See `docs/adr/0001-restart.md` for why, and
`docs/CONTEXT.md` (once written) for the domain model as it's established.

## Agent skills

### Issue tracker

Issues live as GitHub issues on this repo, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`,
`wontfix`), unchanged from the skill's defaults. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root, decisions in `docs/adr/`. See
`docs/agents/domain.md`.
