# Product

<!-- impeccable:product-schema 1 -->

<!-- Approved by Todd 7 Nov 2026 14:38 for dashboard/PRODUCT.md. Not yet committed to the repo; the builder commits it as written. -->

## Platform

web

## Users
Todd only. He is not a programmer. Mostly on the laptop while he works; sometimes on his phone when he is away from the keyboard.

## Product Purpose
The control page for the machine that builds Julia with AI agents. Todd picks a Ready card from Linear, chooses which models do which job, starts it, and watches it run.
Success: at a glance he knows what stage a run is in, what step within that stage, and whether it is running at all; what it has used against each subscription; and whether anything is wrong. Without reading through data.

## Positioning
One person steering paid AI agents across three subscriptions (CommandCode, ChatGPT, Claude). Money and quota matter as much as the code.

## Operating Context
- Runs on the server, reached over Tailscale.
- Cards, and the warnings the machine sends, live in Linear.
- Todd also uses Mastra Studio; the dashboard is where he picks models and watches runs.

## Capabilities and Constraints
- Ready cards list, a Start screen per card, and the model picker (being rebuilt as P3 of JUL-342).
- Run view: a tab on the model picker page (designed 7 Nov; see `plans/run-view-interview-2026-11-07.md` in the Project).
- Dollar figures are estimates (list prices) and must read as estimates.
- Name work by its title, not by card numbers or IDs.
- No subscription quota is machine-readable today through Mastra; each needs its own source (CommandCode credit is web-only).

## Brand Commitments
- Never a dark developer-tool look: no black interface, no monospace type, no purple dots.
- Never a builder's default look. The current dashboard look (light grey, white cards, mint and indigo) was a builder default and is being replaced; it carries no authority.
- No tables filled with data; use visual cues.
