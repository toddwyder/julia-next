# Mastra builder and reviewer agents: settled design and parked items

As of Sun 11 Oct 2026. This file is the source of truth for the Mastra agents. If a brief and this file disagree, this file wins. Mastra docs findings behind the 11 Oct changes: `claude/mastra-memory-research.md`.

## Where things stand
- Spike (closed PR #286) proved a Mastra agent on DeepSeek 4.1 Flash via CommandCode can use read-only tools and return a strict structured review in one run. Spike verdict on PR #282: PASS, 16 of 16 quotes verified.
- Real reviewer is in PR #287 (open). Six live attempts on 10-11 Oct were reported as reviewer-identity mismatches because the runner validated a missing observed identity before considering the worker's nonzero exit. Retained evidence separates three millisecond-scale preflight failures from three 79–139 second paid executions with storage/shutdown errors. The runner now reports nonzero worker exits as the primary failure and validates identity only for an exit-zero worker; an exit-zero missing or mismatched identity still fails closed. Earlier failures also exposed end-of-run database cleanup and missing-internal-span defects; those have regression coverage. The first 11 Oct proof attempt then showed that the AI SDK's OpenAI-compatible response schema removes CommandCode's non-standard `usage.cost` field before its metadata extractor runs. The provider transport now validates and retains raw response token usage before schema normalization, keyed by response ID, and fails closed when required token counts are missing or invalid.
- Spend limit: $1.00 per card (JUL-206 covers the #282 review; a separate $1.00 covers the #287 review). There is NO limit on the number of runs. Other runaway guards: time limits, stuck-worker rule, same step failing twice, two review rounds then park.
- PR #284 (OVH move) stays a draft, not merged. OVH VPS is cancelled only after the new reviewer is proven.
- 1Password: Julia-vault-only read_items service account, token DPAPI-protected on the laptop, unattended. Expires 6 Jan 2027 Pacific.

## Settled design
- Two Mastra agents, builder and reviewer, called as steps by the existing delivery runner. The runner owns sequence, saved state, lock, kill-orphan-workers and authorization checks.
- Look it up, don't recall it: use version-matched documentation bundled with each installed package first; otherwise use the tool's official `llms.txt` index and fetch only the applicable individual page, never `llms-full.txt`. The Mastra docs MCP server is a fallback only. Every framework-map job cites the exact page used. Custom code is allowed only after the applicable docs show the stock tool has no feature for the need, and the report records the gap.
- Models from the per-card configuration (JUL-195). Default: CommandCode `deepseek/deepseek-v4.1-flash`. Reviewer must be a different maker from the builder.
- Instructions: reviewer = `.agents/skills/adversarial-review/SKILL.md` plus CODING_STANDARDS.md. No builder role file yet; `julia-builder` still referenced in 5 legacy places.
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
- Delivery order is independent review, then Todd's UAT on the Vercel preview, then merge. Reviewers and automated runners never merge.
- No arbitrary caps. Still to remove: the 130,000-byte cap in the older minimal runner, the 5-failure/500-character trimming in the old controller.

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
assembly are custom ([installed tools guide](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-agents-tools.md), [installed `createTool` reference](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-tools-create-tool.md), [installed structured-output guide](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-agents-structured-output.md), [installed working-memory guide](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-memory-working-memory.md)). Any agent and any tool-calling model can use the engine; a new model must pass the opt-in probe before use.

The `maxSteps` budget is derived, not guessed. Reading and analysis receive
`files + criteria + 3` calls (inventory, diff and quote review included). Every
required recording/submission unit—header, two axes, every file and criterion,
five checks, two minimum counterexamples, test audit, three collection-complete
markers and submit—receives its own call plus one correction call. One final
acknowledgement is added: `3 * files + 3 * criteria + 34` (70 for the four-file,
eight-criterion retained fixture). Findings and limitations are independent
parallel tool calls and are not count-capped.

## Reset to minimum reviewer (Todd, 12 Oct 2026)

This section supersedes the 11 Oct memory, tracing, cost-brake and acceptance-
evidence decisions above. The report gate and the Step 4 recording engine stay;
the cross-review recall and full-internal-span experiment do not. This round is
design only. It made no runtime or test changes and made no provider calls.

### Incident and backup baseline

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
2,988,804,123 bytes. The active directory was not deleted or modified.

### Current file-level map

| Area | Files and current interface | Current implementation and reset consequence |
| --- | --- | --- |
| Reviewer entry and tools | `ops/mastra-agents/reviewer/src/reviewer.mjs` | Owns the worker process, immutable Git read tools, provider transport, processors, memory, telemetry, report recorder and finalization. It is currently too broad; the reset introduces one internal budget seam and one terminal-state seam without changing the runner's report schema. |
| Processors | `reviewer.mjs`; `test/free-proof.test.mjs`; `test/contract.test.mjs` | `UnicodeNormalizer`, a paid warn-only `PromptInjectionDetector`, and storage-backed `TokenCostControl` run in the input pipeline. Only deterministic normalization remains in the minimum reviewer. Candidate-as-data safety is enforced by immutable read-only tools and the prompt contract, not a second paid classifier. |
| Working, message and semantic memory | `reviewer.mjs`; `src/contract.mjs`; `package.json`; `package-lock.json`; `test/contract.test.mjs`; `test/free-proof.test.mjs`; `README.md`; runtime `traces/reviewer.db*` | One `Memory` currently combines resource-scoped template working memory, 12-message history, resource-scoped semantic recall, `LibSQLVector` and FastEmbed. The reset keeps only resource-scoped working memory containing the standing rules. Stock `messageHistory: { maxTokens: 0 }` disables history; semantic recall, vector storage, embedding and explicit saved review memories are removed. |
| Report recording and evidence | `src/recording-engine.mjs`; `src/reviewer-report.mjs`; `src/quote-check.mjs`; `test/recording-engine.test.mjs`; `test/recorded-review.test.mjs`; `test/quote-check.test.mjs`; `test/tool-input-failure.test.mjs`; `test/fixtures/repaired.json`; `support/recorded-review-interrupt-child.mjs` | This is the deep module at the report seam: small validated durable pieces, correction-shaped errors, deterministic assembly, exact quote checks and the unchanged runner envelope. It worked in the live run and stays. |
| Raw model evidence and interruption | `reviewer.mjs`; `test/raw-answer.test.mjs`; `test/fixtures/final-answer.txt`; `support/raw-answer-interrupt-child.mjs`; the recorder's progress sidecar | The exact last raw provider response is saved before parsing and accepted piece keys survive interruption. The minimum design keeps both and adds a per-run model-event journal so every prompt, reply, tool call and usage record is retained once without depending on trace internals. |
| Observability storage and retention | `reviewer.mjs`; `src/contract.mjs`; `src/retention.mjs`; `package.json` `retention` script; `test/free-proof.test.mjs`; `README.md`; runtime `traces/reviewer-costs.duckdb*` | A shared DuckDB currently stores internal spans, metrics and permanent logs with 14-day span pruning, a 1.4 GB DuckDB memory limit and a 100-event exporter batch. The reset uses a per-run telemetry database, drops internal spans and treats export, flush, logging and pruning as non-authoritative. The backed-up shared database is evidence, not an input to a new run. |
| Cost control | `src/commandcode-cost.mjs`; `reviewer.mjs`; `src/contract.mjs`; `test/contract.test.mjs`; `test/free-proof.test.mjs`; `scripts/delivery-tool-settings.mjs`; `scripts/delivery-tool-settings.test.mjs`; `scripts/julia-review-only.mjs`; `scripts/julia-review-only.test.mjs` | Provider usage is priced correctly, but stock `TokenCostControl`, a shared DuckDB aggregate, a custom pre-call readability probe and the machine-wide `/alpha/usage/summary` reconciliation are coupled. The reset keeps provider-response usage and rate calculation, but a per-run in-memory/durable ledger enforces a limit selected before the run. Telemetry is only a sink. |
| Runner and final state | `scripts/julia-review-only.mjs`; `scripts/julia-vault.mjs`; `scripts/julia-vault-windows.ps1`; `scripts/julia-delivery-runner.mjs`; `scripts/julia-delivery-review.mjs`; `scripts/julia-delivery-review-publication.mjs`; `scripts/julia-delivery-state.mjs`; their matching tests | The launcher resolves credentials and an immutable PR, the runner journals the action, the worker writes a verdict sidecar, and `checkedReview` applies the unchanged evidence gate. Today `checkedReview` turns `INCONCLUSIVE` into an error and the launcher requires a zero worker exit even after a durable verdict. The reset gives the runner one explicit terminal state to read and makes post-verdict telemetry failures warnings. |
| Replaced-route leftovers | `scripts/julia-delivery-review-transport.mjs`; `scripts/julia-commandcode-request.mjs`; their tests; the non-Mastra full-JSON text in `scripts/julia-delivery-review.mjs`; `scripts/julia-minimal-runner*.mjs`; `ops/julia-runner/run-reviewer.mjs` | The direct single-shot CommandCode path and older fixed-route reviewer still exist beside the Mastra recording route. Shared candidate/check helpers used by the active runner are not leftovers merely because their filenames say `minimal-runner`; only the old reviewer dispatch and full-report contract are. They must be deleted when the Mastra route replaces them, not wrapped in another compatibility layer. |

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
| Keep | Resource-scoped template working memory in LibSQL, read-only during a review | Serves Todd's verified standing-rules requirement. Only the short standing-rules value crosses reviews. Use stock `messageHistory: { maxTokens: 0 }`, no semantic configuration, and no call to save review messages. Files retained: the `Memory`/`LibSQLStore` parts of `reviewer.mjs`, `STANDING_RULES`, and a focused contract/free proof. |
| Keep | Provider-boundary model-event journal and usage pricing | Serves Todd's requirement to retain prompts, replies, tool calls and usage without internal span copies, and the `$1.00` per-card authorization. Keep the estimate portion of `commandcode-cost.mjs`, raw capture in `reviewer.mjs`, and tests that prove raw usage survives provider normalization. Each event is written once to the run folder. |
| Keep | Model-level observability with the stock sensitive-data filter, per-run DuckDB and best-effort summary | Serves diagnosis and the requested model-level audit without becoming an acceptance dependency. Keep `MastraStorageExporter`, default `SensitiveDataFilter`, `MODEL_GENERATION` data, bounded retention and summary tests, but point storage at the run and make all export/finalization failures warnings after a verdict. |
| Keep | Existing runner identity, candidate, publication and `checkedReview` evidence checks | Serves immutable-candidate identity, different-maker review, exact report completeness and durable publication. `checkedReview` must accept a valid `INCONCLUSIVE` as that state while still rejecting malformed content; the runner parks rather than repairs it. |
| Remove | Semantic recall and saved reviewer-message memory | Delete `LibSQLVector`, FastEmbed, `semanticRecall`, `semanticReviewMatches`, the pre-run `memory.recall`, post-run `memory.saveMessages`, semantic evidence fields, `@mastra/fastembed`, and their lockfile entries. Delete/replace the semantic tests in `test/contract.test.mjs` and the two-review semantic assertions in `test/free-proof.test.mjs`; update `README.md`. No dormant flags or empty vector adapter remain. |
| Remove | Reviewer message history | Delete `lastMessages: 12`, per-review thread history expectations and any tests claiming messages persist. Replace the setting with documented `messageHistory: { maxTokens: 0 }`; retain only the resource working-memory row in LibSQL. The implementation change starts a new working-memory-only database and removes the backed-up old `reviewer.db*` from the active runtime path in that same change. |
| Remove | Internal span export | Replace `includeInternalSpans: true` with false/omitted and delete assertions/docs requiring complete internal traces. Update `reviewer.mjs`, `README.md` and `test/free-proof.test.mjs`. The implementation starts a new per-run DuckDB and removes the backed-up `reviewer-costs.duckdb*` files from the active runtime path in the same change; it does not rewrite the backup. |
| Remove | Storage-backed paid-call brake | Delete `TokenCostControl`, `requireCostStoreReadable`, the pre-call DuckDB aggregate probe, cross-run/card `runTotals` gating, and their contract/free-proof assertions. Replace them in the same change with the preconfigured per-run hard budget ledger; do not leave both brakes active. |
| Remove | Machine-wide usage-summary reconciliation from the critical path | Delete the `/alpha/usage/summary` start/end wait and actual-adjustment write (`commandCodeUsageSummary`, `usageSummaryDelta`, `requireUsageSummaryCoverage`, `usageSummaryAfterRun`) and their tests. It can overcount concurrent work and is not needed when each provider response supplies validated usage. Provider usage remains durable model-level evidence. |
| Remove | Paid warn-only prompt-injection classifier | Delete `PromptInjectionDetector`, its safety model/connection/cost role and warning-only proof from `reviewer.mjs`, `test/free-proof.test.mjs` and README claims. It adds a paid model call but does not enforce the candidate-as-data rule; immutable tools and fixed instructions remain the enforcement. |
| Remove when replaced | Direct single-shot reviewer route and old full-JSON contract | In the implementation that makes Mastra the delivery review route, delete `julia-delivery-review-transport.mjs`, `julia-commandcode-request.mjs`, their route-only tests, the fallback branch in `julia-delivery-runner.mjs`, and the full-report output instruction in `julia-delivery-review.mjs`. Preserve shared candidate/check helpers. Do not add a compatibility wrapper. |
| Defer | Mastra workflows | Return only after two clean live reviews on two separate real changes, both accepted by the runner and both within every budget below, and only if a named runner problem remains that a workflow snapshot directly solves. Until then the existing runner owns sequence and recovery. |
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
| Model steps | 70 hard maximum | The retained four-file/eight-criterion review needs `3F + 3C + 34 = 70`, including one correction opportunity per required recording/submission unit. A review whose computed need exceeds 70 is refused before a paid call and ends `SYSTEM_ERROR`; changing the ceiling is a product decision. |
| Elapsed time | 20 minutes hard maximum | Matches the existing direct CommandCode review timeout and is far below the accidental three-hour Mastra worker cap. The runner owns the process timer; expiry is `SYSTEM_ERROR` with durable progress, never `INCONCLUSIVE`. |
| Estimated cost | `$0.50` hard maximum per review; `$1.00` remains the card maximum | Two possible review rounds fit the authorized card ceiling. Before each request, the ledger adds spent validated usage to a conservative maximum for the pending request and refuses to send if the result exceeds `$0.50`. Use peak published rates and a 4,096-token output ceiling; input is conservatively bounded from the serialized request before dispatch. All reviewer calls are included because the paid safety call is removed. |
| Database growth | 64 MiB maximum per review | Includes the per-run DuckDB plus any LibSQL growth. Internal spans are off and standing working memory should normally add no per-review messages. Measure file sizes before start and after close; exceeding the budget fails the implementation proof but cannot overturn a saved verdict. |
| Peak worker memory | 768 MiB RSS maximum | Less than half the previously measured 1.6 GB free-memory envelope and well below the failed roughly 1.3 GB process/store condition. Sample RSS through the offline proof and live-run summary. A future hard OS limit may be added only if the existing runner's process control cannot enforce it safely. |
| Disk growth | 128 MiB maximum per review and 2 GiB free-space preflight | Allows 64 MiB of databases plus 64 MiB for the raw/model-event journal, pieces, terminal state and temporary checkpoint files. The preflight refuses to start below 2 GiB free. Temporary files are removed only after their durable replacement is confirmed; retained run evidence is not silently cleaned. |

The cost preflight uses the request's UTF-8 byte length as a conservative upper
bound on input tokens, peak input/output prices, and the 4,096-token maximum
output. After a response, its validated provider token counts replace the
reservation with the calculated charge and the ledger is atomically refreshed.
Thus a broken telemetry database cannot authorize overspend and cannot block a
completed verdict.

### Stock Mastra trace setting

The stock setting is `includeInternalSpans: false` (also the default when the
field is omitted). The installed configuration reference says the flag controls
spans internal to Mastra, and the installed filtering reference states that
internal spans are dropped before `excludeSpanTypes`, output processors and
`spanFilter`. Therefore neither `excludeSpanTypes` nor a custom `spanFilter` is
needed to remove them. External model-generation spans remain available for
model-level prompt/completion/usage data; the provider-boundary journal is the
authoritative single copy of replies and tool calls.

Installed pages read for this decision:

- `ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-observability-tracing-configuration.md`
- `ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-observability-tracing-span-filtering.md`
- `ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-observability-tracing-interfaces.md`
- `ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-memory-message-history.md`
- `ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-memory-working-memory.md`

This round verified the setting by installed documentation and installed type/
implementation inspection only. It did not execute an Agent proof. The next
implementation round must use the real installed `Agent.generate()` with a
stand-in model and assert that model-level prompt, reply, tool-call and usage
records remain while no internal span or repeated growing conversation is
stored. No live or paid call is needed for that proof.

### Replace, then delete

The reset is not an additive compatibility layer. Each implementation change
must delete the code, test, dependency, setting and active runtime data it
replaces in the same commit, after the backup above is verified. In particular:
the hard ledger replaces both stock and custom DuckDB brakes; working-memory-
only storage replaces message/semantic memory; per-run model telemetry replaces
the shared full-span database; and the Mastra recording route replaces the
single-shot reviewer route. A new mechanism is not complete while its replaced
path can still execute.

## Standing rules for the reviewer (seed for working memory)
- Every quote must appear word for word in the named file or diff at the reviewed commit.
- No arbitrary caps or limits; flag any new one.
- Never ask Todd; anything needing a human parks the card with a visible reason.
- Agents never create tickets, merge, or delete.
- Prefer stock Mastra features; flag custom code that duplicates one.
- Flag missing tests and missing logging.

## Working rules for agents (this effort)
- Do not do code work without Todd's permission. Conserve tokens.
- Read this file before starting any Mastra work; it wins over a brief.
- For a root-cause analysis, work from the symptom and evidence with the diagnose-bugs skill, not from a hypothesis.
- Nothing may depend on Todd signing in repeatedly. At most one atomic account-owner approval. Never ask Todd about workspaces, branches or Git state.
- Each step ends in something Todd can see.

## Parked items, in the order they come up
1. Reviewer: build to this design, free end-to-end proof with the required retained evidence, diagnose and fix the reviewer-identity mismatch, then complete the real reviews of #282 (JUL-206) and #287 under $1.00 each. Todd performs UAT on the #287 Vercel preview before merge.
2. Runner preflight: the runner checks a card's assumptions and credentials before starting, repairs what it can, and posts stop reasons to the card.
3. Credential-list writer: the migration writer must add to `secrets.env`, not overwrite it.
4. Builder: research what Mastra gives a coding agent, small spike, build; builder role file; clean `julia-builder` references.
5. Token renewal (expires 6 Jan 2027): automatic or one tap.
6. Escalation ladder.
7. OVH cancellation after the reviewer is proven.
8. Smaller cleanups: confirm the cost ceiling from a real run; revoke stale 1Password service accounts; retire the old graph controller; close stale PR #184; investigate JUL-196's stall.
