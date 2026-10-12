# Mastra builder and reviewer agents: settled design and parked items

As of Mon 12 Oct 2026. This file is the source of truth for the Mastra agents except where JUL-223's 12 Oct card decisions supersede older text. Mastra docs findings behind the 11 Oct changes: `claude/mastra-memory-research.md`.

## Where things stand
- Spike (closed PR #286) proved a Mastra agent on DeepSeek 4.1 Flash via CommandCode can use read-only tools and return a strict structured review in one run. Spike verdict on PR #282: PASS, 16 of 16 quotes verified.
- Real reviewer is in PR #287 (open). Six live attempts on 10-11 Oct were reported as reviewer-identity mismatches because the runner validated a missing observed identity before considering the worker's nonzero exit. Retained evidence separates three millisecond-scale preflight failures from three 79–139 second paid executions with storage/shutdown errors. The runner now reports nonzero worker exits as the primary failure and validates identity only for an exit-zero worker; an exit-zero missing or mismatched identity still fails closed. Earlier failures also exposed end-of-run database cleanup and missing-internal-span defects; those have regression coverage. The first 11 Oct proof attempt then showed that the AI SDK's OpenAI-compatible response schema removes CommandCode's non-standard `usage.cost` field before its metadata extractor runs. The provider transport now validates and retains raw response token usage before schema normalization, keyed by response ID, and fails closed when required token counts are missing or invalid.
- Spend limit: $1.00 cumulative for JUL-223 and $0.50 for its one authorized PR #287 review. There is no retry after any #287 outcome and no #282 rerun under this card. Offline and trust-check work makes no JUL-223 provider call unless its later stage explicitly authorizes one.
- PR #284's direct laptop transport was superseded by this reset and closed on 12 Oct. OVH VPS cancellation remains a later retirement step after the new reviewer is proven.
- 1Password: Julia-vault-only read_items service account, token DPAPI-protected on the laptop, unattended. Expires 6 Jan 2027 Pacific.

## 11 Oct design (superseded where the 12 Oct reset says so)
- Two Mastra agents, builder and reviewer, called as steps by the existing delivery runner. The runner owns sequence, saved state, lock, kill-orphan-workers and authorization checks.
- Look it up, don't recall it: use version-matched documentation bundled with each installed package first; otherwise use the tool's official `llms.txt` index and fetch only the applicable individual page, never `llms-full.txt`. The Mastra docs MCP server is a fallback only. Every framework-map job cites the exact page used. Custom code is allowed only after the applicable docs show the stock tool has no feature for the need, and the report records the gap.
- Models from the per-card configuration (JUL-195). Default: CommandCode `deepseek/deepseek-v4.1-flash`. Reviewer must be a different maker from the builder.
- Instructions: reviewer = `.agents/skills/adversarial-review/SKILL.md` plus CODING_STANDARDS.md plus the six fixed standing rules below. The rules are ordinary fixed instructions, not working memory. Executable `julia-builder` references were removed with the retired graph controller; one immutable historical transcript still contains the old path.
- **Reviewer memory (Todd, 11 Oct): no observational memory.** Observational memory works only within one conversation, starts after about 30,000 tokens, and its cross-conversation mode is deprecated, so it cannot carry anything between one-shot reviews. Reviewer uses: persisted message history; working memory, resource-scoped, holding Todd's standing rules (section "Standing rules for the reviewer"); semantic recall, resource-scoped, LibSQL vector store, local FastEmbed (one embedding model, needs a clean Windows proof). One stable resource for the reviewer, one thread per review. Each one-shot model request disables automatic message-history and semantic-recall injection, then explicitly supplies the stock resource-scoped semantic matches from compact saved review-memory messages; this prevents prior candidate bytes and tool results from being duplicated into the safety check and trace while preserving all messages in LibSQL ([installed message-history guide](../ops/mastra-agents/reviewer/node_modules/@mastra/memory/dist/docs/references/docs-memory-message-history.md), [installed semantic-recall guide](../ops/mastra-agents/reviewer/node_modules/@mastra/memory/dist/docs/references/docs-memory-semantic-recall.md)). Reviewer memory is never shared with the builder (different resource). Revisit observational memory for the builder, whose sessions run long.
- Memory persists between reviews. Nothing is deleted at the end of a run. A schema-valid, exact-quote-verified INCONCLUSIVE report is saved as compact semantic review memory before the delivery runner classifies it as an incomplete review, so a later independent review can recall what the earlier reviewer established and could not establish without converting INCONCLUSIVE into PASS or FAIL.
- Tools: builder reads, writes, commits to its own branch, runs tests; reviewer is read-only and points at the commit. Neither merges, creates tickets or deletes.
- The reviewer records its report as small validated tool calls; repository code assembles the unchanged runner envelope and verdict. The builder hand-off remains parked for a separate step. The schema permits exactly the immutable changed-file inventory in `filesReviewed` and the per-file results; the caller independently repeats the exact-set check. Quote check stays (every quote word for word in the named file or diff at that commit). At the JSON-source boundary only, actual tab/newline/carriage-return characters are losslessly rewritten to their escaped spelling if and only if that spelling occurs exactly in the named serialized source; each such repair is retained with the verdict.
- **Verdict first:** the provider transport durably saves every exact raw model response, tied to the run ID and candidate commit, before Mastra parses its tool call; the last response remains at that path. Malformed tool JSON or schema input is returned to the model for correction and is never a verdict. Every accepted piece refreshes a durable technical-failure sidecar naming all accepted keys, so even an uncatchable process kill retains both progress and its incomplete status. A schema-valid assembled submission then becomes the model's PASS, FAIL, or INCONCLUSIVE verdict exactly as returned and removes the sidecar. No quote check, memory task, shutdown step, or interruption may lose or replace the saved raw response or a validated verdict.
- **End of run order:** verdict out; wait for memory background work (`memory.settled()`); flush observability; then close storage. No deletion.
- Guards: UnicodeNormalizer plus PromptInjectionDetector in warn-only mode.
- **Storage (Todd, 11 Oct):** traces, cost metrics, and permanent run-summary logs live together in one stock local DuckDB observability store. Reviewer message history, resource-scoped working memory, and resource-scoped semantic recall remain in LibSQL. Use Mastra's stock domain storage configuration; no custom per-method storage adapter. Configure the supported DuckDB `memoryLimit: '1400MB'` and `threads: 1` options: a 1 GB limit reproducibly failed checkpointing a 633 MB full-internal-span database, while 1.4 GB recovered and checkpointed it within the laptop's measured 1.6 GB free-memory envelope; the adapter's 2 GB default previously exceeded that envelope ([installed DuckDB store types](../ops/mastra-agents/reviewer/node_modules/@mastra/duckdb/dist/storage/index.d.ts)). Configure the stock storage exporter with `maxBatchSize: 100` so it stays below the adapter's default batch of up to 1,000 events without triggering overlapping one-event checkpoints ([installed exporter types](../ops/mastra-agents/reviewer/node_modules/@mastra/observability/dist/exporters/mastra-storage.d.ts)). DuckDB uses its documented `preserve_insertion_order=false` OOM setting and Zstandard checkpoint compression ([DuckDB OOM guide](https://duckdb.org/docs/stable/guides/troubleshooting/oom_errors), [DuckDB pragmas](https://duckdb.org/docs/stable/configuration/pragmas)).
- **Tracing (Todd, 11 Oct):** `includeInternalSpans: true` (otherwise model, tool and step contents are dropped) and Mastra's default SensitiveDataFilter. Traces must show each step's content, tokens, and cost.
- **Retention (Todd, 11 Oct):** configure stock DuckDB observability retention only for spans, with `maxAge: '14d'`, and exercise stock `storage.prune()` through the reviewer's external-scheduler target. Metrics/cost records, logs/permanent summaries, and LibSQL memory have no retention policy and are never pruned. Do not delete at startup or shutdown. Install the laptop schedule from the merged checkout after UAT so it never points at a disposable PR worktree. Mastra pruning deletes rows but does not shrink the database file.
- **Permanent run summary (Todd, 11 Oct):** emit exactly one line per run through stock Mastra logging and keep it permanently. The line contains card, change, round, verdict or stop and reason, reviewer model and effort, safety-check model and effort, input/output tokens, cost, start/end time, and the memory and observability database sizes. When a provider has no effort setting, record that explicitly and cite its documentation.
- **Cost (Todd, 11 Oct, latest decision):** TokenCostControl ($1.00 per card) uses input/output/cache tokens multiplied by CommandCode's published `deepseek/deepseek-v4.1-flash` rates, recorded as `estimated` through stock `MetricsContext.emit(..., { costContext })`; this includes PromptInjectionDetector's safety call. At card start and after every run, the launcher-resolved key reads `/alpha/usage/summary`. The permanent summary records that machine-wide delta as `actual` next to the estimate and explicitly notes that concurrent CommandCode usage can only overcount the run. When actual exceeds estimate, the positive adjustment enters the stock brake aggregate, so an overrun larger than the remaining card budget blocks the next paid call. Missing or invalid token counts still fail closed. Mastra documents that stock `TokenCostControl` deliberately fails open when its observability query fails and exposes no strict option, so the provider fetch boundary performs the one missing custom check: it proves the stock cost aggregate is readable immediately before every reviewer and safety request and blocks the paid call if not ([installed TokenCostControl reference](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-processors-token-cost-control.md)). The runner refuses to start unless tracing, cost recording, and the start usage snapshot are live. Rates checked 11 Oct 2026: off-peak/weekend $0.15/M input, $0.60/M output, $0.003/M cache read; weekday peak (01:00–04:00 and 06:00–10:00 UTC) $0.30/M input and $1.20/M output; CommandCode publishes no separate peak cache rate.
- No human-in-the-loop in builder or reviewer. Anything needing Todd parks the card with a visible reason.
- Park visibility: post one safe, idempotent line to the Linear card after local state is saved.
- Scorers: passive recorder only. Model choice by an escalation ladder, authorized up front on the card. The stock permanent summary log is the run ledger.
- Delivery order for this machine card is independent review, green CI and Todd's technical acceptance of the evidence packet, then merge. Household UAT is not applicable. Reviewers and automated runners never merge.
- No arbitrary caps. The 12 Oct reset removed the older minimal runner's 130,000-byte refusal and deleted the old controller that carried the 5-failure/500-character trimming.

## Reviewer acceptance evidence (Todd, 11 Oct)
Three pieces, retrieved and explained in plain English with where each came from:
1. A trace of one review: what it read, what the model did, tokens and cost per step.
2. Working memory: Todd's standing rules on the reviewer's notepad, and a review visibly applying one.
3. Semantic memory: a second review retrieving something relevant from the first, with the match shown.
Shown first in a free end-to-end run with a stand-in model, then on the real reviews of #282 and #287. The free proof also verifies one correct permanent summary per run, the brake total equals the sum of cost records (including the safety check), and stock 14-day retention deletes only traces while summaries, cost records, and memory remain. It runs locally and in CI.

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

Stock Mastra was checked first. Final structured output was rejected because the
Step 3b provider route does not enforce it. Schema-based working memory was
checked and rejected: its resource scope spans reviews, it conflicts with the
reviewer's existing template-mode standing-rules memory, and an update replaces
whole arrays rather than durably recording independent per-run pieces. Built-in
task tools and workflow snapshots were also checked: they model task state and
workflow execution, not schema-parametric report assembly or the unchanged
runner verdict. Stock `createTool` schemas and Mastra's tool-error-to-model loop
remain the validation and recovery boundary; only durable piece storage and
assembly are custom ([installed tools guide](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-agents-tools.md), [installed `createTool` reference](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-tools-create-tool.md), [installed structured-output guide](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-agents-structured-output.md), [installed working-memory guide](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-memory-working-memory.md)). Any agent and any tool-calling model can use the engine; a new model must pass the opt-in probe before use. During reset this is enforced by the local execution refusal plus the full-suite offline recorder probe; removing the refusal for a different model requires a model-specific opt-in result.

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
| Replaced-route leftovers | shared candidate/check helpers in `scripts/julia-minimal-runner*.mjs`; historical `ops/julia-runner/run-reviewer.mjs` | Stage one deleted the direct reviewer files and fallback, the retired graph controller and harness, and the minimal runner's 130 KB review refusal. Shared candidate/check helpers remain because the adapted runner imports them. OVH seat/dropbox machinery remains for the separately ordered OVH retirement step and is not a reviewer fallback. |

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
| Remove | Storage-backed paid-call brake | Delete `TokenCostControl`, `requireCostStoreReadable`, the pre-call DuckDB aggregate probe, cross-run/card `runTotals` gating, and their contract/free-proof assertions. Replace them in the same change with the preconfigured per-run hard budget ledger; do not leave both brakes active. |
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
7. OVH cancellation after the reviewer is proven.
8. Smaller cleanups: confirm the cost ceiling from a real run; revoke stale 1Password service accounts; investigate JUL-196's stall. The old graph controller is deleted and stale PR #184 has its closure reason recorded.
