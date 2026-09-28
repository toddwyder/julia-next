# Requirements for the smallest working route on Mastra

Date: 2026-09-27 (updated evening, after the second trial)
Status: **retired 2026-09-27.** Superseded by the revised ADR 0009; the spec written from it
replaces this list. Kept as history only.

## Where this comes from

ADR 0008 says Julia features start once the smallest working route carries a real change. ADR 0009 moved that route from the Pydantic graph to Mastra Factory. The Mastra trial (JUL-183, GitHub issue #129, PR #130) passed on 2026-09-27: one card went from a GitHub issue to merge through Factory, and Todd approved it on his phone.

The trial proved the pieces work. It did not prove Factory can run a card by itself: the audit in the appendix shows much of the card was run by hand beside Factory. A second trial the same evening (issue #132, PR #133) ran on stock Factory with no agent driving it; its findings are in the second appendix. Neither trial proved everything ADR 0008 counts as part of the smallest route. Each requirement below must be met before feature work starts.

## A. Parts of the smallest route not yet proven (ADR 0008)

**R1. A stuck card reaches Todd's phone.**
A check that runs separately from Factory watches every card in progress. When a card stops moving, the check notifies Todd's phone in plain English.
*Proven when:* a card is deliberately stalled and Todd's phone receives the notice without anyone sending it by hand.

**R2. Todd accepts in one word or sends back in one sentence, and never sees code.**
Todd's decision is about the product, not the code. He sees a link to the rehearsal copy and one sentence saying what he should see. He replies "accepted" or sends it back in one sentence. The code-review screen is not part of his step.
*Proven when:* Todd accepts a card from his phone without seeing a code diff.

**R3. A send-back returns the work to the builder.**
Todd's one-sentence send-back reaches the builder, which fixes the work and brings it back to him. Todd does not operate or diagnose anything.
*Proven when:* a card is sent back, fixed and returned to Todd with no action from him beyond the one sentence.

**R4. Models are chosen per card, with automatic backups.**
Each card has a default builder model and reviewer model, and the defaults can be overridden per card. When a model hits its usage limit, the next backup takes over. The builder and reviewer never come from the same maker. The settings live somewhere other than Linear, because Linear becomes read-only history under ADR 0009.
*Proven when:* a card runs on an overridden model, and a forced usage limit switches to the backup without breaking the maker rule.

**R5. Accepted work reaches Real Julia.**
An accepted card merges and appears in Real Julia, the live app.
*Proven when:* after acceptance, the change can be seen in Real Julia.

**R6. A crash mid-card starts the interrupted step over.**
If Factory or the server restarts while a card is in progress, the interrupted step starts over and the card carries on. No card is lost or left silently stuck.
*Proven when:* the server is restarted halfway through a card, and the card finishes without Todd's help.

**R21. Todd's acceptance is the merge. Nobody presses a merge button.**
Stock Factory never merges: Mastra's documentation leaves the merge to "your repository's normal human review process." Todd does not want to merge. His one-word acceptance (R2) must cause the merge by itself, with no person or agent pressing GitHub's merge button. GitHub must still refuse any merge without Todd's acceptance (R15).
*Proven when:* Todd accepts a card and it merges with no one pressing merge, and a card Todd has not accepted cannot be merged.

## B. Lessons from the trials

**R7. Factory runs cards without an agent driving it.**
In the first trial, a Codex session sat on top of Factory. It fixed bugs, re-checked tests, re-sent the review request and moved the card. That session ran out of memory, compacted twice and needed handoffs. Factory must move a card from issue to Todd's acceptance on its own. Any step that still needs an agent is named in the spec, with a reason.
*Proven when:* a card goes from issue to Todd's review request with no operator session running. (Second trial: met from issue to review verdict; the merge was not — see R21.)

**R8. Todd has one place: his phone.**
Everything Todd needs arrives on his phone through GitHub. Linear becomes read-only history, as ADR 0009 says, and open Linear cards are closed with a reason. Todd never has to check two boards. The second trial found that Factory's approvals (accept task, approve plan) and its start buttons (Investigate, Review) all live in Factory's own screens, not on GitHub.
*Proven when:* a full card completes with Todd only ever looking at his phone.

**R9. Every rehearsal copy opens without a login.**
In the first trial, Vercel's login was switched off by hand for one address. In the second, the preview opened only because Todd's Chrome was signed in to Vercel; a phone that isn't signed in hits Vercel's login page. This must work automatically for every card.
*Proven when:* two cards in a row produce rehearsal copies that open on Todd's phone with no sign-in.

**R10. Rehearsal copies only ever hold test data.**
Rehearsal copies are now open to anyone with the link. They must use the shared test data from ADR 0008 and never reach real household data.
*Proven when:* a check confirms a rehearsal copy cannot reach Real Julia's data.

**R11. Our fixes to Mastra's code have a removal plan.**
After the second-trial setup, one fix remains: the WorkOS sign-in fix (upstream mastra-ai/mastra#25252), approved by Todd as exception #1 because Mastra's platform sign-in rejects our host. The skill-loading fix was removed. Each fix is recorded, has a check that shows when Mastra fixes it upstream, and is deleted at that point. No new fix is added without the same record.
*Proven when:* each fix has a written removal check, and upgrading Factory runs those checks.

**R12. The test server is a deliberate choice.**
GitHub's own test machines are blocked because the free minutes were used up, largely by tests built to pass rather than to check anything. The minutes reset on the 1st of each month. The self-hosted runner on OVH was removed for the second trial, which ran without CI. The spec either keeps a self-hosted runner on purpose, with its upkeep named, or uses GitHub's minutes with only real tests on real changes. Cost is weighed toward paying less.
*Proven when:* the spec records the choice and its reason.

**R13. The repo's standing instructions match the new route.**
CLAUDE.md and the agent guides still name the Pydantic graph as the planned route, and they say never to move a card to Complete. Both are out of date: Mastra replaced the graph, and Todd's acceptance now completes a card.
*Proven when:* the instructions describe the Mastra route and the current completion rule.

**R14. Agent briefs lead with the goal.**
In the first trial, Codex declared the trial failed at its first blocker because the handoff stressed stopping. Briefs must say the goal is a working result, and that only product decisions and Todd's own sign-ins go to Todd.
*Proven when:* the brief template states the goal first, with escalation limited to those two things.

**R20. Todd starts a card without an agent.**
Factory supports starting work without an agent: with Auto-start on, a new GitHub issue from Todd starts a run; otherwise one button on the card (Investigate) starts it. Todd starts a card by writing the issue, or with one tap, and nothing else. The second trial met this with Investigate. Auto-start was left off because old open issues (e.g. #1) would also start.
*Proven when:* Todd files an issue and the card runs to his review request with no agent session opened by anyone.

## C. Stopping agents from going around Factory

This is the fourth attempt at an automated route. Each time, the agent setting it up hit a problem and built its own workaround instead of using the product. Written rules did not stop it: the first trial's plan said "no replacement controller" and then used one. The rules below are enforced by what agents can and cannot do, and by plain checks, not by agents reporting on themselves.

**R15. While a card runs, agents cannot act outside Factory.**
During a card run, no agent has server administrator access, cannot write evidence, cannot move cards, and cannot send review requests or merge. Only Factory and its own GitHub connection can do those things. GitHub itself blocks any merge without Todd's approval.
*Proven when:* an agent is told to move a card or merge by hand during a run and is refused by the system.

**R16. Setup and running are separate, and setup changes are listed.**
Server administrator access exists only during a setup window. Every change made in that window is recorded in one list in the repo, and the window closes before a card runs.
*Proven when:* the list matches what is installed on the server, and no administrator session is open during a run.

**R17. A plain check, not an agent, audits every card.**
After each card, a plain program (not an agent) checks and reports in plain English:
- every step of the card was carried out by Factory itself, not by an agent or person acting as coordinator;
- Mastra's installed files match a clean install, apart from fixes on the approved list;
- nothing runs on the server that is not on the setup list.
Anything unexpected fails the card and goes to Todd's phone.
*Proven when:* a deliberate workaround (a hand-moved card, an unlisted change to Mastra's code) is caught and fails the card.

**R18. Exceptions need Todd's approval, recorded in one list.**
Before building anything of its own beside Factory, an agent must state which Factory feature it tried and why that feature does not fit. Todd approves or declines, in one sentence. Approved exceptions go on the list R17 checks against. Anything not on the list fails.
*Proven when:* R17's check reads its allowed exceptions only from that list.

**R19. Progress reports come from the check, not from the agent.**
Todd's view of what was built and how comes from R17's report. An agent's own summary is never the only record.
*Proven when:* each card's result shows the R17 report.

## Appendix: first trial audit (2026-09-27)

Source: all JUL-183 comments and the `ops/factory` files merged in PR #130. The server itself was not inspected.

**Changed Mastra's own code**
- Sign-in package edited so new sessions keep the organization (upstream mastra-ai/mastra#25252).
- Factory's skill loading edited to skip the duplicate `.claude/skills` folder. Removing or renaming our duplicate folder would have avoided it.
- An install hook re-applies both edits after every reinstall.
- Temporary logging added to Mastra's code to prove which memory model ran; removed afterward.

**Built our own machinery beside Factory**
- Evidence was a hand-written file. The operator ran RED, GREEN and guard checks itself over SSH and recorded them. Its own framework map named Factory's phase handlers (`onEnter`, `tools.onResult`) for this; they were not used.
- Automatic runs were switched off. Cards were moved by the operator acting as "jul183-controller".
- A separate script ticked the GitHub checkboxes.
- The operator started the DeepSeek review in an ordinary Factory session, not the official Mastra pull-request reviewer template named in its own map.
- The operator sent the review request and merged through the GitHub App directly, not through Factory's own review and merge steps.
- A self-hosted test runner was installed on OVH after GitHub's runners were blocked by billing.
- Everything was hard-wired to the single trial card (evidence folder, GitHub installation number, issue #129).

**Supported features used in roundabout ways**
- Reviews ran as copies (`forked: true`) of the builder session to borrow Todd's ChatGPT sign-in, because standalone sessions required an API key.
- An organization-scoped sign-in link was used before the code fix replaced it.
- Vercel's login was switched off by hand for one rehearsal address.
- Old graph test fixtures were edited so CI would pass.

**Used the product properly**
- The trial board and its evidence rule use Factory's supported `defineBoard` and `transitionPolicy`.
- Memory model settings were changed through Factory's own settings.
- The GitHub issue came in through Factory's own intake.
- The builder ran the repo's Pocock skills natively.
- WorkOS sign-in is a documented Mastra option.

## Appendix: second trial (2026-09-27 evening, issue #132 → PR #133)

Stock Factory, stock Work and Review boards, one approved exception (WorkOS sign-in), no CI. No agent session touched the run.

- **Factory did by itself:** triage (with a note posted to GitHub), a test-first plan scoped to two files, the build, PR #133, and its own review. The review re-ran lint, build and the browser test, and approved.
- **Todd's touches, all in Factory's screens:** Investigate (start), Accept (task), Build (plan approval), Review (start the review).
- **The merge:** stock Factory stops before merge by design. Claude pressed Squash and merge in Todd's Chrome on his explicit instruction. That became R21.
- **Other findings:** Factory marked its work item Done before the merge. Factory's review could not submit a formal GitHub approval, because the same account owns the PR, so it posted a comment and a `status:auto-approved` label instead. The rehearsal preview needed a Vercel sign-in (R9). Factory chose test-first on its own.

## Priority

R1–R7 and R21 decide whether the route works on its own. R8–R14 make it livable for Todd and easy to keep running. R15–R19 stop the route from being quietly replaced by agent workarounds, and they come first: without them, R1–R7 cannot be trusted.
