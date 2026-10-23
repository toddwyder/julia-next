# JUL-251 structural test and maintenance follow-up

The Windows laptop-runner CI gate is retired under Todd's server-build decision. PR #314 remains open to main and must not be merged by this task. Spending remains $0.

## Test ownership

`scripts/test-owners.mjs` discovers tests from Git source identity. The nearest package manifest and lockfile own dependency installation. A `server` ancestor selects server execution. Browser specs run with their owner's Playwright executable and configuration; the repository config accepts sibling skill specs without another path entry. There are no per-test inclusion or exclusion lists.

The root and nested package tests run in Linux GitHub Actions after their owners' locked installs. Live-provider and server-key tests run on this ubuntu server through `scripts/julia-agents.mjs`. The server worker discovers open same-repository PR heads and main, checks out the exact SHA, installs discovered owners, and publishes the result and log on `refs/notes/julia-server-tests/<SHA>`. The Actions server-tests job reads that exact result using its checkout authentication. This route needs ordinary Git contents access, already available; the current GitHub token's status-write and runner-registration endpoints returned HTTP 403.

SDK learning tests now live under `ops/build-runner`, which owns SDK 1.14.0 and its lockfile. Live checks live in its server subtree. The missing-SDK adapter regression and offline credential/usage tests pass in [the original-failure replay](evidence/follow-up/ci-failure-replay-green.txt). The deleted verify-machine test is absent from the source and [execution plan](evidence/follow-up/test-owners-plan.json); its [original failure](evidence/follow-up/orphan-red.txt) and [removal replay](evidence/follow-up/orphan-test-replay.txt) are retained. Skill browser tests and the lifecycle helper live inside verify-julia. Its POSIX launch, doctor, browser and cleanup proof passed.

The server result protocol has passing and failing receipts tested end to end. An interrupted worker claim is recovered without starving later candidates. New local, nested-package, server and sibling browser tests execute without editing a list. Review found and corrected nested-browser dependency selection and interrupted-worker recovery. [Scoped review](follow-up-code-review.md) used fresh agents on the same inherited model, not a different-maker review.

## Maintenance after merge

An enabled user systemd timer on this ubuntu server polls main every minute. User lingering is enabled so it survives logout. It records an installation baseline, then examines newly gained first-parent commits and GitHub associated-PR metadata for ordinary, squash and rebase merges. A durable merge-SHA claim starts one fresh signed-in Codex coordinator, which runs maintain-verification-skill for each discovered verify-* skill with a feature map. Today the discovered project target is verify-julia.

Product source, Git metadata and sibling skills are read-only in the actual Bubblewrap namespace. Only target skill folders and disposable output are writable. The controller also validates source paths before publication. Clean creates no branch or PR. Changed requires live proof and opens one PR confined to the target skill folders. Blocked retains one line and delivers it on JUL-251 through the existing server credential wrapper and Linear CLI. A merge marker avoids repeated delivery, including recovery after an unknown successful response. A notifier failure is retried without relaunching maintenance. Maintenance never edits product code.

The [real merge replay](evidence/follow-up/maintenance-proof.json) used an actual local Git repository and a throwaway branch standing in for main. It copied the project's actual maintain-verification-skill unchanged and drove a one-feature CLI verification fixture. Baseline and no merge launched zero sessions. An ordinary direct commit launched zero. A true merge launched exactly one fresh coordinator and completed clean with live source and CLI evidence. A repeated poll launched zero. The namespace rejected product and sibling-skill writes with EROFS and allowed the target skill write. [Real session evidence](evidence/follow-up/maintenance-session/events.jsonl) is retained. This fixture proves the trigger, launch and scope; it does not claim to maintain Julia's full feature map. Julia's real lifecycle and browser proof are retained separately.

The [installed service readback](evidence/follow-up/maintenance-install.json) and [production no-merge readback](evidence/follow-up/maintenance-production-no-merge.json) show main's current baseline and no runs. Runtime state is under `/home/ubuntu/.local/state/julia-verification-maintenance`; installed source is under `/home/ubuntu/.local/share/julia-verification-maintenance`. Blocked reports stay beside each run's sessions and proof.

## CI

The authoritative result is PR #314's checks on its exact pushed head. This report and both proofs are committed before the final CI report. No merge is performed.
