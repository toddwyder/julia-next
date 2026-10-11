# 0011. Keep durable Mastra reviewer records in stock storage

Date: 2026-10-11

Status: accepted

The Mastra reviewer keeps two local databases. Its stock DuckDB observability store contains full
traces, cost metrics, and one permanent stock-log summary line for every run. Its LibSQL store
contains reviewer message history, resource-scoped working memory, and resource-scoped semantic
recall. The reviewer does not use observational memory and does not route individual storage
methods through a custom adapter.

DuckDB retention applies only to observability spans, with `maxAge: '14d'`. A scheduled stock
`storage.prune()` call deletes eligible spans. No retention policy applies to metrics, logs, run
summaries, or LibSQL memory, so those records are kept permanently. Pruning is never an end-of-run
cleanup step and does not promise to shrink the DuckDB file.

Each run emits exactly one human-readable summary line through stock Mastra logging. It records the
card, change, round, verdict or stop and reason, reviewer and safety-check model/effort, input and
output tokens, the published-price estimate, the machine usage-summary actual cost (marked as a
safe possible overcount), the cost used by the brake, start and end time, and both database sizes. These fields make the durable log
the UAT record; traces remain diagnostic evidence rather than a prerequisite for understanding a
run's outcome.

This uses the installed Mastra storage retention contract, whose unset domains and tables are kept
forever and whose DuckDB adapter supports observability retention. It also follows the installed
observability storage exporter and logging facilities instead of introducing a reviewer-specific
record format or storage router.
