---
name: "tighten"
description: "Tighten a plan, brief, card, slice or agent prompt before it goes to Todd or an agent. Use when creating or editing any of them."
---

# Tighten

Six steps, in order. Each step ends when its completion criterion holds.

## 1. Cut to what blocks (YAGNI)

List every item in the draft. Keep an item only if the next step cannot start without it. Move housekeeping to one cleanup card. Read the neighbouring slices, the plan and AGENTS.md, and delete whatever is already enforced elsewhere, repeated in another slice, or untestable before the next step exists.

Done when every item names what it unblocks and appears once.

## 2. Move it up the pyramid (code, not prose)

Take each rule, instruction or hope in the draft and climb docs/principles/inverse-pyramid.md from the top: first a change to the code itself (types, structure, a boundary that makes the right thing the easy thing), then a lint rule, test, CI check or verification, then prose. Write a rule as prose only when no code can hold it.

Done when every prose rule names the rungs above it and why none could hold it.

## 3. Sharpen

Run the sharpen skill on what is left: how an expert would do this, what Todd is really after, whether it is over- or underspecified. Name one outside check that someone other than the author runs.

Done when the outside check is written down.

## 4. Map the path

List every dependency the agent will meet: credentials, permissions, access, a human click, a vault it cannot see. Settle each one in the draft. Reduce a human action to one atomic approval, and design a secret out of the path instead of passing it to Todd.

When the agent will open a pull request, tell it to name only the card its branch ships in the description. CI asks for a scorecard for every card key it finds, so a card mentioned in passing costs a full CI cycle.

Done when the agent holds every answer it needs.

## 5. Write for agents

Apply the writing-for-agents skill: positive phrasing, one source of truth per meaning, a completion criterion per step, plain words, and only lines that change what the agent does. Write each criterion as a command plus a condition that stays true while the code changes, and leave counts out: "runs 7 tests" fails the day an eighth test is added. For a card, run `node scripts/check-agent-brief.mjs <file>`.

Done when the checker exits 0 and every criterion is something Todd can see.

## 6. Hand over

Present with the advisor skill: one copyable block, a plain line on what it does and why, every link in the same message. Julia prompts also pass julia-route-check.

Done when Todd can send it unchanged.