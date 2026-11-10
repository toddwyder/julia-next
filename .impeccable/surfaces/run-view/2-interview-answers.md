# Run view: design interview answers (7 Nov 2026, from 14:16)

Impeccable `shape` (`.agents/skills/impeccable/reference/shape.md`), Phase 1, one question at a time. Continues `handoffs/handoff-2026-11-07-1415.md`.

## Todd's answers
1. **At a glance, in order:** where we are (stage and step); tokens used; where we are against quota.
2. **Quota:** one per subscription. For now: CommandCode, ChatGPT, Claude (all treated as subscriptions).
3. **No suggested actions.** Alert him to what is wrong, nothing more (replaces the 28 Oct "number plus action" idea for this view).
4. **What counts as wrong:** stopped, stuck, quota close to the limit, burning tokens fast. Adjust after using it.
5. **Where it lives:** a tab on the model picker page (dashboard). Its own card after P3 (JUL-345) merges; not added to P3.
6. **Scope:** detection is JUL-342's job (signals plus Linear warnings). This card only shows them.
7. **Success:** open the tab during a run and, without clicking, see stage and step, tokens so far, each subscription vs quota, and any active alert.
8. **Nothing running:** quota per subscription plus the last run's result (how it ended, what it used).
9. **Several agents at once:** show both each agent and the card as a whole.
10. **Would feel wrong:** tables filled with data; no visual cues; too much to read; card numbers or IDs instead of names; numbers that look exact but aren't (Mastra dollars are list-price estimates); any "black techno dungeon" look (black interface, monospace type, purple dots).
11. **Devices:** mostly laptop; sometimes phone when away from the keyboard.
12. Claude's stated assumption, not contradicted: the tab updates on its own while open.

Process notes from Todd: Claude was leaning on rules too much (14:27); "lines" in a question was a premade design choice, so ask about content, not layout (14:30). The dashboard is big and could use a better design, but that is separate work.

## Research behind it (Mastra 1.82.0 docs, spot-checked by Claude)
- Live tokens: `onStepFinish` per step (`reference-agents-generate.md:512-524`); delegation result carries helper `usage` (`docs-subagents.md:172`).
- Dollars are estimates from list prices (`reference-core-mastra-model-gateway.md:121`), not billing.
- Studio: Metrics dashboard and Traces token/cost columns (`docs-studio-observability.md:91, 101-107`); need a metrics-capable store (DuckDB etc.; not LibSQL). Which store the server uses: not checked.
- Studio shows a running workflow's active step live (`docs-studio-overview.md:82`); the headless build is not a workflow today.
- Studio has no way to add custom pages; custom API routes only (`docs-server-custom-api-routes.md`).
- No Mastra mechanism knows a subscription quota (grep confirmed). Each quota needs its own source. CommandCode credit is web-only (24 Oct). ChatGPT and Claude: not checked.
- Mastra Code docs (code.mastra.ai) not reachable from the cloud session; how the headless builder reports tokens: not checked.

## Dashboard's current look (main, read 14:35)
`dashboard/app/globals.css`: light page (#f3f6f8), white rounded cards, Public Sans, mint green buttons, iris (indigo) links and focus, amber and rose for warnings. No DESIGN.md or PRODUCT.md in `dashboard/`. P3's picker changes are on its branch, not checked.
Impeccable `new-work.md` §3: a tab inside an existing surface normally inherits that surface's look (no concept round).

## Still open (at the time of the interview; later settled in the brief)
- Phase 2: inherit the dashboard's current look, or treat the tab as the start of a new look.
- Realistic ranges from past runs; check P3's picker page layout before the brief.
- Then Phase 3 brief, confirm, stop.
