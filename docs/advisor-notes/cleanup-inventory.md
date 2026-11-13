# Cleanup inventory (13 Nov 2026)

Leftovers from earlier attempts to reach the plan's end state: stock pstack on stock Mastra. Nothing here was deleted; each entry says what it is, why it looks dead, and the evidence that nothing uses it. Where something is still live or holds unpushed work, it says so.

Measured on the server (`/home/ubuntu`) with the repo at `origin/main` = `be39210` plus the stock-install branch.

Disk at the time of writing: 70 GB of 72 GB used, 1.8 GB free.

## 1. Clones of the same repo

Six checkouts of `github.com/toddwyder/julia-next` sit on the server. Services point at two of them, and only one clone can be the one main reaches.

| Clone | State | Who uses it |
| --- | --- | --- |
| `/home/ubuntu/julia-dashboard` | `main`, 12 local commits ahead of its stale `origin/main` ref, 2 files modified | `julia-dashboard.service`, `julia-dashboard-update.service`, `julia-dashboard-sweep.service` |
| `/home/ubuntu/julia-builder` | branch `jul-365-real-shipping`, `graphify-out/graph.json` modified | `julia-trace-fold.service` (`WorkingDirectory`), `julia-disk-check.service` |
| `/home/ubuntu/julia-mastra` | branch `feat/jul-290-account-status`, 63 behind / 18 ahead, 2 modified + 2 untracked (`scripts/linear-token.mjs`, `scripts/scratch-dir.mjs`) | The old `julia-dashboard.service` line (`ExecStart=…julia-mastra/scripts/julia-agents.mjs`), still present as a reset line above the live one |
| `/home/ubuntu/julia-flow-repo` | branch `jul-362-self-hosted-fonts` | nothing |
| `/home/ubuntu/julia-guard` | branch `feat/mastra-cost-guard` | nothing |
| `/home/ubuntu/verifications/linear-state` | `main`, 37 local commits ahead of an old `origin/main` ref | nothing; this session's scratch worktree lived beside it |

Why it matters: `julia-dashboard-update.service` is **failed** and has been for days. It fetches main, then runs `git -C /home/ubuntu/julia-dashboard checkout --detach be39210e`, which fails with "Your local changes to the following files would be overwritten by checkout" because `dashboard/scripts/watchdog.mjs` and `scripts/julia-agents.mjs` carry edits that are not on main. Those edits are not junk: the live service `ExecStart` runs `julia-dashboard/scripts/julia-agents.mjs`, and the edits add `--linear` to the vault wrapper plus an hourly notice retry. They are unpushed work that blocks every dashboard update.

Evidence: `systemctl status julia-dashboard-update.service` (failed, repeating), `git -C /home/ubuntu/julia-dashboard status --porcelain`, `git diff` in that clone.

## 2. Scratch folder

`~/.local/state/julia-scratch` holds 157 entries and **16 GB**.

| Prefix | Count | Notes |
| --- | --- | --- |
| `build-gate-*` | 36 | 11 Nov gate probes |
| `jul-*` / `JUL-*` | 17 | per-card checkouts |
| `remediation-loop-*` | 11 | remediation attempts |
| `shipping*` | 11 | 6.0 GB, the largest single tree |
| `studio-check-*`, `real-call-*`, `probe-*`, `playwright*`, browser caches | ~20 | probe output |

Largest: `shipping` 6.0 GB, `jul-358-shipping-20261110` 4.2 GB, `attributable-slice-costs` 2.2 GB, `jul-341-implementation` 555 MB, `verify-julia` 355 MB, `shared-card-dollar-proof` 253 MB.

Cleanup is supposed to happen: `~/.config/user-tmpfiles.d/julia-scratch.conf` has one line, `d /home/ubuntu/.local/state/julia-scratch 0700 - - amAM:3d`. Directories from 7 Nov are still there, so the age rule is not reclaiming anything — `amAM:3d` applies the age to the *directory entry*, and an old directory that is never modified keeps its original mtime, which should match, so the likely cause is that `systemd-tmpfiles-clean.timer` runs against `~/.config/user-tmpfiles.d` only for the user manager. Either way the evidence is the same: 16 GB that the rule meant to remove.

Evidence: `du -sxh ~/.local/state/julia-scratch`, `ls | wc -l`, the tmpfiles file, `systemctl --user list-timers`.

## 3. Files and folders directly in the home directory

| Path | What it is | Evidence nothing uses it |
| --- | --- | --- |
| `jul-335-spike/` | 5 Nov audit spike of `run.mjs` | one advisor handoff mentions it by name; no code reads it |
| `jul-336-review/` | 4 Nov review scratch | no repo reference |
| `jul-338-real-run-flow/` | 5 Nov run-flow scratch | no repo reference |
| `julia-uat-451/` | 7 Nov UAT checkout | no repo reference |
| `factory-experiment-REPORT.md` | 4 Nov report of the two-model factory experiment | no repo reference |
| `jul-340-studio-usage-handoff.md` | 5 Nov handoff note for the Studio usage card | no repo reference |
| `shape-scratch/` | 21 Oct scratch | no repo reference |
| `design-scratch/` | 7 Nov design scratch | no repo reference |
| `scratch/mastra-helper-probe/` | 6 Nov helper probe | no repo reference |
| `triage-drafts/` | 5 Nov triage drafts | no repo reference |
| `reports/`, `research/`, `docs/`, `dist/` | older working output (Oct–Nov) | no repo reference to these home paths |
| `worktrees/` | empty | — |

Evidence: `grep -rl <name>` over the repo (excluding `node_modules`, `.git`, `graphify-out`) finds only the handoff for `jul-335-spike`; every other name returns nothing.

## 4. Branches and open pull requests

Twelve branches besides `main` on `origin`, each with an open PR. None is merged.

| Branch | Last commit | PR | State |
| --- | --- | --- | --- |
| `jul-341-apothecary` | 7 Nov | #461 | green, mergeable, no review |
| `jul-342-helpers` | 8 Nov | #483 | hygiene fail, `CONFLICTING` |
| `jul-359-review-stops` | 9 Nov | #488 | checks fail, `CONFLICTING` |
| `toddwyder-patch-1` | 10 Nov | #493 | green, mergeable (docs: parking-lot idea) |
| `jul-362-self-hosted-fonts` | 12 Nov | #498 | green, mergeable |
| `jul-365-real-shipping` | 12 Nov | #500 | green except Vercel, mergeable |
| `spike/luna-runaway-proof` | 12 Nov | #507 | green |
| `spike/luna-studio-cost-proof` | 12 Nov | #508 | green |
| `spikes/agent-dollar-stop` | 12 Nov | #509 | green |
| `spikes/shared-card-dollar-proof` | 13 Nov | #510 | green |
| `spikes/deepseek-card-dollar-proof` | 13 Nov | #511 | retargeted from #510's branch to `main` today so the branch-coverage gate can see it |
| `chore/stock-mastracode` | 13 Nov | #512 | this session's work |

Two of these are abandoned in substance: #483 and #488 are `CONFLICTING` and were overtaken by main's move to stock agents and workflows (ADR 0026, 0027, 0028). The card PRs #461, #498 and #500 are green and simply unmerged. The spike branches are Todd's experiments and stay until he says otherwise.

Read the evidence: `gh pr list --state open`, `git for-each-ref refs/remotes/origin`.

Also stale: `scripts/check-branch-pr.mjs` treats only a PR whose base is `main` as covering its branch, so a stacked PR (as #511 was) makes every other PR in the repo fail the hygiene gate. Retargeting fixed it this time without a code change; the gate still cannot express a stack.

## 5. Generated output committed to git

| Path | Size | What it is |
| --- | --- | --- |
| `graphify-out/` | 14 MB, 3 tracked files | Graph output from the Graphify exploration gate. Committed because `machine/flow/exploration.mjs` writes there and the worktree is the only copy. Rewritten on every run, which is why `julia-builder` always shows a modified `graph.json`. |
| `dashboard/docs/scorecards/` | 11 MB, 2 card folders | Per-card verification folders with every artifact copied in (`jul-276/pr-2/verification.md`, `pr-3/…`) |
| `docs/agents/jul-*` | 8 folders, 3.3 MB total including the notes | Per-card decision records (`jul-310`, `jul-321`, `jul-322`, `jul-339`, `jul-340`, `jul-345`, `jul-358`, `jul-360`) |
| `docs/scorecards/` | 6 files, 28 KB | Cards that predate the dashboard's copy |

The Graphify gate itself is out of scope here (notes only, per this session's instruction); the committed output is the part that will not survive the end state, because the gate goes away with it.

## 6. Services and timers

| Unit | State | Note |
| --- | --- | --- |
| `julia-dashboard.service` | active | Runs the frozen dashboard from `julia-dashboard` through the vault wrapper |
| `julia-dashboard-update.service` | **failed**, every 5 minutes | Blocked by the uncommitted edits above |
| `julia-dashboard-watchdog.service` | active, every minute | Probes the dashboard |
| `julia-dashboard-sweep.service` / `.timer` | weekly, Monday 04:00 | The price sweep. Kept — its per-account model check is required by goal 1. |
| `julia-trace-fold.service` / `.timer` | daily, 00:00 | Folds the trace store into the archive. Kept. |
| `julia-disk-check.service` / `.timer` | daily, 00:00 | Kept. |
| `~/.config/systemd/user/julia-studio.service` | inactive | Studio launcher from the pre-dashboard setup |
| `~/.config/systemd/user/datasette-viewer.service` | inactive | A `datasette` process does run against `mastracode/mastra.db` on port 8801, started by hand rather than by this unit |

Evidence: `systemctl list-unit-files 'julia*'`, `systemctl --user list-unit-files`, `systemctl status julia-dashboard-update.service`, `ps aux | grep datasette`.

## 7. Root-owned dashboard state

`/var/lib/julia-dashboard` is **2.0 GB**, owned by `ubuntu` but outside the home directory, and holds:

- `state/runs/jul-290/` 1.3 GB, `state/runs/JUL-295/` 539 MB, `state/runs/jul-279/` 193 MB — full checkouts plus copies of ship traces from 31 Oct and 1 Nov
- `state/sweep-log.jsonl` (116 KB), `state/models.json` (44 KB), `state/runs/*.json`
- `preview-state/`, `preview-state-4314/`, empty `worktrees/`

`state/` is the live state folder (`dashboard/lib/state.js` defaults `DASHBOARD_STATE_DIR` to `/var/lib/julia-dashboard`), so the folder stays; the three run folders are from cards the dashboard will never show again. The trace files inside `JUL-295` are duplicated in the trace archive or never folded — worth one check before deleting.

Evidence: `sudo du -sh /var/lib/julia-dashboard/*`, `grep stateDir dashboard/lib/models.test.mjs`.

## 8. Installer and wrapper leftovers

| Path | What it is | Why it is dead |
| --- | --- | --- |
| `~/.local/bin/mastracode.before-launcher-1793396355246` | symlink to `/home/ubuntu/julia-mastra/scripts/mastracode` | dangling; the launcher no longer exists |
| `~/.local/bin/mastracode.before-launcher-1793462224351` | symlink to `/home/ubuntu/julia-builder/scripts/mastracode` | dangling |
| `~/.local/bin/mastracode.before-launcher-1793476785136` | symlink to `/var/lib/julia-dashboard/state/runs/JUL-298/checkout/scripts/mastracode` | dangling |
| `~/.local/bin/mastracode.before-launcher-1794094752831` | symlink to `/home/ubuntu/julia-builder/scripts/mastracode` | dangling |
| `~/.local/bin/cmd`, `cmdc`, `command-code`, `commandcode` | four names for one binary (`command-code`) | history; one is enough |
| `/usr/local/bin/codex`, `/usr/local/bin/command-code`, `/usr/local/bin/op`, `/usr/local/bin/rclone` | hand-placed binaries and symlinks | `command-code` duplicates `~/.local/bin/command-code`; the rest are personal tools rather than repo dependencies |

The `before-launcher-*` names come from `scripts/install-launcher.mjs`, which moved any file that was not its own link aside instead of deleting it. The installer is deleted in this branch; these are what it left behind. The old custom install `~/.local/lib/mastracode-program` and the root symlinks `/usr/local/bin/mastracode` and `/usr/local/bin/mastra-code` were removed during goal 1.

Evidence: `ls -l ~/.local/bin`, `ls -l /usr/local/bin`, `readlink` on each `before-launcher` name.

## 9. Code and tests that guard nothing

| Item | Evidence |
| --- | --- |
| `scripts/preview-domain.mjs` + `preview-domain.test.mjs` | The only importer is its own test; no document mentions it (`grep -rn "preview-domain"` finds only the two files). Added 27 Oct for preview sign-in (JUL-208, #360). Either document it or delete it. |
| `machine/flow/*` and `steps.mjs` still describe the pre-stock build stage | `docs/agents/machine-programs.md` fingerprints these files, so the list gate passes, but the plan replaces the flow with stock workflows. Not dead yet; dead once the stock workflow lands. |
| `dashboard/docs/scorecards/jul-276/` | Two verification folders with every artifact copied in, for a card closed in October; the dashboard is frozen |

Nothing else surfaced: every other `scripts/*.mjs` is imported by something or invoked by a unit, and every other test rides a real module.

Evidence: a loop over `scripts/*.mjs` and `dashboard/scripts/*.mjs` that greps the repo for each basename; `scripts/personal-paths.mjs` looked orphaned but is the scanner behind `scripts/no-personal-paths.test.mjs`, which is a live gate.

## 10. Docs that describe things that no longer exist

Historical notes (scorecards, retros, handoffs, `docs/agents/pstack-fresh-2026-10-25/proof.md`) keep their wording on purpose and are not listed here. The live docs that named the launcher or the custom install were updated in this branch: `AGENTS.md`, `.claude/skills/retro/SKILL.md`, `docs/harness/mastra-code.md`, `docs/agents/server-runbook.md`, `docs/pstack-deviations.md`, `machine/merge/README.md`, `machine/shipping/README.md`.

One live doc still points at the old world: `docs/agents/server-runbook.md` documents `julia-dashboard` as if it were current, while the plan freezes it. That belongs to the visibility step that comes after the machine works.

## What this does not cover

- `graphify-out` and the Graphify gate (notes only, per instruction)
- the prompt builder, helper instructions, retry and output-limit settings, model-specific settings, and the memory helper models (left to later plan pieces)
- an audit of the dashboard's own frozen code, beyond the scorecard copies above
