# Readiness review

A repeatable check, used at two points: before any ticket gets the `ready-for-agent` label
(`docs/agents/triage-labels.md`), and at the start of a run, by the coordinator before the
first build step. It proves a ticket (or a batch of related tickets) can run all the way
through the coordinator without stopping mid-flight on access it turns out nobody tested. See
JUL-71 for why this exists and for a worked example of running it across a whole batch of
tickets.

Sits next to the coordinator skill (`.claude/skills/julia-coordinator/SKILL.md`) and the
runbook (`docs/agents/server-runbook.md`) — read both before running a review, since
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
- At the start of a run, by the coordinator, before the first build step: post the verdict on the
  card. A pass starts the build; a fail parks the card with the reason on it.

## Rule established by JUL-71

`ready-for-agent` is applied only after a posted readiness review passes. After a pass, an access
stop during a real run is a **bug in the review** — fix the review (this doc and/or the
service-probe findings it should have caught), log the incident on the ticket that hit it, and add
the missing check to this procedure. It does not become a new permission question routed to Todd.

## Rule established by JUL-97: DONE MEANS IN USE

A ticket is not done until what it built is switched on and has been used once for real, with
that evidence on the card. Building the thing, merging its PR, and passing its tests are not
done — the artifact has to be live and exercised by a real caller at least once.

If going live needs a later step, that step happens inside the ticket; the ticket cannot close
without it. Nothing is parked as a final laptop step, and "switch it on" is never the last item
on a handover list. A ticket that cannot reach live use as a step inside itself fails this rule
rather than passing with the switch-on deferred to a follow-up note.

**This governs when the ticket may close, not whether it passes the readiness review.** The
review still passes with a named, one-time Todd action (step 4) or with a finding marked not
testable before approval: a Todd-only action such as a sign-in or a payment is allowed to be the
switch-on step **inside** the ticket. What is never allowed is closing the ticket with that
switch-on left as a follow-up or a handover note -- the action happens inside the ticket's own
steps, and the ticket does not close until it has.

(Todd, Instruction on JUL-97, 2026-09-19.)

## Orca first

**Orca first.** Before planning a step that tracks, waits on, locks, retries, cleans up or reports
on workers or usage, check Orca's docs and CLI help for the pinned version. Name the Orca feature
on the card and use it, or say in one line why not. Building by hand what Orca already provides is
a finding at review.

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
     - **the identity that makes the call.** Confirm the credential is reachable by the account
       that will **actually make the call**, not merely by the account running the review. For
       every service the ticket writes to, name the identity that will run the write and prove
       the credential is reachable to *that* identity. Worked example (JUL-97, 2026-09-19): the
       readiness review proved the Linear key works as `orchestrator-svc` and passed, but the key
       file is `orchestrator-svc`-only by design (`FIELD_GROUPS.linear` in
       `ops/service-dropbox/dropbox.mjs`), and builders run as `runner`, which is in
       `deepseek-readers` but not `orchestrator-svc`. A builder told to call
       the Linear API would have stopped dead. The resolution — also the better design — is that
       the builder writes the program and the coordinator runs it with the key. A review that
       probes only as itself has not tested the caller, and the access stop that follows is a
       review bug, not a new permission question.
     - **create capability.** Confirm the credential can **create** the resource the step needs
       (not just read or list it). Confirm, from the credential's own declared
       scopes/permissions and by reading the resource the step needs (list/get), that the
       credential is *authorized* to create that resource. Where the provider offers no read-only
       way to prove create authorization, exercising the real create path and getting a
       permission refusal (e.g. PowerSync `apps/create` → `FORBIDDEN`, so the project-creation
       step cannot run headlessly) is the failure signal — it fails the review, it does not pass
       it (runbook, "Five JUL-44 step-5 discoveries", verified 2026-09-19).
     - **database credential for replication.** Where a step needs a DATABASE credential (the
       Supabase/PowerSync pair is the worked example), confirm the credential can **create the
       narrow replication role** and the **provider-required publication** the step needs — not
       merely that it can connect. Note the direct-connection caveat: `db.<ref>.supabase.co:5432`
       resolves to **IPv6 only** and is reached by the provider's cloud; the Supabase pooler at
       `aws-0-us-west-2.pooler.supabase.com` has IPv4 if a pooler is ever needed (runbook,
       "Three JUL-44 step-6 discoveries", verified 2026-09-19).
     - **read scope for delivery proof.** Wherever the step must *prove delivery* (an event
       arrived, a write took effect), the credential needs a **read** scope for that, distinct
       from its send/write scope. Worked example: an ingest-only Axiom key can send but cannot
       read back, so "Axiom received the event" cannot be verified (runbook, "Five JUL-44 step-5
       discoveries", verified 2026-09-19). If only a send-only key exists, the review must say so
       explicitly rather than leave delivery assumed.
       - **CI green as evidence.** When a ticket claims CI green as evidence, the review must
         confirm the credential that will check CI can actually read check results. Record this
         verified fact: the julia-graph-publisher installation token returns HTTP 403 on both the
         check-runs and the actions endpoints (verified 2026-09-19, JUL-94), so such a ticket has
         to name its substitute evidence — a local run of the same test suite — rather than assume
         the coordinator can read GitHub checks.
   - **probe the seat live, not from the record.** Start each seat tool on the account that will
     run it, in this review, and read its real output. A previous ticket or review saying a tool
     is at a sign-in prompt is not evidence today — the prompt, the binary, or the login state can
     all change. Verified 2026-09-19: JUL-89 and the JUL-97 readiness review both recorded that
     Claude on `runner` was at a sign-in prompt, and a live probe that evening returned a normal
     answer and exit 0. Proximity to a prior session's note is not a probe.
   - **probe the real launch path, not a stand-in (JUL-109, 2026-09-20).** A seat is proven only when
     it is started the way the controller will really start it: an interactive session in a fresh
     Orca worktree (`orca orchestration worker-start`, or for a Pi seat a plain terminal created
     through Orca on the runner's daemon with the prompt piped into
     `node ops/service-dropbox/run-pi-seat.mjs <seat>`). A login shell of our own, `ssh runner@...`,
     or `claude -p` does not prove the seat: on 2026-09-20 a `claude -p` probe passed while the real
     launch sat at a folder-trust question for about eight hours. Record the command, the terminal's
     own `id` (a Pi seat must show `deepseek-readers`), the provider and model the run reports, that
     a real answer came back, and the cost. The seat probe checks for the answer, not for exit 0.
     Re-run the probe from a fresh worktree of the *current* base checkout after that checkout is moved,
     replaced or re-imported: Claude's folder trust is keyed by the base checkout's exact path.
   - reuse a recent, still-valid finding from a prior audit instead of re-probing, but cite the
     source doc and its date so staleness can be judged later.
   - **the coordinator's own command permissions (2026-09-21).** Reachable services are not enough:
     confirm that the shell the COORDINATOR itself runs in is allowed to run the commands the step
     needs. Name them and prove each one — `sudo` where the step installs or restarts anything,
     `git fetch`/`git push` from the coordinator's own checkout where it publishes or rebases, and
     file reads outside its own project folder where the step reads a key, a service file or
     another worktree. Worked example (2026-09-21): a coordinator session was launched whose shell
     could not use `sudo`, could not fetch from GitHub in its own checkout, and could only read
     files inside its own project folder. It happened not to block that run, because Orca, the
     publisher, the health check and the Linear tools were all still reachable — but the review had
     no check that would have caught it either way. **What breaks if this stays:** a coordinator
     can pass a readiness review and then stop dead mid-run on the permissions of its own machine,
     which is precisely the kind of access stop the review exists to prevent, and which the rule
     established by JUL-71 says must be fixed in the review rather than routed to Todd as a new
     permission question.

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

7. **Post it** as a Linear comment on the review ticket. Posted at triage time, `ready-for-agent`
   goes back on the tickets that passed only after Todd approves. Posted at run time by the
   coordinator, a pass starts the build and no approval is needed. Tickets that failed stay
   unlabeled until their named gap is closed and they're re-reviewed — don't relabel on an
   assumption that a gap was closed elsewhere.

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

**When you record a gap, record what breaks if it stays.** "Not tested" or "no figure for X" is not a
finding on its own. Say what will go wrong, for whom, and how soon (for example: "the cost line will be
blank for the seat doing most of the work"). A gap without its consequence reads as a footnote.
