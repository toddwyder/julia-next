# Issue #148 — Tell Todd when Factory is waiting on him

## Goal

Ship the existing read-only Factory wait watcher in PR #150 through Factory review, then keep #148 open until normal use shows that one genuinely new session question or plan review reaches Todd's phone and Windows desktop once, with a working link, within five minutes. Respect Todd's September 28 direction: no staged proof run to manufacture a wait; a defect found during normal use becomes a small fix card. This plan supersedes the earlier retrospective record; the watcher was installed before its first review and this plan does not claim advance approval.

## Scope

- In: PR #150 at the reviewed head; pending `ask_user` questions, `submit_plan` reviews, unresolved supervisor findings, and Work/Triage cards labeled `status: needs approval`; stable one-attempt-per-wait delivery through ntfy; installer, one-minute timer, restricted database role, exception entry, and change log already in the branch.
- Out: Intake automation suggestions, other decisions and mentions; Factory state changes; custom retries for uncertain ntfy sends; a staged new session/question solely to prove the watcher; closing #148 before the outstanding normal-use criterion is observed.
- Existing tools checked: Factory's session questions/plans and attention state expose waits, but Factory 0.17.2 does not push them to both devices. The approved, removable exception and Mastra feature request #25378 are in `ops/factory/README.md:8-11`; no new custom service or framework change is proposed. Framework map was posted on #148 and is retained below.

## Framework map

| Need | Existing feature or gap | Official reference |
| --- | --- | --- |
| Identify human pauses | Factory session questions, plan approvals and Work item stage/approval status | [Factory guide](https://factory.mastra.ai/) |
| Represent a pending answer or plan | Mastra built-in `ask_user` and `submit_plan` suspended tool calls | [Mastra built-in tools](https://mastra.ai/blog/introducing-built-in-tools) |
| Deliver to phone and Windows | Factory 0.17.2 lacks these push alerts; approved exception uses ntfy publish and desktop/PWA subscriptions | [ntfy publish](https://docs.ntfy.sh/publish/), [ntfy PWA](https://docs.ntfy.sh/subscribe/pwa/) |

## Phases

### 1. Verify the existing branch without expanding the feature

- Changes: compare #148 acceptance criteria and Todd's corrected exclusions with PR #150's current head. Inspect `ops/factory/wait-alerts.sql`, `wait-alerts.py`, `install-wait-alerts.sh`, `install.sh`, service/timer, exception list and change log. Do not reinstall or trigger an artificial wait. Record that #149 was closed due to authorship and #150 is the publisher-authored replacement. Confirm the reviewer-requested live criterion is still open, rather than interpreting the PostgreSQL fixture or the earlier #139 Triage alert as proof.
- Tests: run `python3 -B ops/factory/wait-alerts.test.py -v`, `node --test ops/factory/install.test.mjs ops/factory/skills.test.mjs ops/factory/workflows.test.mjs`, `bash -n ops/factory/install.sh ops/factory/install-wait-alerts.sh`, and `npm run lint:framework`. Run `python3 -B ops/factory/wait-alerts.sql.test.py julia_factory_trial` only where PostgreSQL is available; document an unavailable database as a verification limit, not a passing result. Run TypeScript check/build if repository tooling is installed; do not claim they passed in this sandbox without running them.
- Verification: attach command results and head SHA to PR #150 review context. Do not overwrite the documented live-before-review breach or expose the private ntfy topic.

### 2. Resolve review and merge at the reviewed head

- Changes: reconcile PR #150's request for a staged new wait with Todd's explicit no-staged-proof decision. Seek a Factory review of the current head that evaluates the code and existing tests under that decision; do not silently mark the outstanding live check passed. Address any actionable code finding in the same PR with a new failing behavior test first, minimal code second, and a fresh full-suite run. Obtain an approved Factory verdict on that exact head before publisher-App merge; do not self-approve or bypass the review gate.
- Tests: use the SQL integration seam for a wait-selection defect and the watcher CLI/delivery seam for a deduplication or publish defect (see below); rerun Phase 1 checks on any changed head.
- Verification: record verdict and SHA. If approval remains blocked on pre-merge live proof, stop at that gate and ask Todd to resolve the review-policy conflict; do not create a staged session or merge anyway.

### 3. Observe normal use and close only when acceptance holds

- Changes: leave the installed one-minute timer running. When a *naturally occurring* new `ask_user` or `submit_plan` wait arises, record event time and wait identity; compare read-only query/dry-run output, timer journal and ledger status, and ask Todd whether exactly one alert arrived on each subscribed device within five minutes and opened the intended session. Observe the next timer cycle to establish no duplicate. Never include private topic, secret config or question content in public evidence.
- Tests: that observation is the remaining end-to-end acceptance check, not a synthetic fixture. If it fails, keep #148 open, diagnose and file a small fix card with the failing public-boundary test; do not retroactively call the old #139 Triage notification sufficient.
- Verification: document evidence on #148 and close only after both-device link and repeat-cycle behavior are confirmed. If the first real opportunity has not occurred, report it as pending rather than scheduling artificial proof.

## Seams and tests

- SQL read boundary: `ops/factory/wait-alerts.sql:1-61`, called by `wait-alerts.py:36-51`; `ops/factory/wait-alerts.sql.test.py:14-88` executes that exact query against isolated temporary PostgreSQL tables. The existing fixture independently expects two specified wait keys/details/paths and excludes completed, archived and unrelated calls; it does not prove a real Factory row shape or delivery to devices. For any new selection fix, agree this existing seam before writing a **new behavior test first**, show it failing against unchanged production code, make the smallest SQL change, then run the integration test and full suite. Do not claim the retrospective fixture was developed red-first.
- Delivery boundary: the `wait-alerts.py` CLI with a controlled config/state/HTTP endpoint as exercised in `ops/factory/wait-alerts.test.py`; assertions cover one delivery, no retry of an uncertain send, stable identity migration and card link. For a delivery defect, add one observable behavior test at this boundary, show red, implement minimal green, rerun the whole suite. The SQLite ledger is evidence for operations, not a substitute for checking the user-visible alert.
- Deployment boundary: `ops/factory/install.sh` staged artifacts through `ops/factory/install.test.mjs`, plus `bash -n` of install scripts and a service/timer review. No new test seam or code change is needed merely to repeat existing verification.

## Observability

Keep the existing service journal (cycle results/errors), one-minute timer status, operator `--dry-run` for eligible waits, and private SQLite ledger (`wait_key`, timestamp, `attempted`/`sent`, link). Record timing and counts for the first naturally occurring new question/plan and its next cycle in #148/change log without private ntfy topic or personal question text. An `attempted` entry after an uncertain network result must remain non-retryable pending operator inspection, preserving the no-duplicate guarantee.

## Risks

- Factory's real session message/receipt schema may differ from the isolated fixture; the remaining live criterion detects this without inventing a staging test.
- An ntfy timeout after delivery leaves `attempted`: this prioritizes no repeats over guaranteed delivery; do not reset ledger keys to force a send.
- The reviewer currently asks for pre-merge live proof while Todd forbids staged proof. Neither synthetic tests nor earlier Triage delivery resolve that policy conflict; an approved review verdict is mandatory to merge.
- PostgreSQL is unavailable in the current sandbox, so the SQL regression can be independently rerun only in an environment with PostgreSQL. The previous server-side pass is an author report, not local proof.

## Assumptions

- Todd's September 28 no-staged-proof direction governs the acceptance strategy; he will confirm receipt and link during normal use.
- The installed watcher stays active while PR #150 is reviewed, as already recorded in the change log; no further privileged install is required for this planning pass.
- PR #150 remains open and issue #148 remains open until the actual new question/plan criterion is met. A new review or head change must be checked again before merging.

## Open questions

- If Factory reviewers will not approve PR #150 without a manufactured pre-merge wait, Todd must decide whether to revise the review requirement or explicitly allow that staged exercise. Default: do not stage it and do not bypass approval.
