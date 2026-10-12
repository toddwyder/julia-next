# Mastra builder and reviewer agents: settled design and parked items

As of Mon 12 Oct 2026. This file is the source of truth for the Mastra agents except where JUL-223's 12 Oct card decisions supersede older text. Mastra docs findings behind the 11 Oct changes: `claude/mastra-memory-research.md`.

## Where things stand
- Spike (closed PR #286) proved a Mastra agent on DeepSeek 4.1 Flash via CommandCode can use read-only tools and return a strict structured review in one run. Spike verdict on PR #282: PASS, 16 of 16 quotes verified.
- Real reviewer is in PR #287 (open). Six live attempts on 10-11 Oct were reported as reviewer-identity mismatches because the runner validated a missing observed identity before considering the worker's nonzero exit. Retained evidence separates three millisecond-scale preflight failures from three 79–139 second paid executions with storage/shutdown errors. The runner now reports nonzero worker exits as the primary failure and validates identity only for an exit-zero worker; an exit-zero missing or mismatched identity still fails closed. Earlier failures also exposed end-of-run database cleanup and missing-internal-span defects; those have regression coverage. The first 11 Oct proof attempt then showed that the AI SDK's OpenAI-compatible response schema removes CommandCode's non-standard `usage.cost` field before its metadata extractor runs. The provider transport now validates and retains raw response token usage before schema normalization, keyed by response ID, and fails closed when required token counts are missing or invalid.
- Spend limit: $1.00 cumulative for JUL-223 and $0.50 for its one authorized PR #287 review. There is no retry after any #287 outcome and no #282 rerun under this card. Offline and trust-check work makes no JUL-223 provider call unless its later stage explicitly authorizes one.
- PR #284's direct laptop transport was superseded by this reset and closed on 12 Oct. OVH VPS cancellation remains a later retirement step after the new reviewer is proven.
- 1Password: Julia-vault-only read_items service account, token DPAPI-protected on the laptop, unattended. Expires 6 Jan 2027 Pacific.

## 11 Oct design, corrected by the 12 Oct decisions
- Two Mastra agents, builder and reviewer, called as steps by the existing delivery runner. The runner owns sequence, saved state, lock, kill-orphan-workers and authorization checks.
- Look it up, don't recall it: use version-matched documentation bundled with each installed package first; otherwise use the tool's official `llms.txt` index and fetch only the applicable individual page, never `llms-full.txt`. The Mastra docs MCP server is a fallback only. Every framework-map job cites the exact page used. Custom code is allowed only after the applicable docs show the stock tool has no feature for the need, and the report records the gap.
- Models from the per-card configuration (JUL-195). Default: CommandCode `deepseek/deepseek-v4.1-flash`. Reviewer must be a different maker from the builder.
- Instructions: reviewer = `.agents/skills/adversarial-review/SKILL.md` plus CODING_STANDARDS.md plus the six fixed standing rules below. The rules are ordinary fixed instructions, not working memory. Executable `julia-builder` references were removed with the retired graph controller; one immutable historical transcript still contains the old path.
- **No reviewer memory.** The six standing rules are fixed instructions. There is no persisted message history, working memory, semantic recall, LibSQL vector store or FastEmbed. A later learning-memory proposal has the separate return signal in the reset table; a read-only rules store never qualifies.
- Nothing from one review is injected into another. Per-run raw responses, accepted pieces, model events and the final PASS, FAIL or INCONCLUSIVE verdict remain durable evidence for that run; INCONCLUSIVE parks unchanged rather than becoming memory for a later review.
- Tools: builder reads, writes, commits to its own branch, runs tests; reviewer is read-only and points at the commit. Neither merges, creates tickets or deletes.
- The reviewer records its report as small validated tool calls; repository code assembles the unchanged runner envelope and verdict. The builder hand-off remains parked for a separate step. The schema permits exactly the immutable changed-file inventory in `filesReviewed` and the per-file results; the caller independently repeats the exact-set check. Quote check stays (every quote word for word in the named file or diff at that commit). At the JSON-source boundary only, actual tab/newline/carriage-return characters are losslessly rewritten to their escaped spelling if and only if that spelling occurs exactly in the named serialized source; each such repair is retained with the verdict.
- **Verdict first:** the provider transport durably saves every exact raw model response, tied to the run ID and candidate commit, before Mastra parses its tool call; the last response remains at that path. Malformed tool JSON or schema input is returned to the model for correction and is never a verdict. Every accepted piece refreshes a durable technical-failure sidecar naming all accepted keys, so even an uncatchable process kill retains both progress and its incomplete status. A schema-valid assembled submission then becomes the model's PASS, FAIL, or INCONCLUSIVE verdict exactly as returned and removes the sidecar. No quote check, memory task, shutdown step, or interruption may lose or replace the saved raw response or a validated verdict.
- **End of run order:** save the raw response before parsing, durably record each accepted piece, save the validated verdict, then close the per-run journal. There is no memory settlement, observability flush or shared storage shutdown.
- Guards: deterministic Unicode normalization, immutable read tools and fixed candidate-as-data instructions. The paid warn-only classifier is deleted.
- **Storage:** no DuckDB, LibSQL, Mastra storage exporter or custom per-method adapter. The run folder holds one provider-boundary model-event journal, raw responses, accepted pieces, usage and terminal state within the 64 MiB evidence budget.
- **Tracing:** no internal or model-span export. The provider-boundary journal records each prompt, reply, tool call and validated usage record once.
- **Retention:** there is no shared trace or memory database and no pruning schedule. Run-folder evidence follows the runner's ordinary run-file lifecycle; stage-one proof artifacts and the failed-run backup were deleted.
- **Permanent run summary:** the runner's terminal event records card, candidate, round, verdict or stop reason, reviewer identity, effort, validated token usage, priced estimate and start/end time. It does not report memory or observability database sizes because neither database exists.
- **Cost:** paid execution stays disabled in stage one. A later offline stage must prove the preconfigured per-run hard ledger before a paid call can resume; provider token usage and the checked CommandCode rates feed that ledger without DuckDB, `TokenCostControl` or machine-wide usage reconciliation.
- No human-in-the-loop in builder or reviewer. Anything needing Todd parks the card with a visible reason.
- Park visibility: post one safe, idempotent line to the Linear card after local state is saved.
- Scorers: passive recorder only. Model choice by an escalation ladder, authorized up front on the card. The runner terminal event and per-run provider journal are the run ledger; there is no stock permanent-summary log.
- Delivery order for this machine card is independent review, green CI and Todd's technical acceptance of the evidence packet, then merge. Household UAT is not applicable. Reviewers and automated runners never merge.
- No arbitrary caps. The 12 Oct reset removed the older minimal runner's 130,000-byte refusal and deleted the old controller that carried the 5-failure/500-character trimming.

## Reviewer acceptance evidence (12 Oct reset)
Three pieces, retrieved and explained in plain English with where each came from:
1. The per-run provider journal: what the reviewer read, each prompt/reply/tool call, validated usage and the priced estimate.
2. Fixed instructions: all six standing rules are present without a memory database, and immutable read tools keep candidate content as data.
3. Recorder behavior: the real local `Agent.generate()` path corrects malformed tool input, durably records accepted pieces and submits the current report contract.

The full offline suite proves these pieces without a provider call. A later authorized model must pass the opt-in recorder probe before it can enter the loop; the one paid #287 review remains disabled until every offline gate, including the hard ledger, passes.

## JUL-223 step 4: durable small-piece report recording

The generic recording engine takes a final report schema, a piece schema,
per-piece checks, required piece keys, an assembler and a submit callback. It
provides Mastra tools to record a new piece, replace or remove one, show accepted
and missing keys, and submit. Each accepted piece is fsynced and atomically
renamed into the run folder immediately. Rejections use Mastra's
`{"error":true,"message":"..."}` shape with a correction the model can make.
Submit assembles in repository code, validates the existing `envelopeFor(input)`
schema and `checkedReview` completeness rules, and writes today's verdict shape.
The reviewer adapter supplies only reviewer schemas and checks; the engine has no
reviewer concepts. A packing-list schema proves that separation. The builder's
hand-off report moves later, in a separate step.

Stage two re-checked stock Mastra against the current Agent-through-CommandCode
route. The earlier Step 3b rejection no longer applies: installed Mastra can
combine tools with structured output by injecting the schema into the prompt
when the OpenAI-compatible connection does not advertise native structured
output. The offline audit probe demonstrated that combination. It still does
not replace the recorder: final structured output is validated only at the end
of the run, while this reviewer must fsync each accepted piece before another
provider call and retain those pieces after process death. Output processors
likewise transform or reject model output but do not supply atomic per-piece
run-file storage. Stock `createTool` schemas and Mastra's tool-error-to-model
loop remain the validation and recovery boundary; durable piece storage,
domain completeness checks and deterministic assembly stay custom
([installed tools guide](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-agents-tools.md), [installed `createTool` reference](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-tools-create-tool.md), [installed structured-output guide](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-agents-structured-output.md), [installed processor interface](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-processors-processor-interface.md)). Any agent and any tool-calling model can use the engine; a new model must pass the opt-in probe before use. During reset this is enforced by the local execution refusal plus the full-suite offline recorder probe; removing the refusal for a different model requires a model-specific opt-in result.

The `maxSteps` budget is derived, not guessed. Reading and analysis receive
`files + criteria + 3` calls (inventory, diff and quote review included). Every
required recording/submission unit—header, two axes, every file and criterion,
five checks, two minimum counterexamples, test audit, three collection-complete
markers and submit—receives its own call plus one correction call. One final
acknowledgement is added: `3 * files + 3 * criteria + 34` (70 for the four-file,
eight-criterion retained fixture). Findings and limitations are independent
parallel tool calls and are not count-capped.

## Reset to minimum reviewer (Todd, 12 Oct 2026)

This section supersedes the 11 Oct memory, tracing, cost-brake, workflow,
acceptance and rerun decisions above. The report gate and the Step 4 recording
engine stay; the cross-review recall and full-internal-span experiment do not.
JUL-223's 12 Oct card is controlling where this section and older text differ.
Stage one removed the failed and superseded implementation without provider
calls; later stages rebuild and prove the minimum path offline.

### Incident and deleted evidence baseline

The 12 Oct live review demonstrated that the recording engine works: six pieces
were durable and three rejected pieces were corrected. The run nevertheless
ended in a system failure. Mastra's internal spans stored the growing agent
conversation again at each step; the DuckDB trace data grew by approximately
1.33 GB in 20 steps. DuckDB then failed a checkpoint, and the custom
store-readability check blocked the next provider request. A telemetry failure
therefore prevented the review from reaching a verdict.

Before this design change, the complete active trace directory was copied to:

`%USERPROFILE%\.julia\backups\jul-223-reset-round1-20261012\reviewer-traces`

The source and backup inventories both contained six files and exactly
2,988,804,123 bytes at the design checkpoint. Stage one reverified the backup
as six files and 2,988,804,123 bytes, recorded each SHA-256, and then deleted
the active `ops/mastra-agents/reviewer/traces` directory. Todd's later 12 Oct
decision says the root cause is already reproduced and recorded, so the entire
backup folder and all JUL-223/free-proof artifacts were then deleted. Neither
active nor backup database files remain.

### Dated inventory and stage-one result (12 Oct 2026)

The inventory below covers every reviewer commit and attempted fix on this
branch from 10 October through the reset. Commit groups are chronological;
"kept" means the requirement and its focused code remain, not that an older
execution route remains usable.

| Date | Commits and change family | Stage-one disposition |
| --- | --- | --- |
| 10 Oct | `a8512ff`, `58d521d`, `6a3b8e3`: laptop direct CommandCode request, uncapped output and transport diagnostics | Deleted the direct request module, transport module and their tests. The route cannot execute or fall back. |
| 10 Oct | `c34c835`, `67f38d3`: Mastra spike and repository-root repair | Kept the immutable Git read-tool boundary and repository-root focused test. Deleted disposable spike output; Git history remains. |
| 10 Oct | `4bac925`, `427df55`, `d8f27e0`, `4122d26`: review-only Mastra agent, legacy-transport compatibility tests, dispatch restriction and docs | Kept the review-only isolation boundary; deleted compatibility tests and runtime claims for the retired direct route. |
| 10 Oct | `331fb34`, `d0e3b98`, `5cb4888`, `bb96a99`, `de14667`, `2ea1676`, `2abd738`: CommandCode launch/vault wiring, limits, identity, stdin and outside-candidate execution | Kept the narrow vault `startReviewOnly` entry and immutable-candidate isolation. Removed the live format-probe entry and direct-provider fallback. Reviewer execution now stops locally until later offline gates pass. |
| 10 Oct | `89b95a2`: trace-close-before-cleanup repair | Deleted with shared tracing/finalization code; it no longer has an executable path. |
| 11 Oct | `20505d9`, `30a0d74`, `3946a3c`, `292c99c`, `9a6ceb2`, `ff8ebff`: durable proof rebuild, evidence integrity, research formatting, report contract, authoritative sources and reviewer records | Kept exact-set checks, quote checks, immutable sources, raw answers and durable piece recording. Replaced old full-report prompt instructions with the recorder-only contract. |
| 11 Oct | `df8516b`: published CommandCode price source | Kept response-usage validation and the pure rate calculation for the later hard ledger; it has no active paid caller in stage one. |
| 11 Oct | `c129ac7`, `a497045`: machine-wide usage reconciliation and safety fixes | Deleted `/alpha/usage/summary`, start/end waits, delta/coverage helpers, adjustment metrics and tests. |
| 11 Oct | `bf37da1`, `ef5c09c`, `00e4ac4`, `269f9c9`, `78a7587`, `17a975c`, `18759d3`: DuckDB memory, settle/wait, checkpoint headroom, exporter flushing/compression/serialization fixes | Deleted shared DuckDB configuration, exporter/finalization/retention code and tests; deleted the active databases after backup verification. |
| 11 Oct | `ea98850`, `1ad094f`: citation repair and candidate-byte read tools | Kept exact quote validation and immutable candidate reads. |
| 11 Oct | `f76e705`, `e563ac8`, `4975437`, `301dffc`: bounded recall, tool-loop completion, compact semantic memories and INCONCLUSIVE memory | Kept only tool-loop/report behavior covered at the recorder seam. Deleted semantic recall, saved messages, conversation history, vector/embedder code, dependencies, evidence fields and tests. |
| 11 Oct | `1df70b3`: fail-closed DuckDB cost-store probe | Deleted the custom store-readability probe and storage-backed brake. No replacement paid path is enabled in stage one. |
| 11 Oct | `c3948c1`, `d2d471b`, `1a5286b`, `1c1164a`, `d98b1bc`: derived recording budget, exact file inventory, serialized quote repair, Linear ballot criteria and large-review finalization | Kept the recorder budget formula, exact inventory, quote repair and ballot parsing. Removed the three-hour live worker assumption from the reset design; the card's 20-minute limit controls the later implementation. |
| 11 Oct | `70f78c5`: raw reviewer answers | Kept raw-response-before-parse and interruption evidence with focused tests. |
| 11 Oct | `6302ac5`, `1fb51a2`: paid CommandCode output-format probes | Deleted both full-JSON probes, their tests and the vault command that exposed them. The current recorder contract is checked offline by `recorded-review.test.mjs`, now included in the full suite; live execution remains disabled, so no model can enter the loop. A different model still requires an opt-in model-specific recorder probe before that disabled gate may be removed. |
| 12 Oct | `453815a`, `f6fd59e`: bad-tool-call probe and generic small-piece recording engine | Kept correction-shaped tool errors, generic durable piece storage, deterministic assembly and focused tests. |
| 12 Oct | `2ad78cb`: first reset design | Updated here to the card's 12 Oct decisions and the completed deletion state. |

Stage-one source deletion is therefore exact: the direct CommandCode request and
transport files; both format probes; their route/probe tests; the end-to-end
free proof for the removed memory/telemetry/brake stack; shared retention code;
semantic/message/vector/embedder code and dependencies; internal-span/exporter
configuration; the paid warn-only classifier; storage-backed cost control;
machine-wide reconciliation; and the retired full-report prompt instructions.
The active trace directory, external backup and disposable proof artifacts were
also deleted after Todd decided the handoff and Git history were sufficient.

Exact deleted tracked files:

- `ops/mastra-agents/reviewer/src/retention.mjs`
- `ops/mastra-agents/reviewer/test/free-proof.test.mjs`
- `scripts/julia-commandcode-format-probe.mjs`
- `scripts/julia-commandcode-format-probe.test.mjs`
- `scripts/julia-commandcode-format-probe-step3b.mjs`
- `scripts/julia-commandcode-format-probe-step3b.test.mjs`
- `scripts/julia-commandcode-request.mjs`
- `scripts/julia-commandcode-request.test.mjs`
- `scripts/julia-delivery-review-transport.mjs`

The retired graph controller was also deleted: every tracked file under
`graph/controller/`, every `scripts/controller-*` test and the
`scripts/controller-stand-in.mjs`, `scripts/run-seat*` and
`scripts/stand-in-seat*` harnesses. Their `HISTORICAL_TESTS` exclusion and
non-runner suite registrations were removed. The shared `graph/board-spec` and
`scripts/bad-submissions` checks remain and now run normally in the full suite.

Exact deleted settings and executable branches: the reviewer package's
`retention` script and direct dependencies on `@ai-sdk/openai-compatible`,
`@mastra/duckdb`, `@mastra/fastembed`, `@mastra/libsql`, `@mastra/memory` and
`@mastra/observability`; DuckDB memory/thread/compression/exporter/14-day
retention settings; `includeInternalSpans`; message-history and semantic-recall
settings; vector/embedder construction; saved-message/recall/finalization
calls; `PromptInjectionDetector`; `TokenCostControl`; the custom cost-store
readability callback; `/alpha/usage/summary` and its coverage/delta/adjustment
code; safety-model construction and summary fields; the direct CommandCode and
native-reviewer launcher branches; both full-report prompt contracts; the
runner-suite registration for the removed free proof; and
`probeCommandCodeFormats` in both vault launchers. Matching assertions and
fixture tests for those deleted behaviors were removed; focused recorder,
quote, raw-answer, repository-root, tool-correction and reset-stop tests remain.

Exact runtime/evidence deletion: the baseline active directory held
`reviewer-costs.duckdb`, `.wal`, `.wal.checkpoint`, `reviewer.db`, `.db-shm`
and `.db-wal`. The first red reset test opened the old DuckDB before the new
stop existed, creating `reviewer-costs.duckdb.wal.recovery`, an empty temporary
directory, and consuming the SQLite `-shm`/empty `-wal` files. The four
unchanged nonempty baseline files still matched the backup byte-for-byte. Stage
one then deleted every remaining active file and the directory. The later finish
decision deleted `%USERPROFILE%\.julia\backups\jul-223-reset-round1-20261012`
and every `.artifacts` entry made by JUL-223, the free proof, spike, cost proof
or summary proof, including all step-4 text outputs. `.artifacts/guard-issue-140`
and `.artifacts/plans` remain because they belong to other work and no JUL-223
decision depends on them.

### Current file-level map

| Area | Files and current interface | Current implementation and reset consequence |
| --- | --- | --- |
| Reviewer entry and tools | `ops/mastra-agents/reviewer/src/reviewer.mjs`; `test/reset-stage.test.mjs` | Retains immutable Git read tools, raw-response capture and report-generation failure evidence. `runReviewer` stops locally with the reset-disabled reason before any provider request; no memory, telemetry, processor or finalization stack is constructed in stage one. |
| Processors | none active | The paid warn-only classifier and storage-backed cost processor are deleted. Deterministic normalization returns only with the later minimum Agent build. Candidate-as-data safety remains a requirement enforced by immutable tools and fixed instructions. |
| Fixed instructions | `STANDING_RULES` and `reviewerInstructions` in `reviewer.mjs`; `test/reset-stage.test.mjs` | All six rules are appended to the fixed reviewer instructions. No working-memory database, message history, semantic recall, vector storage or embedding package returns. Future learning memory must satisfy the separate return signal below; a read-only rules store does not qualify. |
| Report recording and evidence | `src/recording-engine.mjs`; `src/reviewer-report.mjs`; `src/quote-check.mjs`; `test/recording-engine.test.mjs`; `test/recorded-review.test.mjs`; `test/quote-check.test.mjs`; `test/tool-input-failure.test.mjs`; `test/fixtures/repaired.json`; `support/recorded-review-interrupt-child.mjs` | This is the deep module at the report seam: small validated durable pieces, correction-shaped errors, deterministic assembly, exact quote checks and the unchanged runner envelope. It worked in the live run and stays. |
| Raw model evidence and interruption | `reviewer.mjs`; `test/raw-answer.test.mjs`; `test/fixtures/final-answer.txt`; `support/raw-answer-interrupt-child.mjs`; the recorder's progress sidecar | The exact last raw provider response is saved before parsing and accepted piece keys survive interruption. The minimum design keeps both and adds a per-run model-event journal so every prompt, reply, tool call and usage record is retained once without depending on trace internals. |
| Observability storage and retention | no active reviewer observability dependency, retention script or runtime database | Internal/model span export, shared or per-run DuckDB, LibSQL, storage exporters, retention and their free proof are deleted. Provider-boundary raw responses, validated usage and the durable recorder are the retained diagnostic evidence; no telemetry database is planned for the minimum reviewer. |
| Cost evidence | `src/commandcode-cost.mjs`; raw-response tests | Only provider-response usage validation and the pure published-rate calculation remain for reuse by the later hard ledger. `TokenCostControl`, aggregate reads, the custom store-readability probe and `/alpha/usage/summary` reconciliation are deleted. With reviewer execution disabled, this code has no active paid caller. |
| Runner and final state | `scripts/julia-review-only.mjs`; `scripts/julia-vault.mjs`; `scripts/julia-vault-windows.ps1`; `scripts/julia-delivery-runner.mjs`; their matching tests | Candidate and authorization journaling remain. Both the worker and the retired direct CommandCode branch stop locally during reset; the vault exposes no live format-probe command. The PASS/FAIL/INCONCLUSIVE/SYSTEM_ERROR terminal-state implementation remains later-stage work. |
| Old-runner seat seam | `run-pi-seat.mjs`; `run-agy-seat.mjs`; `read-secret.mjs`; `graph/seat-table.mjs`; `scripts/seat-labels.mjs`; `julia-minimal-runner-adapters.mjs`; `julia-graph-model.mjs`; `board-setup.mjs`; `ops/julia-runner/run-reviewer.mjs` | These files remain because the laptop runner still imports them. Stage three deletes this seam when the Mastra workflow replaces the old runner. That deletion is tied to workflow replacement, not OVH retirement. The OVH-only Python graph, Orca launch chain, server config and credential drop-box writer/service are already deleted in stage one. |

### Minimum interfaces and terminal state

The report recorder remains the deep module at the report seam. A small review-
budget module will receive immutable limits before `Agent.generate()`, reject a
provider request before it is sent when its conservative maximum would cross
the cost or elapsed limit, charge returned provider usage to a durable per-run
ledger, and have no dependency on observability storage. The runner remains the
owner of process timeout and final state.

Every started run has exactly one terminal state:

- `PASS`, `FAIL`, or `INCONCLUSIVE` means the model submitted a schema-valid,
  exact-quote-verified report. `INCONCLUSIVE` is a completed review state, not a
  malformed response and not an infrastructure error.
- `SYSTEM_ERROR` means no validated report exists because of timeout, step or
  cost exhaustion, provider/transport failure, malformed unfinished output,
  process death, storage needed for the report, or another infrastructure
  failure. It is never sent through `checkedReview` as a review verdict.
- The worker atomically saves a validated report before optional telemetry
  finalization. Once one of the three review states exists, telemetry, logging,
  cost-store, retention or shutdown errors may add warnings but cannot replace
  it or make the runner reject it.
- If the worker exits without a terminal record, the runner writes
  `SYSTEM_ERROR` from the exit/timeout and the durable progress sidecar. Active
  progress is not a fifth terminal state.

### Keep, remove, defer

| Decision | Feature | Verified requirement served, or exact removal/return condition |
| --- | --- | --- |
| Keep | Step 4 recording engine, reviewer report adapter, exact-set completeness checks and quote verification | Serves the unchanged evidence gate: every standard/spec axis, criterion, file, five checks, counterexamples, test audit, finding and limitation is validated before `checkedReview`. Files: `recording-engine.mjs`, `reviewer-report.mjs`, `quote-check.mjs` and their focused tests. |
| Keep | Raw-response-before-parse, durable accepted pieces and technical-failure evidence | Serves the Step 1 requirement that malformed model output is a technical failure and the interruption requirement that accepted work survives. Files: `reviewer.mjs`, raw/recorded-review tests and both support child scripts. |
| Keep | Immutable Git read tools and deterministic `UnicodeNormalizer` | Serves independent review of the pinned candidate and stable validation without granting source writes. File: `reviewer.mjs`; repository-root, quote and recorded-review tests. |
| Keep | Six standing rules as fixed reviewer instructions | A database holding a read-only constant adds no learning. `reviewerInstructions` appends `STANDING_RULES` directly to the role and coding standards, and the reset test checks all six. No `@mastra/memory` or `@mastra/libsql` dependency returns. |
| Keep | Provider-boundary model-event journal and usage pricing | Serves Todd's requirement to retain prompts, replies, tool calls and usage without internal span copies, and the `$1.00` per-card authorization. Keep the estimate portion of `commandcode-cost.mjs`, raw capture in `reviewer.mjs`, and tests that prove raw usage survives provider normalization. Each event is written once to the run folder. |
| Remove | Model-level observability storage | Do not restore `MastraStorageExporter`, `SensitiveDataFilter`, `MODEL_GENERATION` span storage, per-run DuckDB, summaries or retention. The minimum reviewer retains provider-boundary raw responses, tool-call recording and validated usage without an observability database. |
| Keep | Existing runner identity, candidate, publication and `checkedReview` evidence checks | Serves immutable-candidate identity, different-maker review, exact report completeness and durable publication. `checkedReview` must accept a valid `INCONCLUSIVE` as that state while still rejecting malformed content; the runner parks rather than repairs it. |
| Remove | Semantic recall and saved reviewer-message memory | Delete `LibSQLVector`, FastEmbed, `semanticRecall`, `semanticReviewMatches`, the pre-run `memory.recall`, post-run `memory.saveMessages`, semantic evidence fields, `@mastra/fastembed`, and their lockfile entries. Delete/replace the semantic tests in `test/contract.test.mjs` and the two-review semantic assertions in `test/free-proof.test.mjs`; update `README.md`. No dormant flags or empty vector adapter remain. |
| Remove | Reviewer message history and working-memory rules store | Delete `lastMessages`, per-review thread history, `Memory`, `LibSQLStore` and tests claiming database persistence. The six constant rules live in fixed instructions. No replacement memory database is created. |
| Remove | Internal and model-level span export | Delete `includeInternalSpans`, observability construction, DuckDB/exporter settings and assertions requiring stored spans. The active and backup databases are deleted; no new per-run DuckDB replaces them. |
| Remove | Storage-backed paid-call brake | Delete `TokenCostControl`, `requireCostStoreReadable`, the pre-call DuckDB aggregate probe, cross-run/card `runTotals` gating, and their contract/free-proof assertions. Paid execution stays disabled in stage one. A later offline stage must add and prove the preconfigured per-run hard budget ledger before paid execution resumes; do not leave both brakes active. |
| Remove | Machine-wide usage-summary reconciliation from the critical path | Delete the `/alpha/usage/summary` start/end wait and actual-adjustment write (`commandCodeUsageSummary`, `usageSummaryDelta`, `requireUsageSummaryCoverage`, `usageSummaryAfterRun`) and their tests. It can overcount concurrent work and is not needed when each provider response supplies validated usage. Provider usage remains durable model-level evidence. |
| Remove | Paid warn-only prompt-injection classifier | Delete `PromptInjectionDetector`, its safety model/connection/cost role and warning-only proof from `reviewer.mjs`, `test/free-proof.test.mjs` and README claims. It adds a paid model call but does not enforce the candidate-as-data rule; immutable tools and fixed instructions remain the enforcement. |
| Removed | Direct single-shot reviewer route and old full-JSON contract | Stage one deleted `julia-delivery-review-transport.mjs`, `julia-commandcode-request.mjs`, their route-only tests, the fallback branch in `julia-delivery-runner.mjs`, both live format probes and the full-report output instruction in `julia-delivery-review.mjs`. Shared candidate/check helpers remain. No compatibility wrapper was added. |
| In scope through JUL-196 | Mastra workflows | JUL-223 proves its offline components first. JUL-196 then replaces custom runner orchestration with Mastra workflows while retaining authorization, immutable candidate/evidence identity and recovery contracts. The integrated offline gates must pass through that actual route before JUL-224's trust check or the one paid #287 review. |
| Defer | Semantic or observational reviewer memory | Return only after two clean live reviews on separate real changes and a third review demonstrates, with a written fixture, a required decision that cannot be made from the card, candidate, test evidence and standing rules. Any proposal must show bounded storage and cannot restore raw message history. |
| Defer | Rich internal tracing or external observability export | Return only after two clean live reviews on separate real changes meet the database/disk/memory budgets and a concrete diagnosis cannot be made from the model-event journal plus model-level spans. The proof must measure incremental bytes before enabling any extra span type. |

Historical research in `claude/mastra-memory-research.md` remains an evidence
artifact, not an active design. The older `julia-minimal-runner*` delivery path
is mapped here but is outside this reset except for reviewer code actually
replaced by the Mastra route.

### One-review numerical budgets

These are acceptance limits for the minimum reviewer, not observations to be
reported after an unbounded run. Step, elapsed-time and estimated-cost limits
are configured before the process starts and enforced without DuckDB.

| Resource | Budget for one review | Sizing and enforcement |
| --- | ---: | --- |
| Model steps | Derived hard maximum | Compute the ceiling from the final changed-file and acceptance-criterion inventory before the offline maximum-length proof. The retained four-file/eight-criterion fixture evaluates to `3F + 3C + 34 = 70`; that example is not permission to use 70 for a different inventory. A review that does not fit the calculated ceiling returns to Triage before a paid call. |
| Elapsed time | 20 minutes hard maximum | Matches the existing direct CommandCode review timeout and is far below the accidental three-hour Mastra worker cap. The runner owns the process timer; expiry is `SYSTEM_ERROR` with durable progress, never `INCONCLUSIVE`. |
| Estimated cost | `$0.50` hard maximum for the one PR review; `$1.00` cumulative JUL-223 maximum | Before each request, the ledger adds spent validated usage to a conservative maximum for the pending request and refuses to send if the result exceeds `$0.50`. Use peak published rates and a 4,096-token output ceiling; input is conservatively bounded from the serialized request before dispatch. All reviewer calls are included because the paid safety call is removed. Any live-review result or infrastructure error is preserved and not retried. |
| Durable evidence growth | 64 MiB maximum per review | Includes raw responses, provider-boundary model events, recorded pieces, terminal state and temporary atomic-write files. There is no DuckDB or LibSQL. Measure the run folder before start and after close; exceeding the budget fails the implementation proof but cannot overturn a saved verdict. |
| Peak worker memory | 768 MiB RSS maximum | Less than half the previously measured 1.6 GB free-memory envelope and well below the failed roughly 1.3 GB process/store condition. Sample RSS through the offline proof and live-run summary. A future hard OS limit may be added only if the existing runner's process control cannot enforce it safely. |
| Disk growth | 128 MiB maximum per review and 2 GiB free-space preflight | Allows headroom above the 64 MiB durable-evidence budget for atomic-write temporary files. The preflight refuses to start below 2 GiB free. Temporary files are removed only after their durable replacement is confirmed; retained run evidence is not silently cleaned. |

The cost preflight uses the request's UTF-8 byte length as a conservative upper
bound on input tokens, peak input/output prices, and the 4,096-token maximum
output. After a response, its validated provider token counts replace the
reservation with the calculated charge and the ledger is atomically refreshed.
Thus a broken telemetry database cannot authorize overspend and cannot block a
completed verdict.

### Observability decision

The minimum reviewer constructs no Mastra observability store or exporter.
`includeInternalSpans`, span filtering, model-generation span persistence,
DuckDB and LibSQL are absent rather than configured off. The provider-boundary
journal is the authoritative copy of replies, tool calls and validated usage.

Installed pages read for this decision:

- `ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-observability-tracing-configuration.md`
- `ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-observability-tracing-span-filtering.md`
- `ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-observability-tracing-interfaces.md`
- `ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-memory-message-history.md`
- `ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-memory-working-memory.md`

The offline `recorded-review.test.mjs` already uses the real installed
`Agent.generate()` against a scripted local provider and the current recorder,
including malformed tool JSON, correction, durable pieces and submission. It is
now part of the full runner suite. Because `runReviewer` still refuses before a
provider request, a new model cannot enter the live loop; restoring live
execution requires a separately authorized model-specific opt-in recorder probe.

### JUL-223 stage-two stock-feature audit (12 Oct 2026)

This appendix re-checks every custom part against the current route: a Mastra
`Agent` using the existing OpenAI-compatible CommandCode connection. It replaces
the older Step 3b assumptions where they differ. The plain-English decision
table is in `claude/jul-223-stage2-audit.md`; the detailed research notes are in
`claude/jul-223-stage2-research.md`.

#### Package currency

The lockfile installs `@mastra/core` 1.75.0. On 12 Oct, the official npm `latest`
tag reported 1.76.0 ([npm registry package record](https://registry.npmjs.org/@mastra%2fcore/latest)).
The 1.76.0 package changelog adds durable-agent run ownership and fencing plus a
workspace argument for `processLLMRequest`; it adds no file exporter, exact
pre-call cost reservation, immutable-Git read tool, or file-backed workflow
snapshot ([official 1.76.0 changelog](https://github.com/mastra-ai/mastra/blob/%40mastra/core%401.76.0/packages/core/CHANGELOG.md)).
Run fencing is relevant to a future database-backed durable-agent design, but
the current rule is that run files own execution state. Do not upgrade during
stage three merely for this audit result.

#### Recording engine and report adapter

- **Stock checked:** `structuredOutput`, its `jsonPromptInjection` fallback and
  its tools-plus-structured-output guidance ([installed structured-output
  guide](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-agents-structured-output.md));
  agent output processors ([installed processor interface](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-processors-processor-interface.md));
  and `createTool` input/output schemas and validation failures
  ([installed tools guide](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-agents-tools.md),
  [installed `createTool` reference](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-tools-create-tool.md)).
- **Tried:** `node --test audit/jul-223-stage2-stock.test.mjs` used installed
  `Agent.generate()`, `createTool`, and the installed OpenAI-compatible provider
  against a local HTTP stand-in. With native structured output disabled, inline
  schema injection remained combined with tools, made two model steps, executed
  the tool, omitted `response_format`, and returned the validated object. PASS.
  `test/tool-input-failure.test.mjs` also proved that malformed and
  schema-invalid tool inputs become correction messages and can be retried. PASS.
- **Verdict:** **stock plus a small custom part**. Stock owns tool-input schema
  validation, the correction loop and, when useful, final object validation.
  The exact gap is that structured output validates only the final result and
  output processors operate on model output; neither fsyncs each accepted
  semantic report piece before the next provider request, restores those pieces
  after process death, enforces Julia's exact-set/evidence rules, or assembles
  the existing verdict envelope. `recording-engine.mjs` and
  `reviewer-report.mjs` therefore stay. The engine's direct tool-execution seam
  can be called without the Agent runtime, so its defensive parse remains part
  of that public module contract rather than relying solely on Agent dispatch.

#### Pre-call spending and time limit

- **Stock checked:** `maxSteps`, `stopWhen`, and `modelSettings.timeout`
  ([installed generate reference](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-agents-generate.md));
  `TokenLimiterProcessor` ([installed token-limiter reference](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-processors-token-limiter-processor.md));
  and `TokenCostControl` ([installed cost-control reference](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-processors-token-cost-control.md)).
- **Result:** docs are decisive, so no runtime probe was needed. `maxSteps` and
  `stopWhen` bound iterations, and `totalMs` supplies a hard run deadline.
  `TokenLimiterProcessor` trims or aborts by token count, not price. The stock
  cost control explicitly queries observability storage, sees asynchronously
  persisted past cost, can overshoot, and fails open when required context or a
  query is unavailable. None reserves the conservative maximum cost or duration
  of the request about to be sent.
- **Verdict:** **stock plus a small custom part**. Configure the derived stock
  step ceiling and the 20-minute stock total timeout, while the outer runner
  retains its process kill. Keep a small file-backed pre-call ledger that adds
  spent validated usage to the pending request's conservative maximum and
  refuses before dispatch. It must have no observability/database dependency.

#### Model log

- **Stock checked:** model-generation span inputs/outputs and custom exporters,
  with internal spans disabled ([installed tracing configuration](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-observability-tracing-configuration.md),
  [installed tracing interfaces](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-observability-tracing-interfaces.md));
  `onStepFinish`, `onFinish`, returned steps/request/response/tool calls and usage
  ([installed generate reference](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-agents-generate.md));
  and the provider's injectable `fetch` plus raw-response metadata extractor
  ([installed OpenAI-compatible provider guide](../ops/mastra-agents/reviewer/node_modules/@ai-sdk/openai-compatible/docs/index.mdx)).
- **Result:** the stock production exporters listed by Mastra write to Mastra
  storage, Mastra Platform or third parties. The installed first-party
  `TestExporter.writeToFile()` is a testing/debugging snapshot that buffers all
  events in memory until explicitly flushed; it is not an incremental or
  crash-durable production file exporter
  ([installed TestExporter declaration](../ops/mastra-agents/reviewer/node_modules/@mastra/observability/dist/exporters/test.d.ts)).
  `onStepFinish` is documented as unavailable for non-streaming structured
  output and occurs after a step, so it cannot guarantee raw-before-parse
  capture. The provider hook does expose the exact boundary but file format,
  size enforcement, atomicity and non-blocking failure policy remain application
  work.
- **Verdict:** **keep custom**. The exact gap is one bounded, file-backed,
  provider-boundary journal that persists prompt, raw reply, tool calls and
  validated usage exactly once, without a logging failure blocking or replacing
  a saved verdict. Do not restore model/internal-span storage.

#### Runner and terminal states

- **Stock checked:** workflow steps, schemas and result statuses
  ([installed workflows overview](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-workflows-overview.md));
  failure statuses, per-step results, callbacks and retries
  ([installed workflow error handling](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-workflows-error-handling.md));
  suspend/resume ([installed suspend/resume guide](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-workflows-suspend-and-resume.md));
  and snapshots ([installed snapshots guide](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-workflows-snapshots.md)).
- **Result:** workflows provide the stock execution graph and distinguish
  success, failed, suspended, tripwire and paused outcomes. Lifecycle callback
  errors are caught and logged without changing the workflow result. Persistent
  suspend/resume snapshots, however, are written to a configured database, and
  the stock statuses do not mean Julia's PASS, FAIL, INCONCLUSIVE and
  SYSTEM_ERROR.
- **Verdict:** **stock plus a small custom part**. JUL-196 should own the
  preflight/review/publication sequence as typed workflow steps and use stock
  result/error handling. The existing outer runner must retain explicit start
  and spend authorization, immutable candidate identity, the process-level hard
  timeout, idempotent publication and the domain mapping: only a validated
  report can produce PASS/FAIL/INCONCLUSIVE; every other failure becomes
  SYSTEM_ERROR. Do not use `suspend()` for INCONCLUSIVE and do not introduce a
  workflow database as a second execution record; run files remain authoritative.

#### Outer-runner responsibilities

The generic workflow verdict does not by itself audit the custom work around
the reviewer. Each remaining outer-runner responsibility was checked
separately:

| Responsibility | Stock candidate and exact page | Test/result | Verdict and exact gap |
| --- | --- | --- | --- |
| Narrow launch parsing and start/spend authorization | Agent tool approval: [installed human-in-the-loop guide](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-agents-human-in-the-loop.md); workflow input schema: [installed workflows overview](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-workflows-overview.md) | `scripts/julia-review-only.test.mjs` exercises accepted and refused launch shapes plus the selected identities. The docs are decisive, so no new probe was needed. | **Keep custom.** Tool approval occurs after agent execution has begun and workflow input validation proves shape, not Todd's prior card/candidate/spend authorization. The outer launcher must refuse first and journal that exact authority. |
| Pull-request resolution and immutable detached worktree | Workspace filesystem access: [installed Workspace reference](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-workspace-workspace-class.md) | `scripts/verify-reviewer-worktree.test.mjs` uses a real local Git repository and detached worktree to prove clean and changed candidates. | **Keep custom.** Workspace exposes a current filesystem; it does not resolve a GitHub pull request to a commit, fetch that object, create a detached worktree or prove it stayed at that commit. |
| Required-check acquisition | Custom workflow step and tools: [installed workflows overview](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-workflows-overview.md), [installed tools guide](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-agents-tools.md) | Docs show that step/tool `execute` remains application code; no runtime probe was needed to distinguish orchestration from a GitHub required-check query. | **Stock plus a small custom part.** A workflow should order and fail the step, but a narrow GitHub adapter must fetch required checks and bind them to the already-resolved candidate commit. |
| Temporary-worktree cleanup | Workflow success/error callbacks: [installed workflow error handling](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-workflows-error-handling.md) | The current launcher uses an outer `finally`; workflow docs state lifecycle callback errors are caught and logged. That makes callbacks unsuitable as the sole cleanup guarantee, so no ambiguity needed a probe. | **Keep custom.** Retain the outer `finally` and exact-path checks for safe local cleanup. A workflow may request cleanup, but a caught callback failure cannot own this guarantee. |
| Idempotent publication | Custom workflow step, retries and result inspection: [installed workflow error handling](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-workflows-error-handling.md) | Existing publication adapter tests cover the repository's push/update behavior; the stock docs contain no Julia/Linear/GitHub destination or idempotency key. | **Stock plus a small custom part.** The workflow should sequence the step and surface failure; the adapter must choose the authorized destination, deduplicate by run/candidate identity and leave the saved verdict authoritative if publication fails. |

#### Smaller pieces

| Piece | Stock feature and exact page | Test/result | Verdict and exact gap |
| --- | --- | --- | --- |
| Word-for-word quote check | Structured-output schemas and output processors: [structured output](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-agents-structured-output.md), [processor interface](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-processors-processor-interface.md) | Existing `test/quote-check.test.mjs`; included in the full offline suite. | **Keep custom.** Stock validates shape/content policies but does not resolve `diff` or `file:path` at a pinned Git commit and compare the quote byte for byte. |
| Raw answer before parsing | Provider `fetch` and metadata hooks: [OpenAI-compatible provider guide](../ops/mastra-agents/reviewer/node_modules/@ai-sdk/openai-compatible/docs/index.mdx) | Existing `test/raw-answer.test.mjs`; included in the full offline suite. | **Stock plus custom.** The hook is stock; ordered atomic persistence before Mastra parses, with run/candidate identity, is not. |
| Interruption evidence | Workflow snapshots: [snapshots guide](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-workflows-snapshots.md) | `test/recorded-review.test.mjs` killed the child after an accepted piece and recovered the accepted key plus technical-failure sidecar. PASS. | **Keep custom.** Snapshots persist at suspension to a database, not synchronously after each accepted piece, and are not the required run-file record. |
| Provider cost arithmetic | Stock cost guard: [cost-control reference](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-processors-token-cost-control.md); provider rates: [CommandCode pricing](https://commandcode.ai/docs/resources/pricing-limits) | The official page still lists DeepSeek V4.1 Flash at $0.15/$0.60/$0.003 off-peak and $0.30/$1.20 peak per million input/output/cache-read tokens. Existing contract tests cover both bands and reject missing counts. | **Keep custom.** Stock cost is a delayed trace estimate; the hard ledger needs these provider-specific current rates and the captured raw counts. |
| Read-only Git tools | Read-only workspace filesystem: [installed Workspace reference](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-workspace-workspace-class.md); tool schemas: [installed tools guide](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-agents-tools.md) | Existing repository-root and recorded-review tests; included in the full offline suite. | **Stock plus custom.** Keep stock `createTool`; custom Git commands remain because workspace reads follow a mutable filesystem and cannot address a named commit, base-to-candidate diff or deleted file at its prior revision. |
| Derived step formula | Stock `maxSteps`: [installed generate reference](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-agents-generate.md) | Existing contract test proves four files/eight criteria yields 70. | **Stock plus custom.** Mastra enforces the number but does not derive it from Julia's immutable file/criterion and correction inventory. |
| Output-token ceiling | Stock `modelSettings.maxOutputTokens`: [installed generate reference](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-agents-generate.md) | Existing contract tests prove the current request-body scrubber; stage three replaces that test with an assertion on the configured 4,096-token stock ceiling. | **Use stock.** The custom scrubber removes the bound needed for conservative pre-call reservation and is marked for deletion. Do not inject legacy provider-body fields. |
| Fixed rules, configuration and completeness contract | Agent instructions and structured output: [installed Agent reference](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-agents-agent.md), [structured output](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-agents-structured-output.md) | Existing reset and contract tests; included in the full offline suite. | **Stock plus custom.** Mastra carries the instructions and schema; Julia's six rules, different-maker selection, exact file set, criterion coverage and verdict consistency are domain policy. |
| Atomic run-file writer | Workflow snapshots require configured storage: [installed snapshots guide](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-workflows-snapshots.md) | Recorder, raw-answer and interruption tests exercise temporary-file, fsync and rename behavior. | **Keep custom.** No installed stock dependency supplies the required database-free atomic run-file record. Consolidate the duplicate helper, but do not replace it with telemetry storage. |

#### Stage-three replacement and deletion list

No reviewer source file is marked for wholesale deletion: every file under
`ops/mastra-agents/reviewer/src` contains at least one requirement-specific gap
identified above. Stage three does remove duplicated custom paths inside them:

1. Delete `requestWithoutOutputCap()` and its assertions. Configure stock
   `modelSettings.maxOutputTokens: 4096` before the run, as required by the
   conservative cost reservation, rather than stripping every provider output
   limit from the request.
2. Configure stock `maxSteps` from `reviewStepBudget(files, criteria)` and stock
   `modelSettings.timeout.totalMs` to 20 minutes. Keep the outer process timeout
   and add the custom pre-call cost/time reservation ledger; neither stock
   setting replaces it.
3. Keep the OpenAI-compatible `fetch`/metadata extension points but replace the
   two local atomic-write implementations with one shared run-file helper. Add
   the bounded provider journal there; its write failures become durable
   warnings after a verdict exists and technical failures before one exists.
4. Have JUL-196 express the existing preflight, review and publication sequence
   as Mastra workflow steps. Once the actual workflow route passes its offline
   gates, delete the retained old-runner seat seam already listed in the current
   file map: `run-pi-seat.mjs`, `run-agy-seat.mjs`, `read-secret.mjs`,
   `graph/seat-table.mjs`, `scripts/seat-labels.mjs`,
   `julia-minimal-runner-adapters.mjs`, `julia-graph-model.mjs`,
   `board-setup.mjs`, and `ops/julia-runner/run-reviewer.mjs`. Keep the outer
   run-file journal, authorization, candidate identity, timeout, terminal-state
   mapper and idempotent publication adapter.
5. Correct the existing reviewer-only launch authorization from `$1.00` to the
   approved `$0.50` per-review maximum while preserving the `$1.00` cumulative
   JUL-223 ceiling in the card/run ledger. Paid execution remains disabled until
   the resulting offline gates pass.

#### Stage-two verification record

The complete reviewer suite passed 28 tests, including the real installed
Mastra Agent/tool/structured-output stand-in and the interruption-recovery
process test. Eleven focused outer-runner tests also passed for launch refusal,
authorized configuration, real detached-worktree identity/tamper checks, and
idempotent commit-bound review publication. The stand-in is offline
component/contract evidence for the
installed library path; it is not proof of the real CommandCode service
boundary. Real-service integration is not applicable because this audit changes
no service connection and authorizes no provider call. End-to-end browser
behavior and console checks do not apply because this audit changes no Julia
user-facing surface. Production logging behavior is unchanged; the audit
instead identifies the exact logging gap stage three must close.
`npm run lint:framework` also passed. The user-facing Julia proof is not
applicable for the same reason: this is an audit, documentation, and offline
test only.

### Replace, then delete

The reset is not an additive compatibility layer. Each implementation change
must delete the code, test, dependency, setting and active runtime data it
replaces in the same commit. The hard ledger replaces both stock and custom
DuckDB brakes without using a telemetry database; fixed instructions replace
the rules database; the provider journal replaces stored spans; and the Mastra
recording route replaces the single-shot reviewer route. A new mechanism is not
complete while its replaced path can still execute.

## Standing rules for the reviewer (fixed instructions)
- Every quote must appear word for word in the named file or diff at the reviewed commit.
- No arbitrary caps or limits; flag any new one.
- Never ask Todd; anything needing a human parks the card with a visible reason.
- Agents never create tickets, merge, or delete.
- Prefer stock Mastra features; flag custom code that duplicates one.
- Flag missing tests and missing logging.

## Working rules for agents (this effort)
- Do not do code work without Todd's permission. Conserve tokens.
- Read this file before starting any Mastra work; the latest dated Todd/card decision wins when records disagree.
- For a root-cause analysis, work from the symptom and evidence with the diagnose-bugs skill, not from a hypothesis.
- Nothing may depend on Todd signing in repeatedly. At most one atomic account-owner approval. Never ask Todd about workspaces, branches or Git state.
- Each step ends in something Todd can see.

## Parked items, in the order they come up
1. Reviewer: complete JUL-223's offline component proofs; let JUL-196 supply and prove the workflow route; pass JUL-224's separate four-defect trust check; then run exactly one paid #287 review under the $0.50 review/$1.00 cumulative JUL-223 limits. Do not rerun #282 and do not retry #287. Green CI, independent review and Todd's technical acceptance of the exact evidence packet precede merge; household UAT is not applicable.
2. Runner preflight: the runner checks a card's assumptions and credentials before starting, repairs what it can, and posts stop reasons to the card.
3. Credential-list writer: the migration writer must add to `secrets.env`, not overwrite it.
4. Builder: research what Mastra gives a coding agent, small spike, build; builder role file. Executable `julia-builder` references are clean; one immutable historical transcript remains.
5. Token renewal (expires 6 Jan 2027): automatic or one tap.
6. Escalation ladder.
7. Stage three replaces the old runner with the Mastra workflow and then deletes the retained seat seam (`run-pi-seat`, `run-agy-seat`, `seat-table`, `seat-labels`, `read-secret` and their named importers). This is a workflow-replacement cleanup, not part of OVH retirement. Cancel OVH separately after the reviewer is proven.
8. Smaller cleanups: confirm the cost ceiling from a real run; revoke stale 1Password service accounts; investigate JUL-196's stall. The old graph controller is deleted and stale PR #184 has its closure reason recorded.
