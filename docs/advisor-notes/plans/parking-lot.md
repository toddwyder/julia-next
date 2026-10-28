# Parking lot

Ideas Todd wants eventually but that aren't needed to get the machine going. Not in the order of work. When one comes back, it goes through `/triage` like any card.

- **Dashboard as a board** (parked 24 Oct 2026). Cards in columns (Ready, Building, Checking, Complete); the running card shows a GitHub-style checklist (done, working, to go, skipped with reason), cost against the $2 cap, context window and models; each card title links to its Linear card. Inspired by Mastra Factory's board. Mockup: "Julia Control Board" in Todd's artifacts (https://claude.ai/artifact/WeHHUcKgGwQAYq4tLBXoR8). Lesson behind it: settle visible work with a mockup before building.
  - **Two jobs** (Todd, 25 Oct): a control plane while building, and decision support for continuous improvement between builds.
    - Control plane: is it running, is it stuck, does anything need me now? Live state, checklist, cost so far, Start/stop. Glanced at often.
    - Decision support: what keeps going wrong, where does the money go, which lessons to approve? History across cards: spend per card and model, stops and causes, review verdicts, send-backs, retro fixes awaiting Todd. Used between builds.
    - Different most-important things, so likely two views rather than one screen.
    - Decision support needs each build to record that history as data. Some is recorded (spend per card and model); stop reasons, review verdicts and send-backs may exist only as prose in Linear. The grill lists what each decision needs so gaps show before design.

- **Design process** (parked 25 Oct 2026). A process for design that works like pstack does for building, usable by any agent (Codex, Claude, Kimi, Argon or others). Todd isn't a designer and won't pay for Figma. First use: the dashboard redesign above.
  - Framework (agreed 25 Oct): grill first on what it does and why, then design.
    1. **Grill** (`grill-with-docs` at the Idea step): the job (who opens the screen, what question they're answering), everything that must be on it ranked by importance, and the flow in words (screens, actions, where each leads). Todd answers; no visuals yet.
    2. **Layout sketches:** two or three rough grey-box layouts. Todd picks on one question: does the most important thing jump out first?
    3. **Look, decided once:** colours, fonts and spacing set up once as a design system and reused by every screen.
    4. **Build and compare:** builder makes the picked layout in the design system; a check compares the built page with the sketch at desktop and phone widths.
    5. **Five-second test:** Todd looks at the real page for five seconds and answers the question from the grill. Can't answer → back to the build.
  - Borrowed from: Double Diamond (understand the problem before designing) and Shape Up's breadboarding (flow in words before visuals).
  - Reference: OpenAI's Product Design plugin (`openai/plugins`, `plugins/product-design`): get context → ideate (three visual options) → image to code → design QA → share. Licence "Proprietary": copy ideas, not text. Its OpenAI-only parts are image generation and OpenAI hosting.
  - Candidate tools: Google Stitch through its MCP connection for sketches (free tier; any agent can reach it); Vercel previews for sharing. No Figma.
  - Considered and set aside: OpenDesign (open-source design workspace; overlaps with Stitch).
