# Factory exceptions and installation

## Exceptions list

Every custom piece is recorded here; only Todd adds or removes an entry.

| # | Exception | Gap it fills | Remove when |
|---|---|---|---|
| 1 | WorkOS cookie identity fix | Self-hosted sign-in gap | Mastra fixes it |
| 2 | Factory wait watcher and Discord webhook | Factory has no phone/desktop alert | Factory adds alerts |
| 3 | Safe sandbox retirement evaluator and cleanup | Factory leaves completed local-sandbox workspaces | Factory provides safe lifecycle cleanup |
| 4 | **Proposed, awaiting Todd's approval (#211):** structured issue-cost snapshot | Retention needs a durable issue-cost ledger | Factory provides one |

## Framework map

| Need | Framework feature | Local source |
|---|---|---|
| Bound DuckDB storage | `DuckDBStore` retention and `prune()` | `@mastra/duckdb`; `app/src/mastra/observability-retention.ts` |
| Scheduled retention | Mastra declarative workflow schedule | `app/observability-retention-schedule.test.mjs` |
| Byte budget | supported retention plus DuckDB `CHECKPOINT` | `ops/factory/trace-retention.mjs` |
| Default retention | `DEFAULT_RETENTION` | `@mastra/code-sdk` `storage-maintenance` |

The supported retention path is wired in `app/src/mastra/observability-store.ts` and
`app/src/mastra/observability-retention.ts`. It is the only prune trigger: there is no systemd
retention unit. The guard measures `observability.duckdb` and its WAL, never deletes rows directly,
and fails closed when safe reclamation cannot be established. See
`docs/research/mastra-intended-use-audit.md` for the framework audit.

## Installation

Run the reviewed installer as the authorized operator:

```sh
bash /path/to/julia-next/ops/factory/install.sh /var/lib/julia-factory/app
```

The installer copies app sources and Factory plan/review skill overrides, preserves service secrets
and runtime data, runs `npm ci`, typecheck and build, restarts the service, and verifies `BUILD_COMMIT`.
Factory 0.19.1 loads project-local `factory-skills` before bundled skills.

## Bounded trace storage

Mastra retention uses `DEFAULT_RETENTION` and the app's daily scheduled workflow. The read-only
`ops/factory/trace-retention.mjs` checker measures the real DuckDB artifact; it does not delete
data. No custom weekly reporting timer or notification service remains.
