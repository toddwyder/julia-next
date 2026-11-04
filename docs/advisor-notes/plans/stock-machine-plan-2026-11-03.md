# Plan: a stock machine that cannot drift (3 Nov 2026)

Updated 4 Nov, 07:30 PT (JUL-336 result added). The two cards in Linear are the source for what each card requires; this file holds the reasoning, the decisions and the carry-forward list. Nothing moves to Ready until Todd says "settled".

## The problem
For months, every attempt at the loop, graph, factory or machine has drifted into custom code. Each card said "build X", so the builder built X. Where stock almost fit, custom code was the cheap path. Rules in documents never stopped it, and neither did the advisor, who added requirements stock didn't need.

Evidence from 3 Nov:
- JUL-334's build wrapped the old Mastra Code session and called it a plain agent (`machine/build/run.mjs` line 22 imports `bootHarness` from `machine/shipping/harness.mjs`). The card's criteria let that pass.
- JUL-335 showed a plain Mastra agent with three child agents works, with one correctly nested trace.
- `scripts/lint-framework.mjs` checks a folder that doesn't exist and passes anyway. The guard checks nothing.

## The approach
Make the wrong thing fail automatically:
1. Build the whole machine's shape once, in stock Mastra, before any stage is real (JUL-336).
2. Lock what static checks can lock, and run the shape's outcome test on every change (JUL-337).
3. Each stage card then replaces one stand-in with the real thing and deletes what it replaces.

## The shape (settled 3 Nov, Todd)
Agents (plain Mastra agents): build, Shipping (verifies once, against the Vercel preview, before Todd's acceptance), Remediation (Bug fix playbook on a first FAIL, Investigation playbook on a second, then the card stops), retro.
Plain fixed-rule steps: Todd's acceptance (product cards only), land (after his yes, only while Shipping's verdict covers the current code), live smoke test, cleanup, cost record.
Machine cards skip the acceptance and the preview (1 Nov).
One FAIL count per card, shared by Shipping and the live smoke test. A live smoke test FAIL goes to Remediation, then a fresh Shipping run, then straight to land with no new acceptance (Todd, 3 Nov). The merged change stays live meanwhile; nothing rolls back by itself.
Preview and smoke test are not stages: Shipping's verifier runs `verify-julia` against the preview address. pstack itself has no deploy step; Vercel deploys, and the live smoke test is the one extra step this machine adds.

## Cards
- **JUL-336** (Complete, merged 4 Nov as 0495b42, PR 439): the stock workflow carries a throwaway card through the whole path on stand-in work; a test for each outcome; restart while waiting; trace and cost record; a separate reviewer's table mapping each piece of flow logic to the Mastra feature that provides it; the key-name fix.
- **JUL-337** (Triage, blocked by JUL-336): guards for what static checks can lock, plus the outcome test on every change; the earlier framework check deleted; exact allowed package names; zero warnings; missing or empty target fails. No approval gate on guard changes, because every agent acts as Todd's GitHub account.
- Then one small card per stage, each naming the stock feature it uses and what it deletes.

## Decisions Todd made on 3 Nov
- Guard files are not protected by an approval gate (option A): a weakened rule still fails its fixture test and the Shipping reviewer reads every diff.
- Framework-lint fix reopened (cut 24 Oct).
- Mastra Studio is the proof screen for JUL-336, an exception to the dashboard rule.
- All stages are built as stand-ins first, a refinement of the 30 Oct "one step at a time" rule.
- The stage list and order above; the single FAIL count; no new acceptance after a live smoke test fix.
- The outside review's items were split into: done, applied to the cards, deferred (below).

## JUL-336 result (4 Nov)
- Merged as 0495b42 (PR 439), main's checks green, Linear Complete. Shipping verdict PASS.
- The outside reviewer's table said "not all stock". Decision: "stock" means Mastra does the order, branching, loops, retries, the wait and saved state; the contents of each stage are always our own code, and today they are stand-ins. The guards card must use that meaning.
- The old launcher crashed before reaching Shipping (it parsed garbled gh output). Not this card's work; the launcher is replaced stage by stage.
- Studio check: a run waits at the acceptance step and Studio can answer it, but the answer must match the open request id exactly, and a mismatch silently puts the card back to waiting. Todd pasted the wrapped JSON by mistake and nothing told him why.
- PR 436 closed. Branch feat/jul-334-build-step stays as the tag canceled-jul-334-build-step.

## Carry-forward list: deferred to the stage card that gives the behavior substance
From the outside review of 3 Nov. Each goes on the named card's acceptance criteria when that card is written.
- **Todd's acceptance (real):** bind his yes to the run, the pull request and the reviewed code; test no, missing, wrong-run, duplicate and changed-head answers; an agent cannot supply it. Stated limit: with one shared admin identity an agent cannot be made incapable of impersonating him.
- **Land (real):** crash recovery around the merge. Kill before, after and just before recording the merge; recovery converges to one intended result, using a stable identity for the action.
- **Start and resume (real):** policy for starting a card that is already running, resuming a run twice, and a workflow change while a run is paused.
- **Agent stages (real):** sandbox containment is tested against the installed settings, not assumed from a workspace path; pstack mapping (who owns each retry, review, pull request, wait and merge) written down with one representative delegated path using the real skills.
- **Each replacement card:** names the launch path it retires and proves the launched path is the reviewed workflow; deletes what it replaces; the orphan check arrives with the first one.
- **Todd's acceptance (real), added 4 Nov:** his yes always counts, or he is told why. A wrong or stale answer must show a message, not drop silently. He gives it by picking the card, with no id to copy. The request id is tied to the run.
- **Accepted caveats from JUL-336's review:** the trace and cost reader depends on DuckDB's span_events layout (fails loudly if it changes); priced cost is proven only with made-up prices (the first real card on a paid model tests it).
- **Accepted limit:** guard files and their fixture tests can be changed together by an admin agent.

## Evidence note: Mastra Factory evaluated and set aside (3 Nov)
A live test of stock Factory found two companies' models answering in one session only by switching the model by hand. Stock Factory exposes one "build" mode with no subagents (`modes: false`, `subagents: []`, contradicting its docs). Its UI needed a sign-in provider and GitHub/GitLab onboarding, so the test used a stand-in login and the dashboard never showed the session. A Claude model through the custom provider failed with a 400 error; a free model was not tested. Conclusion: stay on plain Mastra.

## Open items, waiting on Todd
- Say "settled" on JUL-337 (JUL-336 is done).
- PR 437 closed. PR 436 closed 4 Nov. PR 433 is open and held. JUL-331, JUL-332 and JUL-334 are written for the old plan. JUL-335 is answered and still in Triage.
- Nothing is closed, canceled or deleted until Todd says so.
- Verified 4 Nov: Studio runs on the server and can resume the waiting run, with the exact-id catch above.
