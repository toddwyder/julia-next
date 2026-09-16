# JUL-43 coordinator runbook

Status as of 2026-09-16 (session 4): the two session permissions session 3 found blocking are
now granted and verified live -- `check-readiness.mjs` reports `READY: true` end to end,
including a real `sent:true` event through the journey-relay. PR #2 (the Axiom relay code) is
merged to `main`. PR #3 (this session's coordinator-adaptation code) went through a real fresh
Codex review, which found and this session fixed two P1 credential-boundary gaps in
`publish-pr.mjs` (the App's private key was reaching the git subprocess's environment; nothing
disabled git hooks/credential helpers) plus four correctness gaps (see "Session 4" below). See
`.claude/settings.local.json` for the exact granted permissions -- Todd approved that file's
content directly in chat before it was written, and it is scoped to specific scripts and specific
`orca.exe` subcommands, not a blanket grant.

Earlier history, unchanged: session 2 held the
Orca-dispatch coordinator in favor of a GitHub-Actions/BERTHA route
(`julia-next-supervised-worker-manual.yml`); that route is itself now held, because the
Linear-tracker AI-Stack code it depended on was only ever built in a throwaway local clone and
never actually pushed to `toddwyder/AI-Stack` -- checked directly against AI-Stack's real `main`
branch, not assumed. This session restores the Orca-dispatch pieces session 2 deleted (adapted,
not reverted verbatim) and wires them to `.claude/skills/julia-coordinator/SKILL.md`, julia-next's
own copy of the verified coordinator decision procedure already running in the frozen
`toddwyder/Julia` repo.

**The coordinator is the skill, not a script.** `scripts/orca-cli.mjs`,
`scripts/collect-worker-result.mjs`, and `scripts/publish-via-github-app.mjs` are library
functions the skill's steps call while a live agent session follows its decision procedure --
there is no standalone `run-jul43-coordinator.mjs` entry point anymore, on purpose. Treating a
JUL-43-specific wrapper script as "the coordinator" was exactly what session 2's hold-commit
correctly avoided repeating.

## What's verified live, as of this session

Checked directly, not assumed:
- Orca CLI is real and reachable from this machine at
  `C:\Users\toddw\AppData\Local\Programs\orca\resources\bin\orca.exe`. `orca status
  --environment "OVH runner" --json` returns `runtime.reachable: true`,
  `connectionState: connected`.
- `orca project setups --environment "OVH runner" --json` shows `julia-next` registered and
  `ready` at `/home/runner/julia-next`.
- `orca worktree list --environment "OVH runner" --json` shows the worktrees named in JUL-43's
  Linear comment history really exist (`jul43-axiom-boundary`, `jul43-clean-run`,
  `jul43-codex-proof`, etc.) -- that history is real, not fabricated.
- **Creating a terminal or dispatching a worker on the OVH runner is blocked from this
  particular session** by this environment's own safety classifier ("Sensitive Remote Exec") --
  the same guardrail class earlier JUL-43 sessions hit and correctly did not route around. Only
  read-only Orca queries (`status`, `project setups`, `worktree list`) succeeded here. A live
  coordinator run needs either a session with that permission, or Todd running the dispatch step
  himself using the commands this runbook documents.
- **Correction, checked live in the browser against `toddwyder/julia-next`'s own Settings ->
  Integrations page (2026-09-16), not the frozen `Julia` repo's `docs/credentials-map.md`:** the
  `julia-graph-publisher` GitHub App **is** installed on `toddwyder/julia-next` -- that doc is
  stale on this one point, and this runbook's earlier draft this session repeated its stale
  claim without checking the live page first. Minting a token still needs
  `JULIA_PUBLISHER_APP_ID`/`JULIA_PUBLISHER_APP_PRIVATE_KEY` readable by whichever process runs
  `publish-via-github-app.mjs`; that local credential file (`C:\Julia\.env.publisher.local`) is
  itself unreadable from this particular session -- blocked by the same environment's
  "Credential Materialization" classifier. That is a session-permission gap, not a missing
  installation.
- `julia-next` has **zero** repository secrets (`gh secret list --repo toddwyder/julia-next`
  returns nothing) -- expected: this route mints the publisher token fresh per use rather than
  storing a long-lived one, and the coordinator reads/writes Linear through its own MCP tools
  (`docs/agents/issue-tracker.md`), not a standalone `LINEAR_API_KEY` -- `check-readiness.mjs`
  no longer checks for one; that requirement was inherited from an earlier session's
  headless-script design this route doesn't use.
- PR #2 (`jul43-journey-relay` -> `main`, the Axiom relay client + trusted-boundary code) is
  still **open, unmerged**. `julia-next`'s `main` branch has none of `ops/journey-relay` or
  `scripts/journey-events.mjs` -- only what's on this local branch.

## The coordinator's actual startup

There is no scheduled trigger -- explicit launch only, per instruction. Starting a fresh Claude
Code (or equivalent) session in this repo and invoking the `julia-coordinator` skill (it has
`disable-model-invocation: true`, so it must be invoked by name, not inferred) begins a wake:
it reconciles Orca + Linear state, advances the current in-flight item (JUL-43 itself, until its
five criteria pass together), and admits the next eligible Linear issue once a slot is free.

```sh
node scripts/check-readiness.mjs
```

first -- see below for what it actually checks now.

## Readiness check (rewired to the real boundary)

`scripts/check-readiness.mjs` no longer checks BERTHA/GitHub-Actions secrets (that route is
held). It checks, each as its own pass/fail line:

1. **OVH runner reachable** -- `orca status --environment "OVH runner" --json`,
   `runtime.reachable` and `connectionState === 'connected'`.
2. **julia-next project registered** -- `orca project setups`, a `ready` entry for
   `github:toddwyder/julia-next`.
3. **julia-graph-publisher installed on julia-next** -- attempts the same installation lookup
   `publish-via-github-app.mjs` uses for a real publish (requires
   `JULIA_PUBLISHER_APP_ID`/`JULIA_PUBLISHER_APP_PRIVATE_KEY` in the coordinator's own process
   environment).
4. **journey-relay reachable** -- run from **inside a terminal on the OVH runner itself** (the
   relay binds to `127.0.0.1:8943` there only), via `orca-cli.mjs`'s `terminalCreate`/
   `terminalRead`; a real POST to `/events` should come back `sent:true`.

(No `LINEAR_API_KEY` check -- the coordinator is a live agent session using Linear's MCP tools
directly, not a headless script needing its own key.)

## Session 4 (2026-09-16): permissions granted, PR #2 merged, PR #3 reviewed and fixed

Both of session 3's blockers are resolved:

1. **Credential access**: `.claude/settings.local.json` (project-scoped, in this repo) allows
   `node --env-file="C:\Julia\.env.publisher.local" scripts/{check-readiness,merge-pr,publish-pr}.mjs`.
   The credential file is loaded by Node's own `--env-file` flag directly into the subprocess's
   environment -- never read via the `Read` tool, never printed. Verified live: the private key
   and every minted installation token stayed out of this session's output across a real PR
   merge and a real branch push + PR open.
2. **Orca dispatch**: the same settings file allows the specific `orca.exe` subcommands the
   coordinator needs (`orchestration run-create/worker-start/worker-show/worker-abandon`,
   `terminal create/read/wait`), each anchored to `--environment "OVH runner"` immediately after
   the subcommand name. An open-ended `--command "bash"` terminal was correctly still blocked by
   the session's own risk classifier (a persistent shell reads as a standing remote-exec risk
   regardless of the settings file) -- one-shot diagnostic commands and real `worker-start`
   dispatches both work.

**What actually happened this session, in order:**
- Fixed real bugs in `orca-cli.mjs`/`check-readiness.mjs`: the installed CLI's actual `--json`
  envelope is `{id, ok, result, _meta}` / `{ok:false, error:{code,message}}`, and a real failure
  can carry that structured body on **stdout with a nonzero exit**, not just `ok:false` on a
  successful process -- neither was handled before. `workerStart`'s flag order was also fixed so
  `--environment` has a fixed position in every subcommand (needed to write a scoped permission
  rule at all).
- Merged PR #2 (`79f9de3`, by `app/julia-graph-publisher`) after confirming its head was already
  independently reviewed, checks were green, and no review was outstanding.
- Built `merge-pr.mjs` and `publish-pr.mjs` -- the coordinator's actual publish actions (merge,
  branch push, PR open). Opened PR #3 with this session's coordinator-adaptation code, resolved
  one real merge conflict (`.github/workflows/ci.yml`, both branches had independently added the
  file) with a normal local merge, not a force-push.
- Dispatched a **real, fresh Codex worker** (`orchestration worker-start --agent codex`, run
  `run_f343594b358f`, dispatch `ctx_18d60b488250`) to review PR #3 against JUL-43, per this
  skill's own "After verification" step. Verdict: **request changes** -- two P1 security findings
  (`publish-pr.mjs` spread the App's private key into the git subprocess's environment, where a
  repo hook could read and leak it; nothing disabled git credential helpers/hooks) and four
  correctness findings (this skill's own dispatch instructions conflicted with the installed
  CLI's real flag rejections; `coordinator-events.mjs` had no CLI entry point despite this skill
  documenting one; a real Orca failure's structured error was being dropped; this skill had
  stale claims about the App's installation and a `LINEAR_API_KEY` requirement that
  `check-readiness.mjs` had already dropped). Full review saved on the runner at
  `~/jul43-pr3-review.md` (outside the candidate worktree, per this skill's own instruction).
- Fixed all six findings via TDD (failing test first) in this same session -- see the commit that
  follows this runbook update for the exact diff. 45/45 tests green afterward. This skill's own
  text was corrected to match: worker dispatch now documents `worktree: 'new-top-level'`, not the
  shared registered checkout; the Journey-accounting example passes context as base64, not raw
  JSON in a shell string; the stale App-installation and `LINEAR_API_KEY` claims are removed.

**Not yet done**: a fresh review of PR #3's *fix* commit (the six findings above were fixed after
the review that found them, not re-reviewed) -- read the fix commit's diff yourself before
trusting it as clean, the same way you'd verify any other worker's claim. PR #3 itself is **not
merged** -- Todd's authorization named PR #2 specifically ("other merges remain outside this
grant"); merging PR #3 needs its own explicit yes.

## Verification, after a run

1. Read the Linear issue's own comment thread -- the coordinator posts admission, blocked, and
   acceptance updates there, not in chat.
2. Confirm the PR (if any) was opened by `julia-graph-publisher[bot]`, not a personal account --
   `julia-next`'s own `publisher-only-pr.yml` check on the PR shows this automatically.
3. Confirm in Axiom (dataset `julia-next-journey0`) that `coordinator_started` /
   `coordinator_progress` / `coordinator_completed` (or `_failed`) events exist for the run's
   `runId`, and that no run is stalled (see the query in the skill's Journey accounting
   section).
4. Confirm `git log` on the pushed branch shows a real commit, and that `julia-next`'s own
   `main` was never pushed to directly (only the PR branch).

## Stop / recovery

- **Stopping a run in progress**: use Orca's own recovery verbs (`worker-stop` for a proven
  failed/stopped attempt, `worker-abandon` to fence orchestration while accepting resources may
  remain live) -- never `terminal close` as a substitute. See Orca's own `orchestration` skill,
  "Recovery and cleanup".
- **Recovering from a publish failure** (worker succeeded, publish step failed): the worker's
  commit still exists in its worktree on the runner even if the publish step errored --
  re-run just the publish step against that same worktree rather than re-dispatching the whole
  step.
- **If `publish-via-github-app.mjs` reports "not installed on toddwyder/julia-next"**, that is
  bootstrap approval #1 above, not a bug -- park the item and ask, don't retry blindly.

## Known open questions for the live-verification pass

- Linear's `commentCreate` mutation may need the ticket's internal UUID rather than its human
  identifier -- untested against the real API from this route yet; confirm on the first live
  comment, not before.
- The exact APL join syntax in the skill's stalled-run query is written from APL's documented
  shape, not verified against a real query on the live `julia-next-journey0` dataset -- verify
  before trusting it as a monitoring step.
- `gate.checkName: 'checks'` in `graph/julia-next.project.mjs` names the CI job in
  `.github/workflows/ci.yml`; nothing in this route currently reads `gate` for `tracker: 'linear'`
  configs. Present for parity with the config shape, currently unused.
