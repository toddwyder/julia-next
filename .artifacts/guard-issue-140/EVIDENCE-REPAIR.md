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
# tests 76 / pass 76 / fail 0
```

CI's exact test list (with the #140 additions) passes 99 / 0:

```
node --test scripts/agent-docs.test.mjs scripts/line-endings.test.mjs \
  scripts/no-personal-paths.test.mjs scripts/merge-pr.test.mjs \
  scripts/publish-pr.test.mjs scripts/publish-pr.real-git.test.mjs \
  scripts/publish-via-github-app.test.mjs ops/factory/workflows.test.mjs \
  ops/factory/skills.test.mjs ops/factory/monday-note.test.mjs \
  ops/factory/monday-note-run.test.mjs ops/factory/monday-note-adapters.test.mjs \
  ops/factory/monday-note-units.test.mjs ops/factory/mastra-traces.test.mjs \
  ops/factory/factory-cards.test.mjs ops/factory/trace-retention.test.mjs
# tests 99 / pass 99 / fail 0
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

## Finalisation (this change)

- The app retention test (`ops/factory/app/observability-retention.test.mjs`) is
  TypeScript and was being invoked with `--import tsx`, a tooling dependency the
  repository does not have. No dependency was added. It now runs the way CI
  already runs the sibling app test: `node --experimental-strip-types --test`
  (Node's built-in type stripping). CI's `Run Factory sandbox isolation tests`
  step runs both app tests, after `npm ci --prefix ops/factory/app`.
- `ops/factory/workflows.test.mjs` guards that CI runs that test and never uses
  `--import tsx`.
- The stale retention guard in `ops/factory/trace-retention.test.mjs` asserted
  the entry did **not** configure DuckDB retention. The shipped repair wires it
  (`app/src/mastra/observability-store.ts` + `app/src/mastra/observability-retention.ts`,
  composed in `app/src/mastra/index.ts`), so the test now asserts the wired
  `retention: DEFAULT_RETENTION` and the scheduled `prune()`.
- Generated `mastra build` output is no longer committable:
  `ops/factory/app/.mastra/` and `ops/factory/app/src/mastra/public/factory/`
  are gitignored, and the personal-path scanner skips `.mastra` build output.
- `julia-factory-trace-retention.service` now sets
  `MASTRACODE_DUCKDB_RETENTION=1`, matching the wired source; a deploy that has
  not shipped the retention code sets it back to 0.

Commands run and their results:

```
node --test <CI list: 16 files>          # tests 105 / pass 105 / fail 0
node --test <second CI app list>         # pass 25 / fail 0 / skipped 16
node --experimental-strip-types --test ops/factory/app/observability-retention.test.mjs
                                         # tests 7 / pass 7 / fail 0
node --experimental-strip-types --test ops/factory/app/local-sandbox.test.mjs
                                         # tests 3 / pass 3 / fail 0
npm run check --prefix ops/factory/app   # tsc --noEmit, exit 0
npm run lint:framework                   # passing
```

## What this repair does, and does not, claim

- Claimed: the adapters, trace reader, card reader, entrypoint, retention check
  and systemd units are real and unit-tested with controlled fakes (fake HTTP /
  fake psql / fake adapters). No live GitHub, Discord, database or DuckDB call
  was made.
- NOT claimed: delivery or retention were live verified. No Discussion was
  posted, no phone notification sent, no DuckDB file measured on the server.
- Retention is honest: the source wires the supported bound -- the DuckDB
  observability domain is constructed with `retention: DEFAULT_RETENTION`
  (`app/src/mastra/observability-store.ts`) and pruned on a daily cron
  (`app/src/mastra/observability-retention.ts`). It is **not live-verified**: no
  deploy has run the prune against the server's file in this change. The
  read-only check still measures the real DuckDB file + WAL and fails closed
  when over budget or when the deployed process has not declared the retention
  in place.
- Official docs for the supported path:
  [Storage](https://mastra.ai/docs/storage) and
  [Scheduled workflows](https://mastra.ai/docs/workflows/scheduled-workflows).
- The exceptions-list row for #140 is marked **proposed; awaiting Todd's
  approval**. No row was added or removed.
