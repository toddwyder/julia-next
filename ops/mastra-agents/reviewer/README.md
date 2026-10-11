# Mastra review-only agent

The review-only laptop runner starts this worker with the per-card reviewer
configuration (default: CommandCode `deepseek/deepseek-v4.1-flash`). It reads
candidate files lazily through immutable, read-only Git tools, returns a
structured verdict, and preserves the runner's quote validation.

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

LibSQL retains message history, working memory, vectors, and traces. A narrow
observability-domain adapter sends only metric methods to a second local DuckDB
file because Mastra's documented composite store routes the entire observability
domain and cannot route individual signals. `TokenCostControl` reads that DuckDB
store at the $1-per-card scope. Both databases persist after every run.

The runner supplies a unique verdict path. The worker writes and emits the
verdict before waiting for memory, flushing observability, and closing storage;
shutdown failures are warnings and cannot replace the saved verdict.

## Mastra framework map

| Need | Stock feature or checked gap | Pinned docs page |
| --- | --- | --- |
| Durable reviewer notepad | Resource-scoped working memory and `updateWorkingMemory()` | `docs/memory/working-memory.md` |
| Cross-review retrieval | Resource-scoped semantic recall, `LibSQLVector`, local `fastembed` | `docs/memory/semantic-recall.md` |
| No observational memory | OM is thread-oriented and resource scope is deprecated | `docs/memory/observational-memory.md` |
| Complete local traces | `MastraStorageExporter`, `includeInternalSpans: true`, `SensitiveDataFilter` | `docs/observability/tracing/overview.md`; `reference/observability/tracing/processors/sensitive-data-filter.md` |
| Persistent cost metrics | DuckDB observability storage and automatic span-derived metrics; CommandCode's `usage.cost.total` is carried as provider-reported cost because the embedded registry has no exact CommandCode/model entry | `integrations/databases/duckdb.md`; `docs/observability/metrics/overview.md`; `reference/observability/metrics/automatic-metrics.md` |
| $1 per-card brake | `TokenCostControl`, card ID carried as `userId` trace metadata | `reference/processors/token-cost-control.md` |
| Safe short-lived shutdown | `memory.settled()`, observability `flush()`, then storage `close()` | `reference/memory/settled.md`; `docs/observability/overview.md` |
| No end-of-run deletion | Persistent storage; age-based scheduled retention is the later stock option | `reference/storage/retention.md` |
| Metrics-only database split | No stock per-signal router exists; documented composite routing is domain-wide | `docs/observability/overview.md`; `integrations/databases/duckdb.md` |
