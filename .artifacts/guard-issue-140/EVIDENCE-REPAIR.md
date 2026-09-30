# Issue #140 repair evidence

Commands and results for the local source/test/docs repair. Nothing was pushed,
no Discussion posted, no notification sent, no live service or database touched.

## Effective provider/model and cost

- Runner: Pi/DeepSeek Flash (per the task). The session was executed locally; no
  agent-reported token or dollar cost is available from this run, so no cost
  figure is claimed. The trace-cost figures quoted in the modules are fixtures,
  not live spend.

## Full relevant suite (green)

```
node --test scripts/agent-docs.test.mjs scripts/line-endings.test.mjs \
  scripts/no-personal-paths.test.mjs ops/factory/*.test.mjs
# tests 78 / pass 78 / fail 0
```

Also:

```
node --test scripts/health-route.test.mjs scripts/dynamic-route.test.mjs \
  scripts/web-app.test.mjs scripts/framework-lint.test.mjs scripts/personal-paths.test.mjs
# pass 25 / fail 0 (16 skipped: environment-dependent)

npm run lint:framework
# graph/langgraph does not exist yet; passing.

node --check on every .mjs under scripts/ and ops/  -> status 0
bash -n install.sh install-monday-note.sh           -> status 0
```

## Guard reverts (red -> shipped green)

`bash .artifacts/guard-issue-140/run-guards-2.sh` prints the red/green pairs;
the captured run is `GUARD-EVIDENCE-2.txt`.

| Module | Guard (module removed) | Shipped |
|---|---|---|
| `mastra-traces.mjs` | fail 1 | 9 pass |
| `monday-note-adapters.mjs` | fail 1 | 7 pass |
| `factory-cards.mjs` | fail 1 | 5 pass |
| `monday-note-run.mjs` | fail 1 | 5 pass |
| `trace-retention.mjs` | fail 1 | 8 pass |
| `monday-note.mjs` | fail 1 | 17 pass |

Docs guard: reverting `ops/factory/README.md` to the pre-repair revision makes
agent-docs tests 3, 4 and 5 red (2 pass / 3 fail); the shipped README is 5 pass /
0 fail.

## What this repair does, and does not, claim

- Claimed: the adapters, trace reader, card reader, entrypoint, retention check
  and systemd units are real and unit-tested with controlled fakes (fake HTTP /
  fake psql / fake adapters). No live GitHub, Discord, database or DuckDB call
  was made.
- NOT claimed: delivery or retention were live verified. No Discussion was
  posted, no phone notification sent, no DuckDB file measured on the server.
- Retention is honest: the repository entry configures `DEFAULT_RETENTION` only
  on the Pg/LibSQL backends, so the DuckDB observability store is **not** bounded
  by it. The check measures the real DuckDB file + WAL and fails closed when
  over budget or when no supported DuckDB retention is configured. The supported
  fix (`DuckDBStore({ retention: DEFAULT_RETENTION })` + scheduled `prune()`) is
  documented in `ops/factory/README.md`; it is not wired in this slice.
- The exceptions-list row for #140 is marked **proposed; awaiting Todd's
  approval**. No row was added or removed.
