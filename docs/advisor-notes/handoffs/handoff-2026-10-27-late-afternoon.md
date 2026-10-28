# Handoff, 27 Oct 2026, ~14:50 PT (advisor, acting as requirements + design agent in the dashboard pilot)

Supersedes `handoffs/handoff-2026-10-27-afternoon.md` on the Stitch connection and D2's next step. Everything else there still stands (interview results, taste profile, facts owed, side work, how to work with Todd). Read it in full.

## The next session's job

Continue the dashboard pilot at **D2, step 2: Stitch variants of the board screen**. Todd asked for a fresh context before starting the looks so the step isn't cut off midway. **Don't send the drawing instruction until Todd says go**; the draft below is not agreed yet. Walk him through it first.

## What changed this session

- **Stitch facts, from Google's own docs** (https://app-companion-430619.appspot.com/docs/mcp/setup/index.html, part of stitch.withgoogle.com docs): hosted MCP server at `https://stitch.googleapis.com/mcp`, remote HTTP, API key in header `X-Goog-Api-Key`, key made in Stitch → Settings → API Keys → Create API Key. Tools: `create_project`, `get_project`, `list_projects`, `list_screens`, `get_screen`, `generate_screen_from_text`, `edit_screens`, `generate_variants`, `create_design_system`, `update_design_system`, `list_design_systems`, `apply_design_system`. No local `npx` proxy needed.
- **This cloud chat cannot reach Stitch.** `stitch.googleapis.com` is refused by the session's network proxy. The fix would be the cloud environment's network settings (Anthropic docs: https://code.claude.com/docs/en/cloud-environments.md — **Custom** access with **Allowed domains**, or a **Network secret** for the host). For a chat inside a Project, the environment comes from the Project's settings; the chat's title menu has no "Edit cloud environment" (Todd checked: Pin, Rename, Change project, Remove from project, Share session, Copy link, Archive, Delete). The Project settings page could not be verified from here, so **don't send Todd looking for it**.
- **The laptop link gives file access only** (no shell); it doesn't help.
- **Route chosen (Todd, 14:36): the server agent makes the Stitch calls** with the key from the vault; the advisor writes prompts and reads results from GitHub.
- **Key saved:** Todd created the Stitch key and saved it in the **"Julia agents"** vault as item **`Stitch`**, key in field **`credential`** (14:42).
- **Merged:** PR #364 (`c301cc5`): `STITCH_API_KEY=op://vxp5hm42azkyi6mrtoohkthzlq/Stitch/credential` in `scripts/julia-agents.env`, `STITCH_API_KEY` in `fields` in `scripts/julia-agents.mjs`, `scripts/server/julia-agents.test.mjs` now nine fields. CI green. Made by the advisor directly (Todd: "can't you or codex do that"). Item referenced by name, not ID. **Unproven on the server**: no real call has run. The first step of the drawing instruction is that proof (`tools/list`). Server tests aren't run by CI (no server job in `ci.yml`), so the nine-field test also only runs on the server.
- Leftover branch `correct/2026-10-27` on GitHub is not the advisor's; not touched.

## Draft drawing instruction (not agreed; walk Todd through before sending)

For the agent in the "Julia builder" terminal. Delivery: a **draft PR never merged** on `pilot/dashboard-d2` (files under `docs/pilot/dashboard-d2/`), so the advisor can read screenshots via GitHub. This is a repo branch during the pilot; Todd agreed to the key-list change but not explicitly to this branch. Confirm.

> Dashboard pilot, D2: draw three look-and-feel variants of one screen in Google Stitch. Pull main first. Run every Stitch call through `node scripts/julia-agents.mjs --` with header `X-Goog-Api-Key: $STITCH_API_KEY` to `https://stitch.googleapis.com/mcp` (Google's Stitch MCP docs). First call `tools/list` and read each tool's parameters; save that output. Never print the key.
>
> 1. Create a Stitch project "Julia dashboard pilot".
> 2. Create three design systems, one per look below, then generate the board screen (layout prompt below) once in each, at desktop and at phone width — six screens. If a tool offers device type, use it.
> 3. Save into `docs/pilot/dashboard-d2/` on branch `pilot/dashboard-d2`: each screen's screenshot (PNG) and HTML, each design system's settings, every prompt you sent, and the `tools/list` output, with an `index.md` listing each file. Push and open a **draft** PR titled "Dashboard pilot D2 screens (not for merge)". Do not merge it.
> 4. If Stitch errors or a call is refused, record the full response in `index.md` and try the next step anyway.
>
> **Layout prompt (same for all three):** A board for one person, Todd, to see his software factory at a glance on a phone. Eight columns left to right: Backlog, Ready, Implementation, Evidence review, Remediation, Staging/smoke test, UAT, Complete. One tile per card. Top strip "Needs you (2)": "Try the recipe screens (UAT)" and "Approve 3 retro fixes". Tiles: Backlog — "Bring my Samsung Food recipes into Julia". Ready — "Scorecard for every run, plus a ping" with a Start button. Implementation, running — "New machine: retry and pause": step 4 of 8, "Doing now: running tests", active 40 s ago, 12 min elapsed, $0.84 spent, context 41% full, two agents inside (Main session, Coder), Stop button. Remediation, stuck — "Practice: real failure path": no activity for 7 min, clearly marked stuck. UAT, waiting on Todd — "Recipe screens look like Julia's vintage design", marked waiting on you (different from stuck). Complete — "Add a recipe and find it by title". Each tile links to its Linear issue. A small "Decision support" link at the top. Plain words, no technical terms. On the phone the columns scroll sideways and the "Needs you" strip stays on top.
>
> **Look A, light board:** white, lots of space, each column its own soft colour that means something (grey waiting, blue running, amber stuck, purple waiting on you, green done). Trello-like cards: title first, status as small coloured pills and icons.
> **Look B, friendly tracker:** warm off-white, rounded cards, pastel colour per status, progress as a big round ring on running cards (habit-tracker style), friendly sans-serif.
> **Look C, infographic:** clean white, strong type, status as charts: thin step bar per card, small time-since-activity gauge, cost as a bar against the limit (NYT-graphic style).
>
> All three: light, colourful, no dark or terminal look, status never by colour alone (always an icon or word too). Report the draft PR link when done.

Points to check with Todd before sending (one at a time):
- The three looks are the advisor's reading of his taste profile; he may want to change one.
- Card titles are real Linear titles (some shortened); states and numbers are invented for the picture.
- Stitch docs (front-door research note) say colours and fonts live in the design system and prompts carry layout and content only; the draft follows that (one layout prompt, three design systems).
- The phone layout ("columns scroll sideways") conflicts with "each view fits a phone screen without scrolling" in the taste profile. Raise it; the board may need a different phone layout (e.g. one column at a time, or a summary list).

## Pilot findings to propose for the doc (not written; ask Todd first)

- **D2 Stitch, connection:** the doc assumed the agent can call Stitch from wherever it runs. The advisor's cloud chat can't (network allowlist, Project-level setting not reachable). The working route is the server agent with the key from the vault via `scripts/julia-agents.mjs`. Answers Part 2 open item 1 ("who holds the key must not land on Todd"): Todd's only step was creating the key and saving it once in the "Julia agents" vault.
- **D2 Stitch, delivery:** the design agent needs a way to show Todd the screens. Stitch projects are visible in Todd's own Stitch account (he signs in there); a GitHub draft PR is how the advisor sees them. Decide which is the real route.
- The earlier-handoff findings (R4 formality, D1 read-back caught two wrong assumptions, D2 probe without recommendations, doc fix removing the dashboard pre-routing) are still unwritten too.

## How to work with Todd (this session)

- He stopped a guessed walkthrough: "verify your walkthrough instead of guessing because it wastes lots of time." Check UI steps in official docs first; if a step can't be verified, say so and don't send him.
- He prefers the advisor or an agent do the work rather than him pasting (asked "can't you or codex do that"). The advisor can make repo changes and merge through GitHub REST (PR via `gh api`, merge via `PUT .../merge`; `gh pr create` fails on GraphQL). Branch delete via API is blocked; the merged branch disappeared on its own.
- Fresh context before long steps so they aren't cut off.

## Access

- julia-next: `add_repo` (owner `toddwyder`, repo `julia-next`, access push) first; clone `/home/claude/julia-next`. REST only.
- Linear tools work. Server not reachable. Stitch not reachable from the cloud chat.
