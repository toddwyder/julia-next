# JUL-231 server Proof

[PR #316](https://github.com/toddwyder/julia-next/pull/316) is open to main. JUL-231 is in Code review. Todd decides the merge after the retro.

PASS. One real server run built JUL-232 through Start, using Beam for the saved orchestrator and coder roles. The run completed pstack Build, internal review and proof in one Mastra Code thread. The connection core refused the DeepSeek helper before upstream dispatch. Spend and held funds both read back as $0.

The tested source is `34fe127c55bfd2782b0d5ccc0a9e63f3c44c9a79`. The practice candidate is `000d85f121ac51a654e243a1f4cd01478ab8eb27`. Its base is the tested source commit. A [Git bundle](evidence/server-proof-20261023/candidate.bundle) retains the exact candidate commit. The source checkout was clean when Proof started. The recorded dirty digest is `01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b`.

| Required observation | Actual evidence |
| --- | --- |
| JUL-232 built from the saved card, models and worktree | [Saved and actual job](evidence/server-proof-20261023/report.json), [session receipt](evidence/server-proof-20261023/job-files/receipt.json) |
| Exact marker and clean candidate, with no unrelated change | [Marker file](evidence/server-proof-20261023/BUILD-PHASE-REHEARSAL.txt), report `git` fields. The file is exactly 36 bytes ending in byte 10. The sole changed path is `BUILD-PHASE-REHEARSAL.txt`. |
| Saved ready-for-review result survives reload | [Rendered page](evidence/server-proof-20261023/screenshot.png), [page readback](evidence/server-proof-20261023/page.txt), saved job result |
| Runner survives control-page restart | Report `processBefore`, `restart` and `processAfter`. Runner PID 398111 kept start tick 42940263. Worker PID 398170 was alive immediately after the restart and later completed normally. |
| DeepSeek refused with $0 spent | [Actual requests](evidence/server-proof-20261023/job-files/requests.jsonl), [durable ledger](evidence/server-proof-20261023/job-files/ledger.json), stock cap-check events |
| Downstream Review has not started | Saved result has `downstreamReviewStarted: false`; [Linear readback](evidence/server-proof-20261023/jul-252-after.json) shows JUL-252 in Backlog with `startedAt: null`. |

The marker content is exactly `Julia build-phase rehearsal passed.` followed by one newline. The Beam coder committed it. The Beam internal reviewer ran Git status, changed-file inspection, a hex dump and a literal Python byte comparison, then returned `REVIEW_AND_PROOF_PASSED`. The cap-check helper selected `commandcode-free/deepseek/deepseek-v4.1-flash` and returned `Trial forbids nonzero model prices`. There is no DeepSeek HTTP dispatch in the request trace.

The durable JUL-251 ledger ceiling remains unchanged. Its active trial policy refuses every nonzero-priced request, which enforces this run's $0 limit. Fourteen Beam HTTP requests succeeded. The ledger contains no nonzero spend or unresolved funds.

The machine's normal role split is in [pstack-models.md](../../../ops/build-runner/pstack-models.md). The machinery run seeded Beam overrides into its isolated runtime homes. Codex's own settings were not changed. The connection transport, ledger and command boundary match main.

The final focused checks passed 38 runner/accounting tests, 23 control/browser tests and 14 framework learning tests. Typechecking passed. [Build evidence](evidence/build-20261023/README.md) retains the logs and archived Beam provenance.

An initial driver locator timed out before Start. A subsequent real run exposed inaccessible linked-worktree Git data. A real command-boundary test reproduced that failure, then passed after the job checkout became a standalone clone. The final successful run above proves every item together. Earlier failed observations are retained under `setup-attempt-1` and `failed-run-1`; they are not acceptance evidence.

This report is a maker self-check with Beam review. It does not claim model-diverse independent review. Publishing ends at an open PR to main. Todd decides the merge after the retro.

Model the Domain shaped the persisted job states. Build the Lever produced the rerunnable server Proof driver. Prove It Works required the real Git, process, page and ledger readbacks above.
