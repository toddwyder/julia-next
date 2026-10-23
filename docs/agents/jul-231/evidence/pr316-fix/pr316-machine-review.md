# Independent PR #316 machine review

Candidate `ae84d5d228fc425be086415e1a6a9fed09515c19`; diff `f259fbe..ae84d5d`. Annotation source and its deliberately broken proof fixture are excluded as separately assigned. Contract was recorded before source inspection in `/tmp/pr316-machine-review-contract.md`.

## Spec

FAIL for this pinned candidate.

1. `ops/build-runner/pstack-session.mjs:67` omits raw `events` from the inspection result, while `ops/build-runner/proof/start.mjs:128` requires `result.internalReview.events` to be an array. `worker.mjs` only spreads that inspection result. Consequently a fully successful model run still fails the final driver assertion. Reproduced with the pinned module copied from Git into `/tmp/pr316-pinned-session.mjs`; `/tmp/pr316-inspector-counterexamples.txt` records `proofDriverAssertion:false`. Return retained events consistently and test the worker/driver-facing contract. The parent has already changed this in its working tree; that later source is outside this pinned verdict.

2. `ops/build-runner/pstack-session.mjs:55-57` accepts the first distinct-model task matching review/audit/judge regardless of chronology or target. A DeepSeek architecture-plan review refused before coding, followed by Beam implementation with no code review, passes the inspection. Executed the same pinned-module probe and recorded `accepted:true` with task `Review architecture plan before coding`. Require evidence that the handoff reviews the completed build, and test that a design-only review before implementation cannot satisfy this criterion. This concerns evidence attribution, not a rule that tells pstack how to conduct its work.

Implemented source inspection supports neutral helpers for all three exact settings IDs, a saved-card/poteto-mode prompt, explicit unavailable Sol identity without invented pricing, and exact model tables. Actual pstack execution remains unverified: all retained drives in this pin are explicitly failed for missing checklist. Canceled-card evidence reports JUL-234 through JUL-238 Canceled. Service activation is correctly deferred to PR316's merge. Actual postmerge service readback cannot yet exist and remains unverified.

Retained service `evidence/pr316-fix/services/config.json` still contains the old `/` control health URL, inconsistent with the corrected `/julia-control` source README. Refresh the retained installed-config readback.

## Standards

1. Unit/regression tests: 29 focused tests passed for pstack, model settings, transport and service updater. Eight admission tests passed. Tests discriminate explicit model IDs, cap-probe versus review labels, unavailable provider dispatch, direct pushes versus merges, exact activation commit and failed-restart retry. The two proven counterexamples above expose missing discrimination at the composed worker/driver and completed-build review seams.
2. Integration boundaries: local real Git and local HTTP transport tests passed; provider, browser and postmerge systemd acceptance remain unverified for the final candidate. Fixtures are correctly labeled in retained service evidence.
3. End-to-end changed journey: unverified. Retained live Beam attempts are failed evidence, not acceptance. No pass inferred from unit tests.
4. Browser console: unverified pending the successful exact-candidate browser drive. Driver collects console/page/network results but manual review must reject unexplained failures.
5. Logging: retained requests, ledger, events, receipt, job state and failed-run errors identify operations and preserve useful diagnosis. The missing raw-event composed result is the concrete defect above. No credential values observed in inspected evidence.

No additional actionable service source defect found. Merge-gated main updater, first activation SHA, retry marker, process entrypoint/cgroup readback and removed-unit checks were inspected. Actual deployment remains pending, as explicitly documented.

## Executed checks

- `node --test ops/build-runner/test/pstack-session.test.mjs ops/build-runner/test/server-main.test.mjs ops/build-runner/test/machine-settings.test.mjs ops/build-runner/test/transport.test.mjs` -> 29 pass; output `/tmp/pr316-independent-focused.txt`.
- `node --test ops/mastra-agents/reviewer/test/card-admission-check.test.mjs` -> 8 pass; output `/tmp/pr316-independent-admission.txt`.
- Pinned-module `inspectPstackRun` counterexamples -> missing events and early design-review false positive; output `/tmp/pr316-inspector-counterexamples.txt`.
- Read-only absent-unit `systemctl --user show ... --property=LoadState --value` -> `not-found`, exit 0, confirming updater's removal readback command works on this host.

This is an independent check by a separate agent on the inherited model. It is not model-diverse review. No source, Git, service or tracker changes were made by this reviewer.
