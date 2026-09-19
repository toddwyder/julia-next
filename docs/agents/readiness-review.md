# Readiness review

A repeatable check, run before any ticket gets the `ready-for-agent` label
(`docs/agents/triage-labels.md`). It proves a ticket (or a batch of related tickets) can run
all the way through the coordinator without stopping mid-flight on access it turns out nobody
tested. See JUL-71 for why this exists and for a worked example of running it across a whole
batch of tickets.

Sits next to the coordinator skill (`.claude/skills/julia-coordinator/SKILL.md`) and the
runbook (`docs/agents/jul43-coordinator-runbook.md`) — read both before running a review, since
this procedure only adds the pre-flight check those two don't already cover.

## When to run it

- Before applying `ready-for-agent` to a ticket that wasn't already covered by a passing batch
  review.
- Whenever a batch of related tickets shares services or a dependency chain — run it once across
  the whole batch, grouped by service, not once per ticket. Repeating the same service probe once
  per ticket wastes the run and risks drifting answers.
- Again, for a ticket that already passed, if a service it depends on changes (new provider, new
  credential location, a prior probe goes stale) — a readiness review is a snapshot, not a
  standing guarantee.

## Rule established by JUL-71

`ready-for-agent` is applied only after a posted readiness review passes. After a pass, an access
stop during a real run is a **bug in the review** — fix the review (this doc and/or the
service-probe findings it should have caught), log the incident on the ticket that hit it, and add
the missing check to this procedure. It does not become a new permission question routed to Todd.

## Procedure

1. **List the tickets in scope.** For a batch, pull every open ticket in the batch with its full
   description and comment history (`mcp__linear__get_issue` + `mcp__linear__list_comments`).
   Read the newest `Instruction:`/`Decision:` comments — they can supersede ticket text.

2. **Extract, per ticket:**
   - every account or service it touches (be exhaustive — a "minimal" ticket can still imply a
     database, a deploy target, an observability sink);
   - every tool/CLI that has to be installed, and where (laptop vs. the server's builder identity
     vs. the server's orchestrator identity — these are different accounts with different
     permissions, see the runbook's role table);
   - any product decision the ticket leaves open or only implies;
   - anything that smells like it will need a one-time action from Todd.

3. **Group by service, not by ticket**, and for each service actually test read-only access with
   the real tool in the real intended environment — don't infer from documentation alone if a live
   check is possible:
   - run the actual CLI/login command and read its real output;
   - if a live probe isn't safe or possible before Todd's approval (e.g. it would create an
     account, spend a quota slot, or need a credential nobody has yet), say exactly why, and mark
     it **not testable before approval** rather than guessing.
   - **write-scope check.** For every service the ticket will WRITE to, confirm the *specific*
     scope/capability the step needs — not merely that the credential is reachable or authorized
     at all. Make the actual privileged call **read-only** and read the credential's own declared
     scopes (for Sentry, `GET https://sentry.io/api/0/` returns `auth.scopes`). Reachability and
     authorization are different things; a reachable credential whose declared scope does not
     include the write the ticket needs is a **review failure**, not a pass.
   - reuse a recent, still-valid finding from a prior audit instead of re-probing, but cite the
     source doc and its date so staleness can be judged later.

4. **Score each ticket pass/fail** against what step 3 actually found: a ticket passes only if
   every service and decision it depends on — including everything upstream in its `blockedBy`
   chain — is either proven reachable or has a named, one-time Todd action that closes the gap.
   A ticket blocked by an unresolved upstream ticket is itself a fail, with that upstream ticket
   named as the reason — don't re-derive a fresh verdict from nothing.

5. **Collect every one-time Todd action found across every ticket in the batch into one ordered
   list** ("one sitting") — this is the entire point of batching: Todd sees the whole cost up
   front once, not piecemeal across fifteen separate stops.

6. **Write the verdict page** (see JUL-71 step 3 for the required section list: services and
   access, one sitting, open product decisions with a recommendation each, the Claude Code
   permission policy in force, and per-ticket pass/fail with reasons). Mark every access claim on
   the page **tested** or **not testable before approval**, with why — a page a non-technical
   reader can act on without opening any other comment or doc.

7. **Post it** as a Linear comment on the review ticket. Only after Todd approves does
   `ready-for-agent` go back on the tickets that passed. Tickets that failed stay unlabeled until
   their named gap is closed and they're re-reviewed — don't relabel on an assumption that a gap
   was closed elsewhere.

## What "tested" means here

- **Tested (this session):** a real command was run against the real service/tool in the real
  intended environment (the server's `orchestrator-svc` identity for production services, the
  laptop for laptop-only steps) and its actual output is what the verdict is based on.
- **Tested (prior audit):** a citation to a specific prior doc and date whose live probe is still
  plausibly current — say why it's still trusted, not just that it once passed.
- **Not testable before approval:** naming the concrete reason (needs a credential nobody has yet,
  would create a paid resource, needs Todd's account access) — this is a legitimate outcome, not a
  failure of the review, but it must be resolved by Todd's approval before the ticket can pass.

Never write "should work" or "presumably fine" as a substitute for one of the three above.
