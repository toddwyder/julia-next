# 0014. Filesystem reviewer run ledger and pre-dispatch resource budgeting

Date: 2026-10-12

Status: Proposed. Superseded on 25 October 2026: the reviewer runtime, its spend ledger, and its time, step, memory and disk bounds are deleted. Paid reviewer execution is disabled. This record is kept for history.

## Context

The previous reviewer relied on stock DuckDB observability stores and LibSQL storage. During live
execution, internal span accumulation caused DuckDB checkpoint failures, memory pressure, and
blocked provider requests.

## Decision (Agent Design Choice)

Replace reviewer telemetry and observability databases with lightweight per-run filesystem artifacts
and strict pre-dispatch resource budgeting:

1. **Filesystem artifacts:** The run directory holds exact raw model responses before parsing,
   a bounded provider-boundary model events journal (model-events.json), accepted report pieces,
   and terminal state within a 64 MiB evidence budget. There is no DuckDB or LibSQL database.
2. **Pre-dispatch spend ledger:** Before each provider request, conservative spend is reserved
   against published provider rates. Execution refuses if the pending call would exceed `$0.50`
   for the review or `$1.00` cumulative card budget.
3. **Time and step bounds:** Enforce a hard 20-minute total runtime limit (REVIEW_TOTAL_MS = 1200000),
   a configured 15-second per-step timeout (REVIEW_STEP_MS = 15000), and a derived maxSteps
   budget based on changed files and criteria (3F + 3C + 34).
4. **Memory and disk guards:** The worker enforces a 2 GiB free disk preflight, a 768 MiB RSS ceiling
   with 10 ms transient sampling, and a 128 MiB disk-growth reservation. Exceeding budgets writes
   SYSTEM_ERROR with saved progress.

## Consequences

- No external database dependencies or background checkpointing processes.
- Hard pre-call guarantees prevent runaway token cost, process memory exhaustion, and hung worker processes.
- Diagnostic evidence is self-contained in the run directory.
