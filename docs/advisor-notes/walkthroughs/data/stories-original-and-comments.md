Every user story for the dashboard, each traced to where Todd said or approved it. Written 27 Oct 2026 from the notes in `docs/advisor-notes/` on main. Nothing here is new; a story with no source is not allowed.

**How to read a trace.** `R1a` = Todd's first R1 list (11:46, in `handoffs/handoff-2026-10-27-midday.md`). `R1b` = his fuller R1 list (11:58, chat 1 turn 0). `I n` = chat 1 (`chats/01-interview-r1-to-d2-probe.md`) turn n. `S n` = chat 2 (`chats/02-stitch-connection.md`). `D n` = chat 3 (`chats/03-design-d2-to-d5.md`). `E n` = chat 4 (`chats/04-design-d6-d7-and-approved-folder.md`). `P hh:mm` = chat 5 (`chats/05-spec-r5-to-r7.md`), Todd's message at that time. `00nn` = a decision in "Dashboard decisions". `Gl` = "Dashboard glossary". `PL` = `plans/parking-lot.md`. Pictures are numbered as in `docs/pilot/dashboard-d2/approved/`.

# User stories

## Whole dashboard

* **US-01** As Todd, I want one dashboard with two jobs, running the factory (inner loop) and improving it (outer loop), so that I can steer builds and learn between them. *R1a; PL (25 Oct "Two jobs"); I 39–40*
* **US-02** As Todd, I want the board as the first screen and Decision support one tap away, so that what needs me now is what I see first. *I 39–40; Gl "Decision support"*
* **US-03** As Todd, I want every screen to work on my phone and my desktop equally, reached through Tailscale, so that I can act from anywhere. *I 29–30; I 93, 99–100 (read-back)*
* **US-04** As Todd, the only person who uses the dashboard, I want no sign-in beyond Tailscale. *I 93–94, 98–99*
* **US-05** As Todd, I want the screens to update live without refreshing, so that what I see is what is happening. *I 93, 100 (read-back)*
* **US-06** As Todd, I want to glance, not read: status as pictures and charts, the most important thing where my eye lands first, plain words with no agent jargon, only what I need with detail one tap away, each view fitting a phone screen. *I 102–104; I 110–112 (taste profile)*
* **US-07** As Todd, I want the Mint & Iris look (light, mint and iris, amber for waiting on me, rose for stuck, Public Sans), with status never shown by colour alone. *0005; D 24; D 95–105; picture 12*
* **US-08** As Todd, I want labels and values never cut off. *E 5–7; 0008*
* **US-09** As Todd, I want button colours to carry no meaning I have to learn. *E 9; 0008*
* **US-10** As Todd, I want clear empty, loading and failed screens (no cards running; the dashboard can't reach the machine), so that I never mistake a broken page for an idle factory. *D 123; 0008*
* **US-11** As Todd, I want every piece of work started and watched from the dashboard, and proven on a screen I use without reading code, so that I can see it works. Work with nothing to see happens only as an exception I approve. *P 19:42–19:43; main's plan (#366)*
* **US-12** As Todd, I want the dashboard to include the part that starts, watches and stops builds, so that pressing Start really runs a card. *P 19:42; 0009*

## Board

* **US-13** As Todd, I want the board to show only the cards the machine is working on, whatever models and providers it uses, so that all card work goes through one place. *R1a ("across tools"); I 3–4; 0001*
* **US-14** As Todd, I want one tile per card with its agents inside, not one tile per agent. *I 1–2; Gl "Board"*
* **US-15** As Todd, I want the board's stages to be Linear's: Backlog, Ready, Implementation, Evidence review, Remediation, Staging/smoke test, UAT, Complete (no Code review, Triage, Canceled or Duplicate). *I 5–15*
* **US-16** As Todd, on my phone I want the stages stacked, each folding to one line with its card count, only stages with a running, stuck or waiting card open when the page loads, and each card showing its top row (title and status) and expanding in place when tapped, so that 30 Backlog cards don't bury what matters. *D 28–32; 0005; pictures 02, 03*
* **US-17** As Todd, on desktop I want the eight stages side by side in the Mint & Iris layout. *D 25; E 13–14, 25–27; 0008; picture 01*
* **US-18** As Todd, I want Complete cards to stay until their Linear project is Completed, and every piece of work to have its own project, so that finished work clears in batches. *I 31–38; 0002; Gl "Project"*
* **US-19** As Todd, I want to see at a glance when a running card is stuck (no activity for 5 minutes). *I 21–24, 55, 59–61; Gl "Stuck"*
* **US-20** As Todd, I want "waiting on you" to look different from stuck. *I 81–82; D 35*
* **US-21** As Todd, I want a running card to say what it is doing now and how long since its last activity. *I 21–23*
* **US-22** As Todd, I want a running card to show its playbook checklist, each step done, working, to go or skipped (with why), each with its elapsed time. *R1a ("Steps"); I 77–78; E 20–23; picture 04*
* **US-23** As Todd, I want a running card to show its wall-clock time. *R1a; R1b*
* **US-24** As Todd, I want a running card to show its cost so far, against the per-card limit once that limit is set. *R1b; I 93–97*
* **US-25** As Todd, I want a running card to show each agent's context fill, compactions and handoffs. *I 56–58; E 19–20, 25; 0008; Gl "Compaction", "Handoff"*
* **US-26** As Todd, I want each card to link to its Linear issue and its run record (trace). *R1a; R1b; I 85*
* **US-27** As Todd, I want to stop a running card: the build ends, its work stays on its branch, the card stays in its column, and Start again starts fresh. *I 19–20; PL ("Start/stop")*
* **US-28** As Todd, I want a stopped card to show why it stopped, the stage that caused it, its restart plan, and its cost and rounds. *I 25; E 9–11; picture 05*

## Start

* **US-29** As Todd, I want Start only on Ready cards. *I 7, 15–16; I 93 (read-back)*
* **US-30** As Todd, I want to choose the model for the main session, for each of pstack's 17 roles (panels take a list, and the list's length sets how many run), and for the evidence reviewer. *R1a ("Model picker"); I 16–17; 0007*
* **US-31** As Todd, I want one effort choice per build (Small, Medium, Large, Unlimited) shown with brain icons, never dollars. *I 17–18; D 72–77; 0007*
* **US-32** As Todd, I want the picker filled in with my last choices, and a one-tap "Start with last settings" at the top. *I 7, 15–16; D 70; 0007*
* **US-33** As Todd, I want to set models by group, with a down-arrow that opens a group so I can set a single role differently. *D 63, 70; 0007*
* **US-34** As Todd, I want each role to have an ⓘ that explains it in plain words. *D 70–71; 0007*
* **US-35** As Todd, I want each model's real price shown as $ to $$$$, Beam marked Free, and a missing price looked up by an agent rather than shown blank. *I 75–77; D 119–121*
* **US-36** As Todd, I want a ping when the build finishes, as a Linear notification. *D 70, 79–81; 0007*
* **US-37** As Todd, I want the Start button fixed at the bottom of the Start screen. *D 70; 0007*

## Needs you

* **US-38** As Todd, I want one list of everything waiting on me: a card in UAT, a stopped card's restart plan, a shape awaiting "settled", retro fixes to approve, a one-click account approval, and a running build waiting for my answer. *R1a ("Action Items"); R1b ("things that I need to do"); I 25–26, 81–83; Gl "Action item"; picture 06*
* **US-39** As Todd, I want each item to say what it is and how long it has waited, and to take me to where I act. *I 25; E 7–9*
* **US-40** As Todd, I want every item to also reach my phone as a Linear notification. *I 27–28; 0008*
* **US-41** As Todd, I want my answer to a build's question to reach the running build. *I 81; E 25; 0008*

## Decision support

* **US-42** As Todd, I want to compare any model in any role (main session, any pstack role, the evidence reviewer), counting a card only for roles that actually ran on it. *R1a ("Model"); I 47–54; 0003*
* **US-43** As Todd, I want each model's success rate in a role, where success means Complete with no intervention caused by the build. *R1a; I 41–44; Gl "Success"*
* **US-44** As Todd, I want the human interventions (UAT send-backs and stops) and their root-cause stage (requirements, design or build), which I can correct when approving retro lessons. *R1a; R1b; I 45–46; Gl "Human intervention", "Root-cause stage"*
* **US-45** As Todd, I want cost and tokens (cached, input, output) by role and model. *R1a; I 47, 53*
* **US-46** As Todd, I want compactions per round, by role and model. *I 56–58*
* **US-47** As Todd, I want the second-round rate, and each evidence-review verdict per criterion (proven, not proven, wrong thing tested). *R1b ("send-backs and evidence review verdicts"); I 63–64*
* **US-48** As Todd, I want typical time per playbook step across cards. *I 79–80*
* **US-49** As Todd, I want each card's time from Start to merge, split by stage. *R1b; I 61–62*
* **US-50** As Todd, I want three views, Map, Ranked and Cards, with Map first. *D 55–57; 0006; pictures 09–11*
* **US-51** As Todd, I want a model with fewer than 10 cards marked "too few cards to trust yet". *D 57–61; 0006*
* **US-52** As Todd, I want a Suggestion box that may point me at something I didn't think of. *D 57–59; 0006*
* **US-53** As Todd, I want a list of finished cards I can sort by cost, time, rounds and times stepped in, and filter by role and model. *R1b ("per card"); I 65–66; 0006; picture 11*
* **US-54** As Todd, I want each card's own page: cost and tokens by role and model, rounds, verdicts, interventions with their stage, compactions, time per stage, and links to the issue and run record. *I 65–66; E 3–7; picture 07*
* **US-55** As Todd, I want the spread of cost per card with the 75th percentile marked, so that the per-card limit can be read off it. *I 95–97; E 25; 0008*

## Records behind the screens

* **US-56** As Todd, I want a card's trace deleted when its retro is complete, so that traces never fill the drive again. *I 67–75; 0004*
* **US-57** As Todd, I want stops, their causes and stages, review verdicts and send-backs recorded as data, not only as prose in Linear, so that Decision support can count them. *PL ("needs each build to record that history as data"); I 45; E 19*

# Comments the advisor said would go into the specs

* **C-01** Each picture counts only for what it was drawn to show; the frame Stitch drew (header, bell, profile icon, bottom menu, "Live sync", a second Needs-you bar) is not built. *E 11, 17; 0008*
* **C-02** The desktop board follows picture 01 for its look and column layout only; the other screens are the phone layout widened, judged on content and look. *E 13, 25–27; 0008*
* **C-03** Spec lines built without a picture are judged on content and plain words, so a first version may look plainer than the drawn parts. *E 27*
* **C-04** "PULSE" on the expanded running card is jargon; use plain words. *D 35*
* **C-05** The "Step 4 of 8" bar on picture 03 is replaced by the checklist on picture 04. *E 21–23*
* **C-06** "Linear notification sent" is not repeated on each Needs-you row; every item sends one. *E 9*
* **C-07** The Needs-you title reads "Needs you (6)", with the count. *E 9*
* **C-08** On the Start screen, Main session appears only at the top, not inside a group. *D 71*
* **C-09** Role explanations show only when the ⓘ is tapped, as a small popup. *D 79–81*
* **C-10** No cost estimates, no "Capped at", no Slack, and pstack's real role names only (all were Stitch inventions). *D 65, 69, 71, 79*
* **C-11** Judgment's "$$$$" for GPT-6 Sol is a drawing error; prices come from the real model list. *D 119*
* **C-12** The design-system card (picture 12) is the colour reference; a later copy in Stitch drifted darker. *D 115, 119*
* **C-13** On the Decision support map, the stray "RK" and the overlapping Sol and Opus bubbles are drawing flaws. *D 61*
* **C-14** Ranked and Cards were drawn before the switch existed: both sit behind the Map / Ranked / Cards switch, without their top banners. *D 59, 123*
* **C-15** The one-line notes on each finished card (Cards view) are Stitch's invention. *D 53*
* **C-16** "Todd's Recommendation" is renamed "Suggestion": it is the dashboard's idea, not Todd's. *D 59*

# Facts the build must settle (not decisions for Todd)

* **F-01** Each request's pstack role is not recorded today; helper calls record only the stock agent type and model. Needed for US-30, US-42. *E 19*
* **F-02** Nothing records when a retro is complete. Needed for US-56. *E 19*
* **F-03** Stops are recorded with time and question, not cause or stage. Needed for US-28, US-44, US-57. *E 19; ADR 0024*
* **F-04** Whether memory condensing (compactions) is stored where the dashboard can read it is unverified. Needed for US-25, US-46. *E 19*
* **F-05** Where Todd answers a build's question so the build receives it is not settled. Needed for US-41. *E 25*
* **F-06** Mastra Code sets effort per session, not per helper; per-helper effort is unproven. Affects US-31. *I 17; `docs/harness/mastra-code.md`*
* **F-07** Mastra Code's bundled price table has no price for DeepSeek V4.1 Flash. Affects US-35. *I 75; ADR 0024*
