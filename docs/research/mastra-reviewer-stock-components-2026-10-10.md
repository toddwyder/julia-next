# Mastra reviewer stock-components findings â€” 2026-10-10

## Scope and version boundary

This note answers the production-reviewer questions in the JUL-206 handoff: local
Memory/LibSQL, FastEmbed and processors, trace context, and `TokenCostControl`.
It uses only Mastra-maintained documentation or the upstream Mastra repository.
The current reviewer spike pins `@mastra/core` `^1.75.0`, `@mastra/libsql`
`^1.25.1`, and `@mastra/observability` `^1.18.4`
([package manifest](../../ops/mastra-agents/reviewer/package.json)). The public
docs describe the current release, so package API names and behaviour must be
rechecked against the locked versions before an implementation pins new packages.

## Findings and implications

1. **Use a dedicated file-backed `LibSQLStore` and an explicit store ID for reviewer
   history.** Mastra's Memory quickstart requires a storage provider and shows
   `new LibSQLStore({ id, url })` installed on the Mastra instance, then a `Memory`
   instance attached to the agent. It specifically calls out adding the `id`.
   [Memory overview](https://mastra.ai/docs/memory/overview). The reviewer should
   therefore own a separate, reviewer-only database path and stable store ID; it
   must not reuse a builder store, path, resource ID, or thread ID. This is a
   production isolation convention inferred from the documented sharing model:
   calls with the same resource and thread share data, and resource-scoped memory
   can persist across threads. [Memory overview: multi-agent scoping](https://mastra.ai/docs/memory/overview#memory-in-multi-agent-systems).

2. **Use a fresh, candidate-derived thread and resource for each review.** Memory
   is for multi-turn context; Mastra says to skip it for independent single turns.
   [Memory overview: when to use](https://mastra.ai/docs/memory/overview#when-to-use-memory).
   A reviewer can nonetheless use bounded message history for its internal
   multi-step loop, but its identifiers need to derive from the immutable candidate
   (for example, PR number plus head SHA) rather than from the card alone. That
   prevents a later commit or another PR from reading the earlier review. This is
   an application policy, not a stock Mastra guarantee.
   The current Memory reference also exposes `readOnly` for preview/internal
   callers that must not mutate memory; verify that option against the pinned
   package before using it as a reviewer safety control.
   [Memory class reference](https://mastra.ai/reference/memory/memory-class).

3. **Do not add FastEmbed or semantic recall unless retrieval is a stated reviewer
   requirement.** Semantic recall is the memory feature that retrieves old messages
   by meaning; ordinary message history does not require it. [Memory overview](https://mastra.ai/docs/memory/overview).
   FastEmbed is no longer implicit: Mastra's migration note says it moved to
   `@mastra/fastembed` and must be configured explicitly as an embedder.
   [Mastra 0.10 migration note](https://mastra.ai/blog/mastra-0.10).
   For this reviewer, a new candidate-specific thread has no useful corpus to
   semantically search, while the local embedding package/model introduces install,
   model-download, and lifecycle surface. The smallest stock choice is message
   history only (`lastMessages` bounded), with no `@mastra/fastembed` dependency
   and no semantic-recall processor.

4. **Let `Memory` install its standard memory processors; do not hand-assemble
   them unless there is a demonstrated need.** `MemoryInputFilter` is automatically
   added by `Memory` ahead of message history, working memory, semantic recall,
   and observational memory. It filters already-stored input so the model does not
   receive duplicated history. [MemoryInputFilter reference](https://mastra.ai/reference/processors/memory-input-filter).
   A reviewer that constructs its own prompt should test this interaction explicitly;
   `retainFullInput` is the documented opt-in for preserving an assembled sequence.

5. **Treat deletion/purge as a tested lifecycle requirement, not an assumption.**
   Mastra's March 2026 changelog says `memory.deleteThread()` and
   `memory.deleteMessages()` clean associated embeddings for supported vector
   backends, and that cleanup is non-blocking. [Changelog](https://mastra.ai/blog/changelog-2026-03-05).
   Since this reviewer should not create embeddings in the minimal configuration,
   its exit path should still delete the candidate thread and prove the isolated
   LibSQL data is gone (including on failed reviews). The exact API must be verified
   against the installed/pinned `@mastra/memory` version before relying on it.

6. **Pass explicit run identity through `RuntimeContext` and tracing options, then
   fail the runner stage if the resulting trace ID is absent.** Mastra automatically
   traces agent runs, model generations, tool calls, and workflow steps when
   observability is enabled. `runtimeContextKeys` copies selected runtime-context
   values into trace metadata, and per-request keys merge with configuration keys.
   [AI tracing: runtime-context metadata](https://mastra.ai/docs/v0/observability/ai-tracing/overview#automatic-metadata-from-runtimecontext).
   Agent results expose `traceId` only when tracing is enabled and sampled.
   [AI tracing: trace IDs](https://mastra.ai/docs/v0/observability/ai-tracing/overview#retrieving-trace-ids).
   Stock tracing can therefore carry candidate SHA, PR number, runner run ID, and
   reviewer model/provider, but it will not enforce Julia's fail-closed policy:
   the runner must check and persist the returned ID itself.

7. **Use the storage exporter and observable store before considering
   `TokenCostControl`.** `TokenCostControl` checks estimated cumulative cost before
   LLM calls and requires observability storage with `getMetricAggregate` support.
   The official guardrails guide warns that metrics persist asynchronously, so a
   fast agent may overshoot a configured limit briefly. [Guardrails:
   TokenCostControl](https://github.com/mastra-ai/mastra/blob/main/docs/src/content/en/docs/agents/guardrails.mdx#enforce-cost-limits).
   The metrics reference confirms that an observability domain is required and that
   costs can be null if cost context was not recorded.
   [Metric queries](https://mastra.ai/reference/observability/metrics/queries).
   It is a useful *secondary* stock guard, but cannot prove a hard $2 total cap.
   The runner must reserve/check its own authorized budget before launch and reject
   a result without recorded cost/trace evidence; do not interpret a processor pass
   as proof that the total cannot exceed $2.

8. **Do not use a cost-routing processor to alter the approved reviewer model.**
   Mastra's `ModelSelectionProcessor` is intentionally fail-open when its classifier
   fails and can add classifier cost plus cache misses. [ModelSelectionProcessor
   reference](https://mastra.ai/reference/processors/model-selection-processor).
   The reviewer has an explicit per-card provider/model rule, so model choice remains
   runner-owned authorization and should be supplied directly to the agent.

## Minimal stock configuration direction

For the first production reviewer, the evidence supports: a reviewer-only
file-backed `LibSQLStore` with explicit ID; `Memory` limited to message history;
candidate-SHA-scoped resource/thread IDs; `Observability` plus a persistent
observability exporter/store; and runner checks for a non-empty trace ID and
independently calculated/recorded cost. Omit FastEmbed, semantic recall,
observational memory, working memory, model-selection routing, and
`TokenCostControl` until their package-version contracts and tests are added.

This is deliberately the smallest reversible option: it relies on stock Mastra
components for storage/history and trace creation, while retaining runner ownership
of authorization, locks, exact candidate identity, and hard spend enforcement.
