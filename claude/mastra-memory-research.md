# Mastra memory and observability: what the docs say (11 Oct 2026)

Source: Mastra's own docs bundled in @mastra/mcp-docs-server 1.3.5 (pinned to @mastra/core 1.75.0, our version). Research run by a cheap model; key claims re-checked by Claude against the doc text. Paths are under `.docs/` in that package.

## Verified findings
1. **Observational memory (OM) works within one conversation (thread), not across conversations.** Cross-conversation OM ("resource scope") is deprecated and will be removed. For cross-conversation memory the docs say: resource-scoped working memory for small durable facts, plus retrieval mode or semantic recall. (`docs/memory/observational-memory.md`, "Resource scope (deprecated)")
2. **OM only starts writing notes after about 30,000 tokens of conversation** (default `observation.messageTokens`). A single short review may never trigger it. (same page, "Observations")
3. **OM and working memory overlap.** Docs recommend one or the other; running both "adds latency and token cost without much benefit." OM is described as cheaper and more accurate than semantic recall. (`docs/memory/multi-user-threads.md`; `observational-memory.md`, end)
4. **Memory is meant to persist.** Cleanup is age-based (`retention` + `storage.prune()`), run from a scheduler, "not from application startup or shutdown hooks." Pruning does not shrink the file. (`reference/storage/retention.md`)
5. **LibSQL cannot store cost/metric records.** Metrics need DuckDB (recommended for local), ClickHouse, Postgres VNext or in-memory. Documented fix: route only the observability domain to DuckDB. Without it, anything reading cost metrics (the TokenCostControl spending brake) sees nothing. (`docs/observability/metrics/overview.md`)
6. **Internal steps are dropped from traces unless `includeInternalSpans: true`.** (`docs/observability/tracing/overview.md`)
7. **Short-lived process shutdown:** `await memory.settled()` (waits for background memory work), `await mastra.observability.flush()`, then close storage. The docs do not state the order between flush and close; flush first is our reading. (`reference/memory/settled.md`, `docs/observability/overview.md`)

## Other useful points (from the research report, not re-checked)
- Semantic recall: LibSQL vector store supported; FastEmbed documented (`@mastra/fastembed`); scope thread or resource. Verify with `memory.recall({ vectorSearchString })`; recalled messages appear in traces.
- Working memory: template (whole replace) or schema (merge); resource scope default; seed with `memory.updateWorkingMemory(...)`. Docs conflict on what `readOnly` blocks; verify before relying on it.
- No built-in "delete a card's traces after its retro"; retention is age-only, so that would be custom.
- Nothing documented about LibSQL file locking on Windows.
