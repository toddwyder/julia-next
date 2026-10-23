# JUL-231 Read-Only Beam Audit

## Assurance
- This is a same-family Beam audit, not model-diverse independent review.
- Finish condition is an open PR to `main` with no merge; the PR is not open yet, so the card is not finished.

## Verified Against Supplied Run Evidence
- Final run reports `pass: true`.
- Candidate is clean and contains only `BUILD-PHASE-REHEARSAL.txt`.
- Marker content exactly matches `Julia build-phase rehearsal passed.\n` at 36 bytes.
- DeepSeek helper request was refused; spent/hold costs are `0`.
- Runner PID/start time remained unchanged across the control-page restart.
- `JUL-252` remains `Backlog`, not started.

## Material Flags / Evidence Gaps
1. **Open PR outstanding:** implementation verification exists, but the required final deliverable, an open PR to `main`, is not yet done.
2. **Source-review claim is stale:** the earlier “no findings” review was followed by lead-added internal-review success handling and standalone Git checkout repair; the supplied evidence does not show a final source review after those changes.
3. **Screenshot not in supplied evidence:** `pageSavedResult` is only a boolean; the saved ready-for-review screenshot with matching IDs is lead-attested, not included in the supplied artifacts.
4. **Saved selections/settings not directly evidenced:** the run summary shows runtime helper model IDs but does not include the saved control selections or machine pstack settings artifacts for criteria 2 and 3.
5. **Worker restart identity not captured:** `workerReadbackAfterRestart` is `null`, so worker identity after restart is not evidenced even though runner identity is.
6. **Final test counts not evidenced:** the ledger references baseline/init logs but does not include final logs supporting `38 core/jobs + 23 control/browser + 14 learning` and typecheck.
7. **Role attribution is uniform:** all account requests are role `orchestrator`, so coder/reviewer model usage is not independently role-attributed in the supplied ledger.

## Conclusion
The final run satisfies the core proof checks shown in the supplied evidence, but completion should not be claimed until the PR is opened and the above evidence gaps are closed or explicitly accepted.

## Lead resolution after the full artifacts were checked

1. PR creation is the next publication step. Its URL is recorded in report.md once created.
2. Final source review after the Git and verdict repairs returned no findings. See final-source-review.md. No implementation changed after the successful Proof.
3. The screenshot exists at evidence/server-proof-20261023/screenshot.png and was opened by the lead. The actual DOM is page.txt. Both show the persisted candidate and Beam models.
4. The full report initialJob.snapshot.roles and saved settings.json retain the selections. The normal machine split is ops/build-runner/pstack-models.md; the actual runtime table is in finalJob.result.internalReview.effectiveModels.
5. workerReadbackAfterRestart is only used if the worker exits during the check. Here workerAliveAfterRestart is true, and the driver directly asserted the same worker starttime. The runner's literal before/after PID and starttime are retained, which satisfies the card's restart item.
6. Final logs are git-boundary-green.log, integration-tests.log, learning-tests.log and integration-typecheck.log in the build evidence directory.
7. The core ledger retains the shared host role label. Stock subagent_start events independently name coder/reviewer and their actual model IDs. The actual request observer confirms Beam dispatches and the DeepSeek refusal.

No unresolved evidence gap remains for the card's Proof. This remains a same-family Beam audit with lead self-checks.
