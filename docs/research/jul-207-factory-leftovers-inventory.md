# JUL-207 Factory leftovers inventory

**Snapshot date:** 2026-10-09 (America/Los_Angeles)
**Phase:** 1--2 inventory and proposed disposition only. No cleanup was run.
**Scope:** this Windows laptop, the repository's GitHub records, and the former
OVHcloud environment only where a local record proves a Factory relationship.

## Result and decision boundary

This inventory deliberately retains every item below. The local evidence proves that
Factory is paused and retained; it does not prove that any artifact is safe to remove.
It is **incomplete**: the former OVHcloud host could not be inspected from this
session because the required read-only operator route is outside this workspace. Its
live state is therefore **unknown**, rather than inferred from an old runbook. That
evidence gap blocks completion of Phase 1 and all later cleanup decisions.

This report is a durable disposition record. It is not authority to change a
worktree, branch, issue, pull request, workflow, server resource, account, secret,
or billing setting.

## Evidence method

The evidence was collected read-only on 2026-10-09:

```text
git worktree list --porcelain
git -C <each worktree> status --porcelain
git -C <each worktree> rev-list --left-right --count origin/main...HEAD
git ls-remote --heads origin 'factory/*'
gh pr list --state open --limit 100
gh pr view 264
gh workflow list
gh issue view 144 --comments
gh api --paginate -X GET "/search/issues?q=repo%3Atoddwyder%2Fjulia-next%20Factory%20in%3Atitle%2Cbody&per_page=100"
```

The final command is the exact read-only GitHub search used for the 2026-10-09
snapshot. Its first response reported `total_count: 113`; `--paginate` was used
to retrieve all pages. GitHub search is mutable, so rerunning this query later
does not reproduce the 2026-10-09 count; the date and count are snapshot
evidence, not a claim about the current result set.

The [work-execution record](../agents/work-execution.md) and the
[root agent instructions](../../AGENTS.md) are the ownership evidence for the
retained paused route. The [server runbook](../agents/server-runbook.md) is
historical host-reference evidence only, not a live-state assertion. The local
checkout's latest commit touching the retained Factory area was
`164be44a818a84e5bf73089b9a03a0a9635fb223` on 2026-10-07T21:58:58-07:00.

## Inventory

| Artifact / location | Owner and state | Last activity / direct evidence | Relation to current Julia work | Proposed disposition | Risk / Todd decision |
| --- | --- | --- | --- | --- | --- |
| `ops/factory/` | Julia project; paused Factory code | Retention required by root `AGENTS.md` and `docs/agents/work-execution.md` | The retained historical route | Retain unchanged | High; separate explicit decision required |
| `scripts/publish-pr.mjs`, `scripts/merge-pr.mjs`, publisher App | Historical Factory infrastructure; inactive for Linear cards | Root `AGENTS.md` expressly retains and prohibits their use for Linear | Historical publication/merge evidence | Retain unchanged | High; separate explicit decision required |
| Factory server service and audit evidence | Factory-owned host resource; live state unknown | `docs/agents/server-runbook.md` names `julia-factory-trial.service`; it is documentation, not live proof | Retained paused route | Retain; request an authorized operator's read-only inventory | High; Todd/operator decision required before any host action |
| Former OVHcloud resources outside the retained service | Owner/state/last activity unknown | No authorized live read-back was available; do not probe secrets | Possible historical infrastructure only | Escalate as unknown; no classification or cleanup | High; authorized operator must supply evidence |
| `C:/Dev/julia-next` | Shared worktree; dirty | Branch `jul-197-comprehensive-ci-gate-cleanup`; four untracked files; `31 2` divergence from `origin/main` | Current Julia delivery work | Retain; do not clean, move, or delete | High; owner must decide |
| Eleven additional registered worktrees | Separate worktrees; clean at observation | `git worktree list`; individual evidence is in the ledger below | Active or ambiguous Julia work; names are not ownership proof | Retain and escalate for owner classification | High; no batch cleanup |
| GitHub branch `factory/issue-199` | Factory branch; present remotely | `git ls-remote --heads origin 'factory/*'` returned `6471145…` | Backs historical Factory PR #264 | Retain | Medium; Todd must approve any later branch action |
| GitHub PR [#264](https://github.com/toddwyder/julia-next/pull/264) | Closed, unmerged Factory PR | Closed 2026-10-09 18:38:38Z; head `factory/issue-199`; direct `gh pr view` evidence | Historical Factory implementation/evidence | Retain | Medium; no reopen/close/delete action |
| GitHub CI workflow | Active workflow | [`CI` workflow source](https://github.com/toddwyder/julia-next/blob/main/.github/workflows/ci.yml), id `359663840`, state `active` | Current GitHub CI record | Retain | High; active workflow is out of scope |
| GitHub issue [#144](https://github.com/toddwyder/julia-next/issues/144) | Historical Factory tracker record | Direct issue/comments state the previous graph-route retirement and retained Factory boundary | Historical evidence | Retain immutable record | Low; no change proposed |
| Factory-keyword GitHub search candidates | 113 records; ownership not established solely by the query | Read-only GitHub search returned 113 lexical matches | Some are current documentation or historical PR evidence; a keyword is not ownership proof | Retain; do not reclassify or mutate from search results | High false-positive risk; classify only after artifact-specific evidence |

### Local worktree ledger

`git worktree list`, `git status --porcelain`, and `git log -1` are direct
per-worktree evidence. The behind/ahead values below compare `origin/main...HEAD`;
they do **not** establish that a branch is pushed to its own upstream. Upstream,
lock, and owner state is therefore recorded as unknown unless independently proven.
A clean status is not proof that the worktree is retired; all are retained.

| Location / current branch | Owner; state | Last activity / evidence | Relation; disposition | Risk; Todd decision |
| --- | --- | --- | --- | --- |
| `C:/Dev/julia-next` / `jul-197-comprehensive-ci-gate-cleanup` | Owner unknown; dirty, unlocked/unpushed unknown | 4 untracked files; `git status --porcelain`; divergence 31/2 | Current/ambiguous Julia work; retain | High; yes |
| `C:/Dev/julia-next-211` / `fix/211-capture-entry-point` | Owner unknown; clean, lock/upstream unknown | `7168e86b`, 2026-10-06 07:08:45-07:00; divergence 68/10 | Ambiguous Julia work; retain | High; yes |
| `C:/Dev/julia-next-docs-route` / `docs/machine-card-ordinary-route` | Owner unknown; clean, lock/upstream unknown | `be851bf5`, 2026-10-06 06:46:41-07:00; divergence 69/1 | Ambiguous Julia work; retain | High; yes |
| `C:/Dev/julia-next-issue194` / `build/194-factory-review-stage` | Owner unknown; clean, lock/upstream unknown | `7c5f62ba`, 2026-10-05 23:49:12-07:00; divergence 70/2 | Possible Factory history; retain | High; yes |
| `C:/Dev/julia-next-issue194-codex` / `codex/194-factory-review-stage` | Owner unknown; clean, lock/upstream unknown | `295317b9`, 2026-10-05 05:30:44Z; divergence 83/0 | Possible Factory history; retain | High; yes |
| `C:/Dev/julia-next-issue199` / `build/199-web-push-device-signup` | Owner unknown; clean, lock/upstream unknown | `399cc2ac`, 2026-10-06 05:41:59-07:00; divergence 69/0 | Possible Factory history; retain | High; yes |
| `C:/Dev/julia-next-jul196` / `toddwyder/jul-196-runner-init-review` | Owner unknown; clean, lock/upstream unknown | `251736a4`, 2026-10-07 22:54:41-07:00; divergence 32/0 | Current runner work; retain | High; yes |
| `C:/Dev/julia-next-jul196-proof` / `proof/jul196-claude` | Owner unknown; clean, lock/upstream unknown | `ee5eb822`, 2026-10-08 08:37:10-07:00; divergence 25/0 | Current proof work; retain | High; yes |
| `C:/Dev/julia-next-jul207` / `toddwyder/jul-207-retire-factory-leftovers-and-reconcile-delivery-records` | Current JUL-207 builder; clean, lock/upstream unknown | `085f778f`, 2026-10-09 12:21:08-07:00; divergence 0/1 | This inventory's evidence worktree; retain | Medium; yes before any removal |
| `C:/Dev/julia-next-review-limit` / `fix/jul-202-two-review-attempts` | Owner unknown; clean, lock/upstream unknown | `82c6328e`, 2026-10-09 10:02:39-07:00; divergence 2/0 | Current delivery work; retain | High; yes |
| `C:/Dev/julia-next-review-publication` / `main` | Owner unknown; clean, lock/upstream unknown | `13c5cc2f`, 2026-10-09 11:14:32-07:00; divergence 0/0 | Current main checkout; retain | High; yes |
| `C:/Dev/julia-next-rules` / `docs/machine-card-rules` | Owner unknown; clean, lock/upstream unknown | `561fca49`, 2026-10-05 23:11:37-07:00; divergence 82/1 | Ambiguous Julia work; retain | High; yes |

## Historical-record reconciliation

Linear is the planning/status record for current cards; GitHub is the code, pull
request, and CI record; run files own execution state. No historical GitHub item
was rewritten, closed, linked, relabelled, or otherwise changed. The historical
Factory-specific facts are retained as references: #144 documents prior graph
retirement, #264 and `factory/issue-199` preserve a closed-but-unmerged Factory
attempt, and the active CI workflow is a current code-delivery dependency.

The 113-result lexical GitHub search is preserved as a *candidate set*, not a
Factory ownership classification. Treating those hits as a cleanup list would
violate the card's requirement that a Factory keyword is not ownership proof.

## Proposed Phase 3 actions (not executed)

### Batch A — authorized operator read-only capture

1. On the former OVHcloud host, record the exact host identity, enabled/active
   units, Factory checkout/build marker, disk/resource inventory, and references
   to the retained Factory service.
2. Record only names, statuses, timestamps, and paths; do not read secrets or
   change services.
3. Attach the sanitized output to this card/report and classify each host artifact
   as retained, ambiguous, or an explicit separate-decision candidate.

**Approval required:** Todd must designate the authorized operator/read-only
session. No server command is proposed here because the evidence boundary is not
yet satisfied.

### Batch B — worktree owner attestation

1. Ask the owner of each dirty, locked, unpushed, or ambiguous worktree to record
   its current card/PR/run relationship.
2. Add the owner decision to this report; retain every worktree without that
   direct evidence.

**Approval required:** each worktree owner/Todd. No `git worktree remove`, branch
deletion, reset, clean, or move is proposed.

### Batch C — GitHub historical record linkage

1. From direct PR/issue/workflow evidence, create a read-only mapping of actual
   Factory-owned records; exclude keyword-only hits.
2. Preserve links and classify closed records as historical evidence unless Todd
   separately approves a reversible archival action.

**Approval required:** Todd before any external-record change. No Phase 3 action
was executed.

## Retained exceptions, owners, and next decision

The retained exceptions are the paused Factory code, its server service, publisher
App, publication scripts, historical route, and required audit evidence. Their
owner is the Julia delivery/operator boundary described in root `AGENTS.md`.
Remaining leftovers are the unclassified former-OVH resources, the shared dirty
checkout, the eleven separately classified non-primary worktrees, the retained
Factory branch/PR, and the keyword-only GitHub candidate set.

**Next decision:** designate an authorized operator for the former-OVH read-only
inventory and name the owners of the ambiguous worktrees. Until then, retain all
artifacts and execute no cleanup.
