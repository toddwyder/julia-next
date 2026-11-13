# Cleanup inventory (13 Nov 2026)

Leftovers from earlier attempts to reach the plan's end state: stock pstack on stock Mastra. This is
the record of the sweep: what was on the server, what was removed, and what stays with the reason
for each. It replaces the first pass of this note, which listed candidates and called two running
units "inactive"; the corrections are marked below.

Measured on the server (`/home/ubuntu`) with the repo at `origin/main` = `be39210` plus this branch.

Disk went from 70 GB of 72 GB used (1.8 GB free) to 39 GB used (34 GB free).

## Never delete these

| Path | Why |
| --- | --- |
| `/tmp/mc` | Mastra Code's own folder. It holds one directory per user with the cross-process sockets of every session, including the lease socket that says which process owns a thread. A cleanup on 13 November removed it, and every run in progress aborted with `Processor "observational-memory" stopped the run: Agent execution was aborted` — a message about memory that was really about a missing socket. `/etc/tmpfiles.d/mastracode.conf` (`x /tmp/mc - - - -`) excludes it from the stock 30-day rule and the boot pass; the repo keeps that file as `scripts/server/mastracode-tmpfiles.conf`. No script of ours may remove it either: an idle folder is safe, a running session's folder is not. |
| `/tmp/codex-daemon-1000`, `/tmp/tmux-1000` | Sockets of running tools; the same rule applies. |

## 1. Clones of the same repo

Four of the six checkouts are gone; what is left is one per job.

| Clone | State | Why it stays |
| --- | --- | --- |
| `/home/ubuntu/julia-flow-repo` | branch `jul-362-self-hosted-fonts` (PR #498) | The operator checkout: where agents edit code. It goes back to `main` between cards. |
| `/home/ubuntu/julia-dashboard` | worktree of `julia-mastra`, detached at `8da32d3`, 2 files modified | **Frozen.** `julia-dashboard.service` runs it and the update timer holds it at that commit. The two modified files (`dashboard/scripts/watchdog.mjs`, `scripts/julia-agents.mjs`) are what the live service runs; their content is identical to `origin/main`, so the update timer cannot move the checkout while they sit there. Left exactly as found. |
| `/home/ubuntu/julia-mastra` | `main` (recreated this run) | Only because the frozen dashboard is a worktree of it and its `scripts/julia-agents.mjs` is the vault wrapper in the live unit. The clone it replaces carried a local `feat/jul-290-account-status` with 18 commits that existed on no remote (PRs #424 and #383 closed, work superseded); those commits and two untracked helper scripts went with it. |
| `/home/ubuntu/julia-builder` | branch `jul-365-real-shipping` (PR #500) | `julia-studio.service` runs Studio from it on port 4111. |

Removed: `julia-guard` (worktree of `julia-builder`; its work reached `main` through PR #497),
`verifications/linear-state` (worktree of `julia-mastra`, clean and level with `main`), and four
prunable worktrees under `verifications/jul-276/` plus `~/.local/state/julia-scratch/ovh-model-budget`
and `/tmp/stockwt`.

The first pass read `julia-mastra` as idle because a reset line in the unit named it. It was not
idle: the live `ExecStart` runs its wrapper, and `julia-dashboard` was its worktree. Both are back.

## 2. Scratch folder

`~/.local/state/julia-scratch` held 157 entries and **16 GB**; it holds 2 entries and 35 MB, which
are this session's worktree and 1Password's socket directory. The tmpfiles rule
(`d … 0700 - - mM:3d`, idle for three days) never took anything, because the deadlines belong to the
directories and a busy day touched them; the entries removed were reached by hand.

## 3. Files and folders directly in the home directory

All gone: `jul-335-spike/`, `jul-336-review/`, `jul-338-real-run-flow/`, `julia-uat-451/`,
`factory-experiment-REPORT.md`, `jul-340-studio-usage-handoff.md`, `shape-scratch/`,
`design-scratch/`, `scratch/mastra-helper-probe/`, `triage-drafts/`, `reports/`, `research/`,
`docs/`, empty `worktrees/`. `dist/` stays: it is a build output of the operator checkout.

## 4. Branches and open pull requests

Twelve branches besides `main` carry an open PR, none merged. Two were abandoned in substance and
are closed with a reason: #483 `jul-342-helpers` and #488 `jul-359-review-stops` — both
`CONFLICTING`, both overtaken by `main` moving to stock agents and workflows (ADR 0026–0028).

| Branch | PR | State |
| --- | --- | --- |
| `jul-341-apothecary` | #461 | green, no review |
| `toddwyder-patch-1` | #493 | docs: a parking-lot idea |
| `jul-362-self-hosted-fonts` | #498 | green. Matters beyond its card: `web` fails whenever `next/font/google` cannot reach Google |
| `jul-365-real-shipping` | #500 | green except Vercel |
| `spike/luna-runaway-proof` … `spikes/deepseek-card-dollar-proof` | #507, #508, #509, #510, #511 | Todd's spikes; they stay |
| `chore/stock-mastracode` | #512 | this branch |

`scripts/check-branch-pr.mjs` counts a PR only when its base is `main`, so a stacked PR makes every
other PR fail the hygiene gate. Retargeting #511 fixed it this time with no code change; the gate
still cannot express a stack.

## 5. Generated output committed to git

Removed on this branch, 96 files and 11 MB:

| Path | What it was |
| --- | --- |
| `docs/agents/jul-*` (8 folders, 36 files, 3.3 MB) | Per-card decision logs and proofs. The retros and audits that cite them keep their wording; the removed files are readable from git history (`git show <commit>:<path>`). |
| `dashboard/docs/scorecards/` (54 files, 11 MB) | Card verification folders copied into the dashboard tree, including a 2 MB screen recording, for a card closed in October |
| `docs/scorecards/` (6 files, 28 KB) | Landing records from cards that predate the dashboard copy. `machine/merge/land.mjs` recreates the folder when it lands a card. |
| `scripts/preview-domain.mjs` + its test | Added 27 Oct for preview sign-in (JUL-208); its own test was the only importer |

`graphify-out/` (14 MB) stays. The Graphify gate writes it on every run and reads it; it goes with
the gate, which is out of scope here.

## 6. Services and timers

The first pass listed `julia-studio.service` and `datasette-viewer.service` as inactive. Both are
active and enabled, and both serve a port, so neither was touched.

| Unit | State | Note |
| --- | --- | --- |
| `julia-dashboard.service` | active | The frozen dashboard, through the vault wrapper in `julia-mastra` |
| `julia-dashboard-update.service` / `.timer` | every 5 minutes | Fetches `main`; the checkout stays at `8da32d3` because of the two modified files, which is the frozen state |
| `julia-dashboard-watchdog.service` / `.timer` | every minute | Probes the dashboard and tells Todd through JUL-276 |
| `julia-dashboard-sweep.service` / `.timer` | weekly, Monday 04:00 | The per-account model check, required by goal 1 |
| `julia-trace-fold.service` / `.timer` | daily, 00:00 | `WorkingDirectory` moved off `julia-builder` (below) |
| `julia-disk-check.service` / `.timer` | daily, 00:00 | `WorkingDirectory` moved off `julia-builder`; alerts Todd on JUL-185 below 10 GB free |
| `julia-studio.service` (user) | active, port 4111 | Studio, run from `julia-builder` |
| `datasette-viewer.service` (user) | active, port 8801 | Reads `mastracode/mastra.db` |

Trace-fold and disk-check no longer run from `julia-builder`, a card branch that will be deleted
when Studio moves. They now run from a checkout that follows `main`, which is also the reason
`scripts/trace-store.mjs` resolves DuckDB from the installed program: the checkout it runs in is not
the one with `node_modules`.

## 7. Root-owned dashboard state

`/var/lib/julia-dashboard` was 2.0 GB and is 292 KB. The three run folders (`jul-290` 1.3 GB,
`JUL-295` 539 MB, `jul-279` 193 MB) held full checkouts and copies of ship traces for cards the
dashboard will never show again. `state/` itself stays: the dashboard reads its state from there.

## 8. Installer and wrapper leftovers

- Four dangling `~/.local/bin/mastracode.before-launcher-*` symlinks from the deleted launcher: gone.
  `scripts/install-launcher.mjs`, which moved files aside instead of replacing them, is deleted on
  this branch.
- `cmd`, `cmdc`, `commandcode`: removed. `command-code` is the name the live Studio launcher uses
  (`~/bin/julia-builder`), so it stays.
- `/usr/local/bin/command-code` (an older 1.72.3, shadowed by `~/.local/bin`): removed.
- `/usr/local/bin/mastracode` was missing while the shell had it hashed, so `mastracode` failed from
  a terminal with `-bash: /usr/local/bin/mastracode: No such file or directory`. The standard
  install (`npm install -g mastracode`, prefix `~/.local`) is what should start it, and
  `/usr/local/bin/mastracode` now points there so an old hashed path resolves too.

## 9. Code and tests that guard nothing

`scripts/preview-domain.mjs` and its test are deleted. `dashboard/docs/scorecards/jul-276/` is
deleted; `dashboard/scripts/lanes.mjs` recreates its screenshot directory when it runs.

`machine/flow/*` and `steps.mjs` still describe the pre-stock build stage. `docs/agents/machine-programs.md`
fingerprints them, so the list gate passes, and the plan replaces the flow with stock workflows: not
dead yet.

Nothing else surfaced: every other `scripts/*.mjs` is imported by something or invoked by a unit, and
every other test rides a real module.

## 10. Docs

The live docs that named the launcher or the custom install were updated on this branch: `AGENTS.md`,
`.claude/skills/retro/SKILL.md`, `docs/harness/mastra-code.md`, `docs/agents/server-runbook.md`,
`docs/pstack-deviations.md`, `machine/merge/README.md`, `machine/shipping/README.md`. The runbook
also now records why `/tmp/mc` is kept and how to reinstall its tmpfiles rule.

Historical notes (retros, audits, handoffs) keep their wording, including the links to the per-card
folders that left the tree.

## Closed as "left as is"

- **Load `@mastra/code-sdk` from the repo's own dependencies** (replacing the SDK path in
  `dashboard/scripts/sweep.mjs` and the `MASTRACODE_SDK_PATH` line in `/etc/julia-dashboard.env`):
  the dashboard is frozen, so its code, its checkout and its env file were left as they were,
  including the bridge line that lets the sweep load the SDK from the installed program.

## What this does not cover

- `graphify-out` and the Graphify gate (notes only, as instructed)
- the prompt builder, helper instructions, retry and output-limit settings, model-specific settings,
  and the memory helper models
- an audit of the dashboard's own frozen code
