<!-- Snapshot of the Linear doc "Requirements process: the front door (27 Oct 2026)" (https://linear.app/julia-next/document/requirements-process-the-front-door-27-oct-2026-e3d610feea2c), last updated 2026-10-28T02:59:25.351Z. Linear holds the live version. -->

# Requirements process: the front door

Status: **in discussion. Nothing here is built or tested.** Todd settled the design agent's process on 26 Oct 2026 and the requirements agent's steps on 27 Oct 2026. Everything in Part 1 is settled unless marked otherwise. Part 2 lists what is still open. Part 3 is history: corrections, lessons and research notes. It is not part of the process.

# Part 1. The process

## The goal

A repeatable front door for any piece of work, doing for requirements and design what the development process does for code. It is a general process, not a one-off dashboard process. The dashboard is the first thing to go through it.

## The two agents

* **Requirements agent.** Takes whatever Todd has, picks the right route, interviews him as the route needs, and turns the result into the **shape** pstack needs: goal, done means, proof wanted, what we know, constraints. It wraps Pocock's skills (mattpocock/skills).
* **Design agent.** Started by the requirements agent when the work has a UI. It works with Todd until he has seen enough to know what is needed and what is not, then hands back.

Each agent is a separate issue in the framework's Linear project and goes through pstack like any other work. Their shapes are made by hand first, since the agents do not exist yet.

## The requirements agent's steps (R1 to R7)

1. **R1. Take whatever Todd gives you.** A raw idea or a thought-through issue. Do nothing before that, and do not search for existing material yet: the agent does not yet know what to look up, so it wastes time, context and tokens. Targeted searching belongs later, once the route is picked and the interview starts.
2. **R2. Invoke** `ask-matt` **by name** to pick the route. It is manual-only, so the agent's instructions must say to invoke it. It does no work itself.
3. **R3. Follow the route it picks:**
   * Raw idea: `grill-with-docs`, then `to-spec`.
   * Thought-through input: `to-spec` directly.
   * Raw bugs or requests that someone else created: `triage`.
   * Huge, foggy effort too big for one session: `wayfinder`, then `to-spec`.
4. **R4. Check for a UI (optional).** Ask Todd whether the work has a UI, or catch the case where `ask-matt` sends you to its prototype detour (a question that needs something visible to settle). If yes, look for an existing design or screen for the thing the work is about (a targeted search is cheap now that the agent knows what the work is about; in Julia, look in the `ui` folder). Then start the design agent, which takes the place of Pocock's `prototype`. Only Todd ends design, by saying "done". On the `triage` route, do this before `triage` runs. On the other routes, do it before `to-spec`.
5. **R5. Run** `to-spec` where the route calls for it. The `grill-with-docs` interview and wayfinder's cleared map both feed it.
6. **R6. Shape the result into five parts:** goal, done means, proof wanted, what we know, constraints. Anything that must be true goes under done means, with a proof ([JUL-272](<https://linear.app/julia-next/issue/JUL-272/add-a-recipe-and-find-it-by-title-jul-208-slice-1-single-user>) lesson: a look listed only under "what we know" was never checked).
7. **R7. Save the shape as a Linear issue in Backlog and stop** (*settled 27 Oct, Todd*). Todd's "settled" moves it to Ready. If `ask-matt` points to `to-tickets` or `implement`, ignore it: building is not this agent's job.

Why `to-tickets` is out: it does the same technical planning and slicing as pstack, so keeping it would mean two slicers. `triage` is `ask-matt`'s on-ramp for raw incoming issues only; it is not a slicer.

## The shape: where it lives and how it is approved

* **One document.** The shape is the formatted spec, and it is the only thing Todd approves. The five parts are the main body. Anything that does not fit goes under "what we know" or "constraints", so nothing is dropped.
* **Saved as a Linear issue**, in the project the work belongs to, so it can be tracked. The five parts are the issue's description.
* **Approval.** The agent saves each issue in Backlog. It moves to Ready only after Todd says "settled".
* **Todd sees it work** (*settled 27 Oct, Todd*). Every piece of work is started and watched from the dashboard, and its proof is something Todd can see working on a screen he uses, without reading code. "Proof wanted" says what he will see. Work with nothing for Todd to see happens only as an exception Todd approves, and the shape says so.
* **The** `triage` **route rewrites the existing issue.** Raw bugs and requests are already Linear issues, so on that route the agent rewrites the existing issue into the five parts instead of creating a second one. It keeps the original text as a comment, so nothing anyone wrote is lost.
* `wayfinder` **ends with one issue per shape**, each standing alone. The map stays as the link between them. (Todd's observation: in Julia, `wayfinder` turned its results into many specs. Possible example: [JUL-208](<https://linear.app/julia-next/issue/JUL-208/keep-a-private-recipe>) to [JUL-222](<https://linear.app/julia-next/issue/JUL-222/bring-my-samsung-food-recipes-into-julia>) in the recipes project, created within a minute of each other on 10 Oct. Not confirmed that `wayfinder` produced them. Stock `ask-matt` says a cleared map collapses into one `to-spec`, so one spec per shape means running `to-spec` more than once.)
* **Big shapes.** If a shape is really big, pstack slices it when the work starts. The requirements agent does not.
* **Where the interview's notes go.** The glossary and decision records from `grill-with-docs` go in the repo of the project the work is about (Julia work in Julia's repo, framework work in the framework's). The agent works out the project from the request. If it is not clear, it asks: "Is this about Julia or the framework?"

## The design is attached to the shape

* The approved design is attached to the shape's Linear issue and shows how the thing the shape describes should look (for a recipe card, the shape says what the card does and the design is its picture).
* Whenever a design is attached, "done means" includes a line that the built screens match it, with the proof being side-by-side screenshots. The evidence review judges that line like any other; there is no separate comparison agent (*settled 27 Oct, Todd*).
* "What we know" carries one line: "Follows the attached design, approved by Todd on \[date\]." If the design changes later, the issue shows it no longer matches.
* **Start from what exists.** If a design or screen already exists for that thing (for example, adding servings and notes fields to the existing recipe card), the design agent starts from it and designs only the change, and attaches the existing screen alongside the new design. It also uses the existing screen to ask Todd about what is already there ("this field is on the screen today, what does it do?"). When a design exists, the design agent skips the look-and-feel probe (the look is already decided), keeps the read-back, and goes to functionality options, unless Todd says to restyle.

## How Pocock's skills are wrapped

Stock skills stay unmodified. The requirements agent's instructions carry the overrides, because the stock skills conflict with our rules in these places.

* `to-spec`
  * It publishes to the issue tracker on its own and applies the `ready-for-agent` label. Our rule: the issue stays in Backlog until Todd says "settled". The agent does not apply that label.
  * Its template is a long spec (problem statement, an extensive list of user stories, implementation decisions, testing decisions). Our output is the five-part shape. The agent uses `to-spec`'s synthesis and its reading of the repo and glossary, and writes the shape.
  * It sketches where tests hook in and asks the user to confirm. The agent skips this step: pstack plans the tests when it builds (*settled 27 Oct, Todd*). "Proof wanted" in the shape stays; it says what Todd or the reviewer will see, not how tests are built.
  * It never interviews ("Do NOT interview the user"). On the direct route (thought-through input), the agent first checks that the input can fill all five parts. If it cannot, it goes through `grill-with-docs` instead of guessing.
* `triage`
  * It applies its own state labels, including `ready-for-agent`. The agent does not move anything to Ready; only Todd's "settled" does. The mapping between triage's labels and Linear statuses still needs to be set up.
  * It writes an "agent brief" comment. The agent instead rewrites the existing issue into the five parts and keeps the original text as a comment.
  * It can close issues as won't-fix. The agent asks Todd first.
* `wayfinder`
  * Its "task" tickets can hand a human a checklist. That is not allowed (Execution Firewall): the agent does the work itself, or where only Todd can act (account authorization), it asks for one atomic step.
  * Its prototype tickets call the stock `prototype` skill. For UI work, our design agent takes that slot.
  * The map and its decision tickets are not build work. They stay out of Ready and away from pstack.
  * It resolves one ticket per session, so this route spans many sessions. The flow picks up at `to-spec` only when the map clears.
  * It depends on the tracker setup step (`/setup-matt-pocock-skills`) for Linear. Not verified as done.
* `grill-with-docs` only calls two other skills:
  * `grilling` asks a whole round of numbered questions at once, each with a recommended answer. The agent asks one question at a time instead: the first question in each round, with its recommended answer worded so "yes" accepts it, holding the rest for later rounds. Finding facts stays the agent's job; decisions are Todd's. Cost: more rounds, so a longer interview and more tokens.
  * `domain-modeling` keeps the glossary in `GLOSSARY.md` (not the `CONTEXT.md` that `ask-matt` mentions) and decision records in `docs/adr/`. It supports several glossaries in one repo through a `GLOSSARY-MAP.md` at the root. The dashboard's setup card has the builder check whether `julia-next` has that map and, if not, set up a separate glossary and decision folder for the dashboard's directory, so its vocabulary does not mix into Julia's.

## Order of design and requirements

It depends on how formed the input is.

* **A raw idea:** interview first, then design. There is nothing yet to draw.
* **A thought-through issue:** design can come first. Seeing it lets Todd realize requirements that are needed, or that are not. This matches `ask-matt`'s own detour for questions that need something runnable or visible, where it uses `prototype`. Our design agent fills that slot. Pocock's prototype is throwaway code; ours may differ.
* In every case design comes before `to-spec`, so what Todd sees can change what the spec says. On the `triage` route, the UI question comes before `triage` runs.

## The design agent's process (D1 to D8)

Two things shape every step. The design agent has **no default look**: it starts from a blank page on every project, because the dashboard and the framework it belongs to are separate from Julia and will be reused across projects. (When a design already exists, see "Start from what exists" above.) And the dashboard has **two jobs**: a control plane for the inner loop (glance, see status, step in) and a decision tool for the outer loop (evidence, comparison, tradeoffs). The design agent learns this from what it receives (below), not from a shape: at R4 no shape exists yet.

**What the design agent receives** (*settled 27 Oct, Todd*): the output of the `grill-with-docs` interview if one ran first, otherwise what Todd submitted (on the `triage` route, the raw issue), plus any existing design or screen the requirements agent found at R4. There is no separate hand-off document. Anything else it needs is its own job: facts it looks up itself (repo, Linear, the `ui` folder); decisions it asks Todd, one at a time.

1. **D1. Read-back.** The stock `in-your-own-words` skill, plus one line: "Label anything you assumed where the interview was silent, and list what you're keeping out." There is no separate "principles" step.
2. **D2. Look and feel (comes first, because Todd judges by seeing).** Skipped when a design already exists. A short probe, one question at a time, using the questions in Owl's `design-taste` skill, wrapped (see "How the design skills are wrapped" below): it asks what Todd does *not* want first (for example, what made the old dashboard wrong, then what the opposite is), then one or two references and what he loves in each. It stays short because Todd finds it hard to put a look into words. "Make it look good" is not enough, and his taste overrides anything on file. The engineer-default look (dark themes, terminal feel, dense text) is recorded as an anti-reference. Then the agent makes Stitch variants of one representative screen with real labels (run names, stops, scorecard). Todd picks, and the pick becomes the project's design file (`DESIGN.md`).
3. **D3. Functionality options.** Owl's `/explore-options` method: frame the question and criteria, the agent decides how many options and which behavior they differ on (never a fixed number), draw each at matched fidelity, merge options that do not diverge, and record rejected options with what each tested, why it lost and its revival condition. One Stitch prompt per option, all in the chosen look. Each option says which mode it serves, inner loop or outer loop. Todd sees a one-line plain-English description of each option with its prompt beside it; the prompts are also saved with the screens. Fallback if Stitch cannot be connected: the stock `prototype` skill's UI branch.
4. **D4. React.** Todd reacts in his own words first.
5. **D5. Refine.** A separate critic agent then adds a critique: a short, ranked, capped, plain-English list asking whether the design is good (hierarchy, findability, clutter), judged separately for each mode. It comes after Todd's reaction so it does not anchor him, and his taste overrides it. The design agent changes the screens (editing preferred over regenerating) and asks specific questions with quick replies. Todd can add comments at any time.
6. **D6. Coverage check.** The agent reports in plain English what is covered and what is not: every function from the interview, both modes, the screens people forget (empty, loading, error), and that status is not shown by color alone.
7. **D7. Done.** Only Todd ends the design, by saying "done". The agent may say it thinks the design is ready, but it cannot close the step.
8. **D8. Hand back.** The design agent hands the requirements agent a folder with a short index file in plain text (Markdown, not JSON, so both the agent and Todd can read it) and the detail beneath it, so the reader opens only what it needs: the approved picture, what changed along the way, the critic's findings and how they were handled, and the rejected options with reasons. The approved picture and the index are attached to the shape's Linear issue; the rest stays in the project's `ui` folder, and the index points to it. The index having the same sections every time is part of what the design agent is checked against. The design file already exists by then. The requirements agent then continues at R5.

## How the design skills are wrapped

Same method as the Pocock skills: stock skills stay unmodified, and the design agent's instructions carry the overrides. Read from Owl-Listener/designpowers on 27 Oct.

* `design-taste` (*settled 27 Oct, Todd*). The agent uses its questions and skips the rest of its machinery:
  * Its welcome gate requires running `using-designpowers` first (a bird greeting and a walkthrough offer, "No exceptions"). The agent skips it.
  * It writes into Designpowers files (`design-state.md`, `docs/designpowers/taste/`). The agent does not; it saves the taste profile in the project's `ui` folder, next to `DESIGN.md`.
  * It asks six questions as a list (references, emotional target, anti-references, quality bar, personality, what is missing from the current system). The agent asks one at a time, anti-references first. "What you don't want first" is our choice, not the skill's order.
  * Its output is a taste profile (words), not `DESIGN.md`. The profile feeds the Stitch variants; Todd's pick becomes `DESIGN.md`.
* `prototype` (D3 fallback only): it builds throwaway code variants on a route inside the app and commits them to a throwaway branch with a pointer on the issue. It produces code, not Stitch screens.
* **Stitch** (read from third-party pages, not Google's docs): its tools match D2 and D3 (generate variants, edit an existing screen, a design system before the first generation, upload `DESIGN.md`). The API key is created in Stitch's own settings by the account owner. That is the one step only Todd can do, and it is a single approval.
* `explore-options` (D3; *settled 27 Oct, Todd*). It is a command in Owl-Listener/designer-skills (plugin `prototyping-testing`), not in `designpowers`. It chains six steps (frame the decision, set the spread, draft each concept, trace the difference, pressure-test, converge) using five other skills from the same plugin (`concept-selection`, `parallel-concepts`, `wireframe-spec`, `user-flow-diagram`, `heuristic-evaluation`); whether those are installed is not checked. Wrapped as follows:
  * Keep: framing the decision and criteria before any concept exists, setting how many options and what they differ on, collapsing options whose user paths do not diverge, and the decision record (each rejected option with what it tested, what it lost on, its revival condition).
  * It produces text wireframe specs. The agent draws the options in Stitch instead.
  * Its last step chooses the winner itself. Todd picks, after reacting in his own words.
  * It runs a usability evaluation of every concept first. That moves to the critic, which comes after Todd's reaction so it does not anchor him.
  * The design agent's shape must say exactly which steps it keeps.
* `in-your-own-words` (D1) is a pstack skill, one sentence: restate what you think the user's goals are and what problem they are trying to solve. It is manual-only, so the design agent's instructions must invoke it by name.

## Where things live

* **Design files live with the project they are about.** Julia's design material goes in a `ui` folder in Julia's repo. The dashboard's goes with the dashboard.
* **The dashboard and the framework live in** `julia-next` **for now**, in a separate directory structure and their own Linear project. Splitting them into their own repo later is a separate decision.
* **The dashboard process does not use** the 18 Oct dashboard brief (`claude/brief-2026-10-18.md`, written for the old machine), the old dashboard mockup, or Julia's `DESIGN.md` (that file is for Julia, not the dashboard). Todd's words: the old design is "exactly what not to do." The interview starts from what is settled on his list: model selection, stops, scorecard, waiting-on-you ping.

# Part 2. Open items

1. **How the design agent connects to Stitch.** Its MCP server needs an API key, and who holds the key must not land on Todd. Unsolved, a builder question.
2. **Builder items to schedule:**
   * Gather Julia's scattered design material into the `ui` folder, and fix the references in cards and agents that point at `DESIGN.md` and the vintage designs by their present locations.
   * Set up Pocock's tracker configuration for Linear (`/setup-matt-pocock-skills`) and the mapping between triage's labels and Linear statuses.
   * On the dashboard's setup card: the separate glossary and decision folder (see "How Pocock's skills are wrapped").
   * Retire the old front-end flow in the repo (the `pre-plan` skill and the old triage flow: Shape, then Pocock's triage, then Confirm, with the old card check), since this process replaces it. Also remove Pocock's `implement` and `to-tickets` from `.claude/skills` (both still installed as of 27 Oct): pstack plans, slices and builds, so they must not be available to agents (*settled 27 Oct, Todd*). The [JUL-231](<https://linear.app/julia-next/issue/JUL-231/start-builds-the-saved-card-and-saves-the-result>) pre-plan summaries and shape documents stay as card history. The old [Card-to-merge flow](<https://linear.app/julia-next/document/card-to-merge-flow-c00c30075964>) document is already marked superseded (27 Oct).
3. **The two agent issues.** The requirements agent and the design agent each need a shape, made by hand. The real test of the whole process is taking the dashboard through it and seeing where the agent departs from the steps.

# Pilot findings

The dashboard is being taken through this process by hand, with Claude acting as the agents (started 27 Oct 2026). After each step: what to change in the process, and which parts become scripts versus agent judgment. The interview's notes go in the Framework project's "Dashboard glossary" and "Dashboard decisions" docs.

## R2–R3 (27 Oct, interview with Todd)

1. **R2 tested nothing.** The doc had already named the dashboard as the raw-idea case, so the route was decided before `ask-matt` ran.
2. **The repo's** `ask-matt` **is not stock.** It carries local edits (pre-plan retired, bugs go to poteto-mode's Bug fix playbook); the doc says stock skills stay unmodified.
3. **The interview started from stale facts.** Claude described the old build machine (15-minute stop, spend ledger, Start remembering choices, the reviewer's same-company refusal) from handoffs; it was removed from main on 26 Oct (<pull-request id="1b4644bf-0173-4445-a91f-b0ecadeb8c7b" href="https://linear.app/julia-next/review/chore-remove-the-old-build-machine-from-main-f6ace157ec55">toddwyder/julia-next#354</pull-request>). The interview must start from main's current state.
4. **Linear's statuses were stated from memory, two wrong** (Code review and Staging/smoke test left out). Facts are looked up every time.
5. **Decisions about other work came up mid-interview with no home in the process:** un-deferring staging, every piece of work getting its own Linear project, and the retro completing before a card's trace is deleted.
6. **The gap test is compromised.** Claude went in with its own gap list, so the interview raising start/stop, stuck, the waiting-on-you ping and design as a root-cause stage does not show the real agent would. Context (window fill, compactions) was a gap only Todd found: the interview missed it.
7. **A recommendation worded for "yes" can steer.** Todd corrected the recommendation three times (milestone vs project, which model is the builder, trace retention); each time Claude had guessed where an open question was needed.
8. **What worked:** one question at a time (about 35 questions in 45 minutes), and the glossary and decision records written as each answer landed.
9. **Un-deferring staging** goes through the front door as its own work after the dashboard.

**Script or judgment (Todd, 27 Oct):**

* **Build:** a starting-facts snapshot handed to the agent before its first question (main's AGENTS.md, newest decision records, recent removals, Linear statuses and projects). Fixes 3 and 4.
* **Build:** one list where side decisions land (5); the agent appends, the list goes through the front door. Spotting them stays judgment.
* **Note only, until a problem shows:** a CI check that wrapped Pocock skills match upstream (2); a format check for glossary and decision entries.
* **Judgment:** choosing the next question, seeing what is missing, when to recommend and when to ask open first (6, 7).
* **Doc fix:** remove the line pre-routing the dashboard to the raw-idea case, so R2 routes it (1).

## R4, D1, D2 (27 Oct)

1. **R4 was a formality.** After the interview, asking "does it have a UI?" added nothing; the doc says ask anyway.
2. **D1's read-back caught two wrong assumptions** (one user: two people use Julia but only Todd uses the dashboard; "no spending caps": there will be a per-card limit). Worth keeping.
3. **D2's taste probe worked asked open, with no recommendation** (5 questions). A recommended taste would be the agent's taste, not Todd's. This departs on purpose from the wrapper's "recommended answer" rule.
4. **Connecting to Stitch.** The doc assumed the agent can call Stitch from wherever it runs. The advisor's cloud chat cannot (network allowlist; refused again 27 Oct 16:49). Working route: the server agent calls Stitch with the key from the "Julia agents" vault through `scripts/julia-agents.mjs`. Todd's only step was creating the key and saving it once. This answers Part 2 open item 1. The doc gives a fallback for D3 only, none for D2; the key question blocked the step for about 30 minutes.
5. **Looks described in words don't work.** Three looks written by the agent gave Todd nothing to judge. Stitch's own variants from his taste profile, in his own words, did.
6. **Seeing the screens.** Files on GitHub don't work for Todd (open, download, open each). His Stitch account and one page with the screens side by side did. The design step hands Todd a page or Stitch, never files.
7. **Pictures drew out a better layout.** After seeing sideways and tabs on the phone, Todd designed a folding list of stages himself. D2 settled layout as well as look, so D3 starts with part of the functionality decided.
8. **A broken file killed an agent session.** A Stitch download saved as `.png` was JSON; opening it made the model service reject every later message. Fixed by checking the file type before opening.
9. **Each round took about 20 minutes, which is painful** (Todd). Every round goes advisor → Todd pastes into Windows Terminal → server agent → Stitch → GitHub → advisor → Todd. Todd: it may be easier to go back and forth with Stitch and the advisor directly, and it may be easier once the design agent exists.

## D3–D5 with Todd working in Stitch directly (27 Oct, from 16:51)

10. **Direct rounds took about 4 minutes, against about 20 through the server agent.** The advisor wrote prompts, Todd pasted them into Stitch's website and sent back screenshots.
11. **Stitch made strong options from short text prompts.** Todd: "now you see why I like stitch." Three Decision support options and three Start screen options came out complete; Todd mixed parts of them.
12. **Big edits break Stitch.** Five changes in one edit were ignored or half applied. Google's forum guide says one or two changes per prompt, on one screen, and a user reports parts dropped from prompts over about 5,000 characters.
13. **A crowded project wears Stitch out** (Todd: more images on the canvas means more in its window). It made edits as new screens beside the original, claimed changes it hadn't made (twice), invented role names and models, and one design-system fix took four prompts. Google's staff call multi-screen consistency a known problem and suggest a fresh project.
14. **A screenshot is a poor way to carry a screen over; text works.** In a fresh project, "recreate the attached screen" produced a different screen with invented content. The same screen described fully in text, with "use only these names", came out right.
15. **Stitch's written replies aren't reliable evidence;** the screenshot is. Its text said "mint button" on a screen with no styling.
16. **Carrying the look to a new project takes checking.** The DESIGN.md came through, but Stitch shifted the shades when it built the design system. Check the design-system card (light, fonts, the four colours) before drawing.
17. **Stitch adds made-up content** (LIN numbers, estimates, "Capped at \~$0.75", Slack, "Factory v3.4"). Every result needs a read for inventions, and prompts that end "add nothing else" helped.

**Script or judgment (proposed, not yet agreed):**

* **Script:** download a Stitch screen, check its file type, save it.
* **Script:** build the side-by-side page from the saved screens.
* **Doc fix (approved earlier):** remove the line pre-routing the dashboard to the raw-idea case, so R2 routes it.

## D6–D7 (27 Oct, from 18:31)

18. **Stitch invents the frame on every screen** (profile icon, headers, a bell, a bottom menu with made-up sections, a duplicate "Needs you" bar). A picture is the source only for what it was asked to show (decision 0008).
19. **Todd skipped polish rounds:** "the only real way I will know is when we start using it." Small flaws (cut-off labels, meaningless button colours) went into the spec instead of more edits. Three screens took about 10 minutes.
20. **The coverage check earned its place.** It surfaced the missing desktop screens and a list of things to write into the spec rather than draw. Whether an agent needs desktop pictures is the design agent's question to answer, not Todd's.
21. **D7 worked as written:** Todd said "done" in one word, after the coverage check.
22. **D8's hand-back folder exists on a pilot branch.** The "no repo changes" rule seemed to rule it out, but the approved pictures and an index for agents went into `docs/pilot/dashboard-d2/approved/` on the pilot branch (draft PR <pull-request id="6f55dd6f-2186-41a0-9f21-d3074a569521" href="https://linear.app/julia-next/review/dashboard-pilot-design-screens-not-for-merge-b0117e807593">toddwyder/julia-next#365</pull-request>, never merged). That folder is D8's hand-back in practice.
23. **The coverage check missed a settled function.** The interview settled a step checklist on the running card; the drawn board showed only "Step 4 of 8". Claude's coverage check passed it; Todd caught it after "done". A screen was drawn and design reopened without trouble. Supports making the function-against-screen list a script.

**Script or judgment (Todd, 27 Oct):**

* **Script:** the coverage check's list of interview functions against drawn screens.
* **Judgment:** what to do about each gap (draw it, write it into the spec, or leave it).

## D8 to R7 (27 Oct, 19:00)

24. **Approved screens were gathered after design closed, not as each was approved.** Todd pasted screenshots into the chat as each screen was settled. They were collected afterwards into one folder with an index for agents (`docs/pilot/dashboard-d2/approved/` on the pilot branch: 12 pictures, each with what it counts for and what Stitch invented). The night handoff then said two screens were missing, and the advisor repeated it without checking the folder. Todd: he should have been told about saving the screens while they were being made.

**Script or judgment (Todd, 27 Oct):**

* **Script:** when Todd approves a screen, the design agent saves it right away (download, check file type, save with its prompt) to the place D8's hand-back folder will use. At R7 the approved pictures are already gathered; nothing is left for Todd to collect.

## R5 to R7 (27 Oct, from 19:40)

25. **to-spec expects the interview in the same chat.** It synthesises "the current conversation"; here the interview ran in earlier chats, so it worked from what they saved (decisions, glossary, handoff notes, the approved folder). It worked because those were written as answers landed.
26. **to-spec's test-hook step was dropped:** pstack plans tests when it builds (Todd).
27. **A missing system surfaced only at to-spec.** The design assumed a Start button with a machine behind it; the old machine had been removed the day before. Reading main at to-spec caught it, and Todd folded it into the dashboard (decision 0009). The starting-facts snapshot agreed after R3 would have caught it in the interview.
28. **New standing rule from this step:** every piece of work is started and watched from the dashboard and proven on a screen Todd uses; work with nothing to see is an exception Todd approves (Part 1, and main's plan, <pull-request id="229c8665-c738-490b-b06d-b0e5ebe58bdf" href="https://linear.app/julia-next/review/plan-todd-sees-every-piece-of-work-working-on-a-screen-f68c41b85118">toddwyder/julia-next#366</pull-request>).
29. **The brief checker doesn't read the five-part shape.** `scripts/check-agent-brief.mjs` looks for a bulleted "Acceptance criteria" heading; it found nothing under "Done means". With the heading renamed in a copy, the shape passed all four rules.
30. **Pictures couldn't be uploaded to the issue from the advisor's chat** (Linear's file storage is outside its network allowlist). Instead a Linear document on the issue shows each picture from GitHub, pinned to the commit, under its index entry.

**Script or judgment (proposed, not yet agreed):**

* **Script:** the brief checker reads "Done means" as the criteria heading (29).
* **Judgment:** what to synthesise into the shape and what to leave in the linked decisions.

# Part 3. History (not part of the process)

## Corrections

Lines that were written down as agreed but Todd had not agreed to, and were withdrawn:

* Design steps 5 to 8 were first written in an earlier handoff as if agreed; they were walked through and settled afterwards on 26 Oct.
* "The framework gets its own repo" and "design files belong to the framework, in a folder per project" were written as settled. Todd had not agreed to either. Withdrawn 27 Oct.
* Claude told Todd that `grill-with-docs` asks one question at a time. It does not; `grilling` asks a round at once. Fixed by the one-question-at-a-time wrapper.

## Lessons

* Read a tool before recommending it. The Owl-Listener recommendation was made unread and then reversed. `to-spec`, `triage`, `wayfinder` and `grilling` were read only after the flow was drafted and each showed conflicts.
* Do not decide how a process ends before going through what it does.
* Do not put the old design in as an input to a new one.
* Name things correctly: the interview's output is the shape, not a design brief; the skill is `to-tickets`, not `to-ticket`.
* One question at a time.
* Do not describe steps as agreed unless Todd said so.
* Ask what is meant before explaining. "Review" meant a design critique, not the post-build comparison.
* Do not use step numbers for things Todd has not seen yet.

## Research notes (read, not recommended)

* **OpenAI Product Design plugin:** its scripts are portable but its skills are tied to Codex Desktop; the sequence (get-context, ideate, image-to-code, design-qa) is free to copy, the text is not. License is Proprietary.
* **Google Stitch:** chosen for the design agent. Todd has already used it to make Julia's UI. What he likes: interactive clickable prototypes, and it produces React, TypeScript and Tailwind. He has a Gemini subscription. MCP at [stitch.googleapis.com](<http://stitch.googleapis.com>) with an API key; official stitch-skills repo is Apache-2.0. Generation prompts carry layout and content only; colors and fonts live in the project's design system, which must exist before the first generation. Complaints: ignores rules, makes stray pages. Costs: sources disagree on free limits (about 400 design credits plus 15 redesign credits a day on one; about 550 generations a month on another); closed 27 Oct (Todd): the dashboard is too small to hit them, deal with a limit if one is actually hit.
* **Owl-Listener:** its `designer-skills` pack produces text specs only; its `designpowers` pack has the `design-taste` conversation used for the look-and-feel probe. Useful rule: options should differ in what the user does, at matched fidelity.
* **ask-matt (Pocock):** read in full on 26 Oct and again on 27 Oct. Source: [github.com/mattpocock/skills](<http://github.com/mattpocock/skills>), skills/engineering/ask-matt/SKILL.md. Its companion file on phase boundaries (`PHASE-BOUNDARIES.md`) was dropped by Todd as having no bearing on the requirements.
* **pstack multi-phase plan playbook:** read 27 Oct from the public mirror (backnotprop/pstack, skills/poteto-mode/playbooks/multi-phase-plan.md). It writes a plan only and stops for the operator's go.
