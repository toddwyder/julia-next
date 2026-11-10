Section 7 was answered on 10 Nov 2026 in `docs/advisor-notes/run-view-technical-checks-2026-11-10.md`.

# Run view: design brief (7 Nov 2026; confirmed by Todd 17:45)

From the Impeccable `shape` interview (`plans/run-view-interview-2026-11-07.md`) and the dashboard product record (`plans/dashboard-PRODUCT-2026-11-07.md`). Design board: https://claude.ai/artifact/R2q6DWx4ba8CRXBgETJiXJ (chosen board: **A2 · The larder, bolder**). All data on the board is synthetic.

## 1. Job and audience
Todd, alone, during a run. Mostly on the laptop; sometimes the phone when away. Not a programmer. He opens the tab to answer, without clicking: where is the run, what has it used, is anything wrong.

## 2. Outcome and proof
- At a glance: the stage, the step within that stage, and whether the run is running at all; tokens so far; each subscription (CommandCode, ChatGPT, Claude) against its quota; any active warning.
- Each helper is shown on its own, with its full list of steps (done, now, to do, stuck), plus the card as a whole.
- Warnings say what is wrong and nothing more (no suggested fixes). This card works them out itself (Todd, 17:43; the machine-fix card no longer does):
  - **Stopped:** the run's status is stopped or failed.
  - **Stuck:** no activity for 7 minutes (Todd, 28 Oct).
  - **Quota low:** a subscription has 20% or less left (Todd, 17:45).
  - **Burning tokens fast:** any one agent's model call over 100k tokens; the warning names the agent. Starting value only; reset from the redesign card's rerun data (Todd, 17:44).

## 3. Selected direction: A2, the larder, bolder (Todd, 15:07)
- Bottle-green header and run panel on a sage ground; ivory cards. No purple, no mustard ground (A3 was "too much yellow").
- Slab display face for headings, plain humanist sans for everything else; large type, the current stage the biggest thing on the page.
- Warnings as in A: bold boxes at the top, dashed for stuck, solid for quota.
- Quota as B's bars (one per subscription, percentage left and reset date), the low one ringed.
- State by shape as well as colour: solid edge working, dashed stuck, struck through stopped.

## 4. Scope and boundaries
- A tab on the model picker page. Its own card, after the models-file piece of the machine-fix card merges; not added to that piece.
- This look becomes the dashboard's new look; the model picker page is retrofitted to it afterwards (separate card). The rest of the dashboard later, if kept.
- Anti-goals: tables filled with data; no visual cues; walls of text; card numbers or IDs in place of names; numbers that look exact but are not (dollars always "estimate"); any dark developer-tool look (black screens, monospace, purple dots); a builder's default look.

## 5. States and ranges
- States: running (one or many helpers), stuck, stopped, quota low, burning fast, finished, nothing running (quota plus a one-line result of the last run).
- Ranges: helpers at once 1 to 5 or more; steps per helper roughly 3 to 7; tokens into the millions per card; quota 0 to 100% left.

## 6. Interaction and layout
- Updates on its own while open; no refresh.
- Top to bottom: warnings, run panel (title, running time, tokens, stages with the current one largest), helpers with their steps, quota.
- Laptop first; on a phone the stages and helper cards stack.

## 7. Technical checks for an agent (the builder must not invent these)
- Quota sources: CommandCode credit is web-only (24 Oct); ChatGPT and Claude not checked. Mastra has no quota mechanism. How each quota line gets its number is open.
- Step names come from each helper's own checklist; whether every helper keeps one (the headless build did not on 2 Nov) is not checked.
- Live tokens: Mastra `onStepFinish` per step; helpers' usage returns with delegation results. How the headless builder reports tokens: not checked.
- The model picker page's layout: not checked.
