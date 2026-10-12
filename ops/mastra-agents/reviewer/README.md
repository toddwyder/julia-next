# Mastra review-only agent

The review-only laptop runner starts this worker with the per-card reviewer
configuration (default: CommandCode `deepseek/deepseek-v4.1-flash`). It reads
candidate files lazily through immutable, read-only Git tools and records the
review as small validated pieces. Repository code assembles those pieces into
the unchanged delivery-runner report and passes it through the same
`checkedReview` gate before it can become durable.

Run it only through the established 1Password launcher, with
`COMMANDCODE_API_KEY` resolved in its child environment:

```powershell
npm test
npm run review
```

The worker keeps one private `julia-reviewer` resource and one thread per review.
Resource-scoped working memory is seeded from the design document's standing
rules; resource-scoped semantic recall uses LibSQL vectors and local FastEmbed.
Observational memory is intentionally disabled.

LibSQL retains message history, resource-scoped working memory, and vectors. The
stock composite store routes the complete observability domain—traces,
metrics/cost records, and logs—to one local DuckDB file. DuckDB span retention
is `maxAge: '14d'`; metrics and logs have no retention policy and LibSQL memory
stays outside pruning. Every completed or stopped run emits one structured
`mastra reviewer run summary` record through Mastra's stock observability logger.
CommandCode's provider page exposes no reasoning-effort setting, so both model
roles record effort as `not-supported`. Both databases persist after every run.

The recording engine exposes tools to record, replace, remove and inspect
missing pieces, plus a submit tool. Every accepted piece is atomically written
under the run's verdict recording directory. Submit assembles and validates the
existing envelope and writes the verdict; interrupted progress remains available
and technical failures name the accepted piece keys.

The runner supplies a unique verdict path and run ID. At the existing provider
transport boundary, the worker fsyncs and atomically renames each exact raw
model response to a path containing the run ID and candidate commit before
Mastra parses its tool calls. The last response remains there. Malformed tool
JSON or schema input is returned by Mastra to the model for correction and is
never a verdict. After each accepted piece the worker also refreshes a durable
technical-failure sidecar naming every accepted key; successful submission
removes it. A submitted report is written and emitted as the model's verdict
before memory, observability, or storage finalization can run.

Run `npm run retention -- <storage-directory>` from the laptop's external daily
scheduler. The command is deliberately separate from reviewer startup and
shutdown. Install that scheduler target only from the merged checkout after
Todd's preview UAT, so the pre-merge branch cannot leave a task pointing at a
disposable worktree.

## Mastra framework map

| Need | Stock feature or checked gap | Pinned docs page |
| --- | --- | --- |
| Small report calls and recoverable input errors | Stock `createTool` input schemas and the agent tool loop return fixable validation failures to the model; custom code is limited to durable per-run piece storage and deterministic assembly because Mastra has no stock report recorder | `references/docs-agents-tools.md`; `references/reference-tools-create-tool.md` |
| Rejected final-output alternatives | Provider structured output is not enforced on this route; schema working memory is cross-review resource state, conflicts with the standing-rules template, and replaces whole arrays | `references/docs-agents-structured-output.md`; `references/docs-memory-working-memory.md` |
| Durable reviewer notepad | Resource-scoped working memory and `updateWorkingMemory()` | `docs/memory/working-memory.md` |
| Cross-review retrieval | Resource-scoped semantic recall, `LibSQLVector`, local `fastembed` | `docs/memory/semantic-recall.md` |
| No observational memory | OM is thread-oriented and resource scope is deprecated | `docs/memory/observational-memory.md` |
| Complete local traces | `MastraStorageExporter`, `includeInternalSpans: true`, `SensitiveDataFilter` | `docs/observability/tracing/overview.md`; `reference/observability/tracing/processors/sensitive-data-filter.md` |
| Complete traces and persistent cost metrics together | Stock DuckDB observability domain and stock `MetricsContext.emit(..., { costContext })`; every token-priced record is labeled `estimated` | `integrations/databases/duckdb.md`; `docs/observability/metrics/overview.md`; `reference/observability/metrics/automatic-metrics.md`; installed `observability/types/metrics.d.ts` |
| $1 per-card brake | `TokenCostControl`, card ID carried as `userId` trace metadata; estimated token cost is reconciled upward from the machine-wide `/alpha/usage/summary` actual delta | `reference/processors/token-cost-control.md`; [CommandCode pricing, checked 2026-10-11](https://commandcode.ai/docs/resources/pricing-limits) |
| Safe short-lived shutdown | `memory.settled()`, observability `flush()`, then storage `close()` | `reference/memory/settled.md`; `docs/observability/overview.md` |
| Span-only 14-day retention | DuckDB retention on `observability.spans`; omitted metrics/log policies keep them forever; `npm run retention -- [storage-directory]` is the external scheduler target that calls stock `prune()` | `reference/storage/retention.md` |
| Stock domain routing | `MastraCompositeStore` routes the complete observability domain to `DuckDBStore.observability` | `reference/storage/composite.md`; `integrations/databases/duckdb.md` |
| Permanent summary | `loggerVNext.info()` at the documented `info` minimum level, exported by `MastraStorageExporter`; summary includes estimated, actual (possible safe overcount), and brake cost; CommandCode exposes no effort option | `reference/observability/tracing/configuration.md`; `docs/observability/logging.md`; [CommandCode provider page](https://commandcode.ai/docs/byok) |
