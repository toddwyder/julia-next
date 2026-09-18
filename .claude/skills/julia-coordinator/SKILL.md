---
name: julia-coordinator
description: Moves julia-next work items through the development workflow via Orca on the OVH runner. Invoked by explicit launch only -- no scheduled trigger exists yet.
disable-model-invocation: true
---

# Julia-next coordinator

You **move work**; workers do it. You start workers, verify their evidence, and advance
or park each item. You never edit code yourself.

Adapted from `toddwyder/Julia`'s `.claude/skills/julia-coordinator/SKILL.md` (the verified
decision procedure that repo already runs). The frozen `toddwyder/Julia` repo is untouched by
this adaptation -- everything below is julia-next's own copy, wired to julia-next's own
tracker, worker dispatch, and publisher.

Use Orca orchestration (`scripts/orca-cli.mjs`) for every Run, Task, worker, and diagnostic
terminal, following Orca's own `orchestration` skill. Every GitHub write -- PR open, branch
push, merge -- goes through the **publisher** (`scripts/publish-pr.mjs` for branch-push/PR-open,
`scripts/merge-pr.mjs` for merging; both call `scripts/publish-via-github-app.mjs` internally to
mint a fresh installation token per use -- that module only mints tokens, it does not itself
publish anything). The publisher is the only component with GitHub write access. Every Linear
write goes through the tracker's own comment/state calls (`mcp__linear__*`), never a personal
session standing in for the coordinator.

**A discovery about the server or its tools is not recorded until it's in the runbook.** Any
new fact about the OVH box or the tooling on it -- a binary's real path, a socket location, a
pairing mechanism, a systemd unit's behavior -- goes into
`docs/agents/jul43-coordinator-runbook.md` **in the same PR** that used the discovery, not only
narrated in a Linear comment. A Linear comment documents what happened *this session*; the
runbook is what a fresh session with no memory of this conversation reads instead. Treat
"discovered it, used it, moved on without updating the runbook" as an incomplete step.

**Width is 1**: at most one work item in flight.

---

## Tracker: Linear, not GitHub issues

Work items are Linear issues on team **Julia-next** (`docs/agents/issue-tracker.md`). A ticket's
own description is its approved work definition -- there is no separate packet/review-comment
protocol the way a GitHub-Project board config would need.

## Each wake

**1. Reconcile.** Read Orca's run/task list (`orchestration run-list`, `task-list --run <id>`)
for any run this coordinator started, and the matching Linear issue and its comments. For each
in-flight item, find its last **verified** step -- a step counts only when you verified its
evidence yourself (re-run the check, read the actual Orca outcome, read the actual Axiom
event), never a worker's claim alone.
*Done when* every in-flight item has a known last-verified step and a next action.

**2. Advance in-flight work.** For each in-flight item, take its next action (see Running a
step). A finished worker you have not yet verified comes first.
*Done when* every in-flight item is running, verified-and-advanced, or parked in the queue.

**3. Admit.** If a slot is free, admit the first eligible issue in board order. Eligible means
all of:
- the issue carries label `ready-for-agent`, which is applied only after a posted readiness
  review passes (`docs/agents/readiness-review.md`, rule established by JUL-71) -- never apply
  it yourself from a ticket's description looking plausible;
- its stated dependencies (Linear `blockedBy`) are closed;
- its route is enabled (below).

**A passed readiness review is a promise, not a suggestion.** After a review passes, an access
stop mid-run is a bug in the review, not a new permission question for Todd: fix the review
(the procedure doc and/or the service-probe findings that should have caught it), log the
incident on the ticket that hit it, and add the missing check to `readiness-review.md`. Do not
re-route it to Todd as if no review had happened.

Record the admission with a Linear comment (who/what/when), then start Run/Task creation.
If a slot is free and nothing is eligible, post a **starvation** status on the wayfinder map
(`JUL-5`) naming the cause: backlog empty, everything blocked, or route not enabled.
*Done when* the slot is filled or starvation is reported with its cause.

End the wake. The next explicit launch continues from Orca's and Linear's recorded state --
there is no scheduled trigger yet (see `docs/agents/jul43-coordinator-runbook.md`).

---

## Routes

| Route | What it means | Status |
|---|---|---|
| `journey-zero` | Prove the delivery/evidence pipeline itself (JUL-42's children, currently JUL-43) | Enabled -- this is the coordinator's first job |
| ordinary feature/fix work | Normal admission once journey-zero is proven | Not yet enabled -- no worker skill exists for julia-next product code yet |

An issue on a route that is not enabled stays in the backlog and counts toward starvation.

---

## Running a step

For the current step of the current item:

1. **Start a fresh worker in its own fresh worktree, from the seat table
   (`graph/seat-table.mjs`), never a hardcoded vendor name.** Read `SEAT_TABLE.builder` for a
   build step, `SEAT_TABLE.reviewer` for a review step. Use the entry's `primary` unless the item
   is being force-run on its backup (see below) or the primary's last attempt on this exact step
   ended with a usage-cap error (`scripts/julia-run.mjs`'s `CAP_ERROR_PATTERN`) -- then use the
   `backup` entry instead, for this step only; the table is re-read fresh on the next step, so a
   capped seat doesn't stay pinned to its backup for the rest of the item.
   - **`claude`/`codex` entries** dispatch exactly as before: `runCreate` then `workerStart`
     (`scripts/orca-cli.mjs`), targeting `--environment "OVH runner"`, `--agent claude`/`--agent
     codex`, `worktree: 'new-top-level'`.
   - **`pi-deepseek`/`pi-glm` entries (the backups) cannot go through `workerStart --agent pi`.**
     `workerStart`'s `--agent <id>` launches a known TUI agent with no way to pass Pi's own
     `--provider`/`--model` selection or seat-specific secret through it, and `runner` (the one
     identity both builder and reviewer dispatch as) can't hold two different default
     models for its one Pi installation at once -- confirmed by reading Pi's own `settings.json`
     documentation (`defaultProvider`/`defaultModel` are process-wide, not per-invocation, and
     `workerStart` has no flag-passthrough). Instead: create a plain worktree (`orca worktree
     create --repo path:/home/runner/julia-next --name <step-name> --base-branch main
     --no-parent`, no `--agent`), then `orca terminal create --worktree <that path> --command "{
     cat <the acceptance criteria as a prompt file>; } | node ops/service-dropbox/run-pi-seat.mjs
     <seat>"` where `<seat>` is `builder-backup` or `reviewer-backup` (`ops/service-dropbox/run-pi-seat.mjs`
     resolves the right provider/model/secret from the seat name alone -- never pass a secret in
     this command string). This path has no `worker-show`/`workerAbandon` supervision, so step 3
     below (Verify) is the only place its evidence gets checked -- read the worktree's actual git
     commit yourself; there is no `collectWorkerResult`-equivalent for this path yet.

   Either way, the worktree is fresh and top-level -- **not** the shared registered
   `/home/runner/julia-next` checkout. Two reasons, not one: criterion 2 requires an *isolated*
   worktree per attempt, and `orca-cli.mjs`'s `workerStart` always sends the creation-only flags
   `--name`/`--setup`, which the real CLI rejects outright for `current`/existing-worktree
   selectors (confirmed live, and by PR #3's independent review, finding C2) -- so targeting the
   shared checkout would fail before dispatch even started, not just violate isolation. Give each
   worktree a distinct `--name` (e.g. `jul43-step-<n>`) so concurrent/retried steps never collide.
   Also pass an exact `repo` selector (`path:/home/runner/julia-next`) -- `workerStart` now
   requires this explicitly rather than inferring it, since inference only happens to work while
   julia-next is the sole registered project on this environment (fix-verification review, C2
   residual). Hand the worker: the Linear issue, the step's concrete acceptance criteria
   verbatim, and any prior failure to fix. Emit a `coordinator_started` event (see Journey
   accounting) before dispatch.

   **Forcing an item onto its backups (JUL-77 acceptance runs)**: an `Instruction:` comment on
   the issue naming "force backups" makes every step of that item use `backup` instead of
   `primary` for builder and reviewer, regardless of cap state, until the item completes or is
   re-parked. Record which mode was used on every step's retro line (below) -- forced-backup is
   not the default and must never look like an ordinary run in the record.
2. **Wait** for the dispatch to settle (`orchestration check --wait` / `worker-show`), following
   Orca's own recovery rules -- absence is never proof of failure or success.
3. **Verify** the step's evidence yourself: `scripts/collect-worker-result.mjs`'s
   `collectWorkerResult` reads the worker's actual git branch/commit and translates Orca's own
   outcome, never a hand-typed result. Its two required inputs, concretely: `orcaOutcome` is
   `worker-show`'s own `projection.outcome` field from step 2 above (`'succeeded'`/`'failed'`/
   `'timed_out'`), passed straight through; `createWorkerResultImpl` is AI-Stack's
   `orchestrator/lib/claude-worker.mjs`'s `createWorkerResult`, imported from whichever AI-Stack
   checkout this session already has (there is no cross-repo import baked into
   `collect-worker-result.mjs` itself, by design -- it stays testable without an AI-Stack
   checkout present). Re-run whatever check the criterion names (a command, a live query) rather
   than trusting the worker's prose.
4. **Pass** → emit `coordinator_progress`, then either continue to the next step or, if this
   was the last step, go to **After verification** below.
   **Fail, worker-reported** → start a fresh worker on the same step with the failure attached.
   After 3 failed attempts, stop retrying; park the item as **Blocked** in Todd's queue with the
   evidence and emit `coordinator_failed`.
   **Fail, coordinator-found** (you find the failure after the worker reported done) → open a
   new Task for the step with the failure attached; count it toward the same 3-attempt limit.
   **Fail, usage-cap error on the seat's primary** (its own output matches
   `scripts/julia-run.mjs`'s `CAP_ERROR_PATTERN`) → restart the same step immediately on the
   seat's `backup` entry. This restart does **not** count toward the 3-attempt limit -- it's the
   table doing its job, not a failed attempt. If the *backup* also ends in a cap error, that is
   an ordinary failure and does count, since the table has no third entry to fall further back
   to.

## After verification: review and publish

1. Start a **Codex** worker with no prior context on this ticket to review the change against
   the issue's acceptance criteria. It saves its review as a file **outside** the candidate
   worktree -- the review must never become part of, or be mistaken for a change to, the thing
   it reviews.
2. **Diff the reviewer's worktree against the candidate commit before trusting the review**
   (`scripts/verify-reviewer-worktree.mjs`'s `rejectIfReviewerTampered`, or the CLI: `node
   verify-reviewer-worktree.mjs --worktree <reviewer worktree path> --commit <candidate commit
   sha>`). This catches both an uncommitted edit and a committed one -- `git diff <commit>`
   against the working tree sees either. **Any** difference rejects the review outright: treat
   it the same as a failed step (a fresh reviewer worker, same candidate commit, same 3-attempt
   limit), never a partial pass. A clean diff is required, not sufficient -- still read the
   review's actual content against the acceptance criteria.
3. The publisher pushes the worker's verified branch (`scripts/publish-pr.mjs push`) and opens a
   PR with the evidence and review attached (`scripts/publish-pr.mjs open`), or posts the Linear
   evidence comment for a non-code item. Check whether a PR already exists before creating one.
   Resolve a base-branch conflict (e.g. another merge landed on `main` first) with a normal local
   merge before re-pushing -- do not force-push.
4. Emit `coordinator_completed` (or `coordinator_failed` if publishing itself failed) and park
   the item with an **acceptance** queue item naming the result.

**Publisher prerequisite, checked not assumed (2026-09-16):** the `julia-graph-publisher` GitHub
App **is installed on `toddwyder/julia-next`** -- confirmed live against the repo's own Settings
-> Integrations page and by a real successful token mint; an earlier draft of this skill claimed
otherwise from a stale cross-repo doc (`docs/credentials-map.md` in the frozen `Julia` repo),
never re-checked against the live page. If `check-readiness.mjs` or `publish-pr.mjs`/`merge-pr.mjs`
ever again report "not installed on toddwyder/julia-next", that is a real, disclosed blocker --
park the item and ask Todd to add the repo under the App's GitHub installation settings (one
click, App-owner only). Never substitute a personal `gh`/git push.

---

## Journey accounting (Axiom)

The relay (`ops/journey-relay/relay.mjs`) binds to `127.0.0.1:8943` **on the OVH runner only** --
it is not reachable from wherever the coordinator's own process happens to run. So every
`coordinator_*` event is emitted by running `scripts/coordinator-events.mjs`'s real CLI entry
point **inside a plain diagnostic terminal on the OVH runner itself**, via `orca-cli.mjs`'s
`terminalCreate`/`terminalRead` (not a supervised worker -- this is a one-off shell command, not
an agent). Pass `context` as base64, never as raw JSON embedded in a shell string --
`JSON.stringify` does not escape apostrophes for a shell, so an unescaped context value can break
quoting and become an injection vector (PR #3 review, finding C3):

```js
import { terminalCreate, terminalRead, terminalWait } from './orca-cli.mjs';
const contextB64 = Buffer.from(JSON.stringify(context)).toString('base64');
const created = await terminalCreate({
  environment: 'OVH runner',
  worktree: 'path:/home/runner/julia-next',
  command: `node scripts/coordinator-events.mjs ${stage} --run-id ${runId} --context-b64 ${contextB64} --tokens-used ${tokensUsed} --quota-remaining ${quotaRemaining} --interrupted ${interrupted}`,
  title: 'coordinator-events',
});
// A single immediate read races the command's own completion -- wait for
// the shell prompt to return before trusting the output as the command's
// final state (fix-verification review: "does not guarantee event
// delivery evidence").
await terminalWait({ environment: 'OVH runner', terminal: created.terminal.handle, forState: 'tui-idle', timeoutMs: 15000 });
const read = await terminalRead({ environment: 'OVH runner', terminal: created.terminal.handle });
// read.terminal.tail (an array of lines) confirms sent:true / sent:false, logged either way.
```

Correlate every event of one coordinator pass by a single `runId` (the same id used for
`runCreate`'s objective). Stages: `started`, `progress`, `completed`, `failed` -- matching
`scripts/coordinator-events.mjs`'s fixed vocabulary. A failed emit or unreachable relay is
still logged locally (the script does this itself); never let a relay outage silently drop
the record.

**Stalled-run query** (read in Axiom's own UI or via its API against dataset
`julia-next-journey0` -- no new dashboard or service): a run is stalled if it has a
`julia.journey0.coordinator_started` event with no matching `coordinator_completed` or
`coordinator_failed` sharing the same `runId` within a reasonable window, e.g.

```
['julia-next-journey0']
| where event == "julia.journey0.coordinator_started"
| join kind=leftouter (
    ['julia-next-journey0']
    | where event in ("julia.journey0.coordinator_completed", "julia.journia0.coordinator_failed")
  ) on context.runId == context.runId
| where isnull(context.runId1)
| where _time < ago(30m)
```

(Adjust the join condition to however the APL parser resolves nested `context.runId` in the
live dataset -- verify against a real query before trusting the exact syntax above.)

**Readiness check** (`node --env-file=<publisher credential file> scripts/check-readiness.mjs`):
before starting any run, confirm Orca reports the OVH runner `reachable`/`connected`, the
`julia-next` project is registered there, the publisher App is installed on `julia-next`, and
the journey-relay is reachable (checked the same terminal-on-runner way, not assumed from
wherever the check itself runs). No `LINEAR_API_KEY` check -- the coordinator is a live agent
session using Linear's MCP tools directly, not a headless script needing its own key.

**Preserve JUL-43's own accounting fields**: time, context, token, quota, and interruption
counts belong in the event `context` payload exactly as `scripts/journey-events.mjs` already
shapes them -- this skill does not change that shape, only which process is trusted to call it.

---

## Todd's queue

Three kinds, each posted as a Linear comment on the issue: **blocked** (including any
credential/access boundary a worker hit), **acceptance**, and (once ordinary feature/fix routes
are enabled) **criteria approval**. Each gives the issue, the kind, one plain-English question,
and a recommendation. Evidence stays on the issue, not in chat.

A parked item frees its slot and records its resume condition. When the condition is met, it
re-enters admission like any other item, and its evidence is re-verified before it is trusted.

**Report trailer.** Every report a coordinator or worker posts on a Linear issue ends with a
section headed exactly `For Todd:` of at most two lines: (a) what just happened, in plain
English; (b) whether anything needs his decision -- write `nothing` if not. Instructions and
decisions arrive on the issue as comments prefixed `Instruction:` or `Decision:`; read the
newest of those before acting on any step.

**A correction is reposted whole, never patched in a follow-up comment.** If Todd is meant to
follow something step by step (a walkthrough, a checklist, a runbook posted as a comment), a
correction to it never lands as a separate "see the fix above" comment -- that leaves two
comments a reader has to cross-check, and JUL-72 proved a real reader (Todd himself) can follow
the older, now-wrong one by mistake. Instead: post one new comment containing the complete,
corrected, standalone version (every earlier correction folded in, no references to other
comments), then edit every comment it supersedes to prepend `SUPERSEDED -- do not follow. The
current version is the newest comment on this issue.` (keep the rest of the superseded comment's
text intact, for the record). This applies to any step-by-step artifact, not just walkthroughs --
the same rule holds for a checklist or set of instructions Todd is actively executing.

**Laptop-bypass rule.** Laptop Claude Code running with permissions bypassed
(`--dangerously-skip-permissions`) is for infrastructure/setup tickets only. Product tickets run
on the server orchestrator (`orchestrator-svc` via Orca). A product ticket found running on
laptop Claude Code is a stop-and-report condition, not a workaround.

**Must never do (laptop or server, either identity).** Regardless of which side is running a
ticket, an agent must never: create, delete, or change anything in one of Todd's service
accounts (Vercel, Supabase, PowerSync, Sentry, Axiom, GitHub, Linear, or any other) outside a
step Todd has explicitly approved in a readiness review's "one sitting" list; push to, or open a
PR against, a repository outside the publisher's own `APPROVED_TARGETS` allowlist
(`scripts/publish-pr.mjs`: `toddwyder/julia-next`, `toddwyder/Julia`, `toddwyder/AI-Stack`);
touch any path outside the `julia-next` checkout it was dispatched into; spend money or change
billing/plan/subscription settings on any service; substitute a personal `gh`/git credential for
the publisher's GitHub App, from either the laptop or the server; or run more than one work item
at a time (the width-1 rule, above). A laptop session that cannot reach the publisher (it holds
no `JULIA_PUBLISHER_APP_ID`/`JULIA_PUBLISHER_APP_PRIVATE_KEY`, and its Orca pairing reaches only
the `runner` builder identity, never `orchestrator-svc`) must say so and stop, not fall back to a
personal push.

**How this gets checked.** Every run posts its action log as a Linear comment before being
called finished (the `For Todd:` trailer below is the summary; the body above it is the log).
Closing a ticket means checking that log against the must-never-do list above, line by line, not
just reading the summary. A run found to have touched an account, a repo, or a path outside its
approved step -- whether laptop or server, whichever identity -- is a stop-and-report bug per the
laptop-bypass rule, not a shortcut to quietly let finish or a fact to omit from the next report.

---

## JUL-43 specifically

JUL-43's five acceptance criteria are unchanged by this skill and must stay unchanged:
1. Todd performs at most one approval click; no terminal commands, tokens, or setup for Todd.
2. An agent receives the work and commits locally in an isolated worktree.
3. The builder can read the repository; a direct GitHub push is denied.
4. The attempt records time, context, token, quota, and interruption events, delivered live to
   Axiom.
5. The result is summarized in plain English with evidence links.

Every prior attempt's real outcome (met, not met, and exactly why) stays disclosed on the
issue -- this skill does not get to silently claim a criterion the issue's own history shows
as still open. Treat the issue's comment history as the authoritative record of what has
actually been proven; do not re-derive it from memory each wake.

---

## Record for the retro

Each step status line carries: step, outcome, attempt count, and whether Todd was needed. Add
cost when available. This record is the retro's only input, so every step gets a line,
including failures.
