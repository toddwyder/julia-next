# Issue #140 repair evidence

Commands and results for the second local source/test/docs repair. Nothing was
pushed, no Discussion posted, no notification sent, no live service, credential
or database touched.

## Effective provider/model and cost

- Runner: Pi/DeepSeek Flash (per the task). The session ran locally; the harness
  reports no per-run token or dollar figure to this process, so **no cost figure
  is claimed**. The trace-cost values in the tests are fixtures, not live spend.
  Provider/model for the build agent, as declared by the task's harness, is
  `deepseek/deepseek-flash`; no independent billing measurement is available
  here, so none is asserted.

## Full relevant suite (green)

```
node --test scripts/agent-docs.test.mjs scripts/line-endings.test.mjs \
  scripts/no-personal-paths.test.mjs ops/factory/*.test.mjs
# tests 107 / pass 107 / fail 0
```

CI's exact test list (with the #140 additions) passes 130 / 0:

```
node --test scripts/agent-docs.test.mjs scripts/line-endings.test.mjs \
  scripts/no-personal-paths.test.mjs scripts/merge-pr.test.mjs \
  scripts/publish-pr.test.mjs scripts/publish-pr.real-git.test.mjs \
  scripts/publish-via-github-app.test.mjs ops/factory/workflows.test.mjs \
  ops/factory/skills.test.mjs ops/factory/monday-note.test.mjs \
  ops/factory/monday-note-run.test.mjs ops/factory/monday-note-adapters.test.mjs \
  ops/factory/monday-note-units.test.mjs ops/factory/mastra-traces.test.mjs \
  ops/factory/factory-cards.test.mjs ops/factory/trace-retention.test.mjs \
  ops/factory/trace-prune-request.test.mjs
# tests 130 / pass 130 / fail 0
```

Also:

```
node --test scripts/health-route.test.mjs scripts/dynamic-route.test.mjs \
  scripts/web-app.test.mjs scripts/framework-lint.test.mjs scripts/personal-paths.test.mjs \
  ops/factory/install.test.mjs
# pass 29 / fail 0 (16 skipped: environment-dependent)
npm run lint:framework
# graph/langgraph does not exist yet; passing.

node --check on every .mjs under scripts/ and ops/  -> status 0
bash -n install.sh install-monday-note.sh           -> status 0
node --experimental-strip-types --check on the app retention, route and entry
  TS files -> status 0 (syntax only; the type-checked app test needs npm ci)
```

## Guard reverts (red -> shipped green)

`bash .artifacts/guard-issue-140/run-guards-2.sh` prints the red/green pairs; the
captured run is `GUARD-EVIDENCE-2.txt`.

| Module | Guard (module removed) | Shipped |
|---|---|---|
| `mastra-traces.mjs` | fail 1 | 12 pass |
| `monday-note-adapters.mjs` | fail 1 | 8 pass |
| `factory-cards.mjs` | fail 1 | 5 pass |
| `monday-note-run.mjs` | fail 1 | 12 pass |
| `trace-retention.mjs` | fail 1 | 15 pass |
| `trace-prune-request.mjs` | fail 1 | 5 pass |
| `monday-note.mjs` | fail 1 | 25 pass |

Docs guard: the exceptions/test guard now asserts the #140 row is **approved by
Todd and cites GitHub #140**; reverting the README row to "proposed" makes
`scripts/agent-docs.test.mjs` red, and the shipped README is green.

## What this repair fixes, against the review

1. **Discussion body.** `buildMondayNote` now writes every card step into the
   returned `body` (indented under the card line), each with its Factory/person
   actor and the step's own time when Factory recorded one, under a card line
   that carries the card cost (failed attempts included) and the total elapsed.
   Tests assert `note.body`, not the metadata.
2. **Backfill.** `completedWeeks` lists every full Monday-to-Monday week since
   switch-on; `runMondayNoteBackfill` publishes each missing week (oldest first,
   bounded per invocation), using the GitHub Discussion title as the dedupe
   cursor. `find` pages through every discussion so an older note is still found.
   Todd is notified once per invocation, never once per week; a re-run with
   nothing missing posts and notifies nothing. Outage/backfill, duplicates and
   batch-continuation are tested.
3. **Retention byte budget.** Mastra `prune()` is age-based and never reclaims
   disk, so it cannot enforce a byte cap; the guard does. Over budget it applies
   a tighter supported `maxAge` (`PruneOptions.retention`) then the documented
   DuckDB `CHECKPOINT`, and fails closed when free disk is below the checkpoint
   headroom (1.2x + 256 MB, the installed code-sdk formula) or when the store is
   still over budget. No direct DB delete anywhere.
4. **Systemd route.** `julia-factory-trace-retention.service` now runs
   `trace-prune-request.mjs`, which signs an empty body with a root-owned secret
   and POSTs to the app's signed `/julia/run-retention` route; the running app
   runs the real supported prune + checkpoint. The unit no longer runs the
   read-only checker and no longer sets `MASTRACODE_DUCKDB_RETENTION`.
5. **Fail closed on cost.** `normalizeTraceSpans` marks `costBearing` from the
   span type/`costContext`; `assertCostsAreCorrelated` fails on any cost-bearing
   span missing correlation or a numeric cost, including uncorrelated spans, and
   treats an unlabelled span as cost-bearing. Numeric `0` stays valid.
6. **Standards/docs.** The exceptions-list #140 row reads **approved for GitHub
   #140 (Todd, 2026-09-30)**. The framework map adds official links for GitHub
   Discussions GraphQL, the Discord webhook, and Mastra retention / scheduled
   workflows / reclaiming disk. The issue evidence map is to be posted by the
   coordinator; this file performs no external write.
7. **Corrected false evidence.** The stale tests that asserted the DuckDB store
   was unbounded, that an uncorrelated no-cost span was reported as `$0.00`, and
   that the systemd unit ran only the checker were rewritten to the shipped
   behaviour.

## What this repair does, and does not, claim

- Claimed: the note generation (body + backfill), the trace reader, the card
  reader, the entrypoint, the retention guard and the systemd route are real and
  unit-tested with controlled fakes (fake HTTP / fake psql / fake adapters /
  fake store). Syntax, framework lint and the full JS suite pass locally.
- **NOT claimed:** delivery and retention are **not live-verified**. No
  Discussion was posted, no phone notification sent, no DuckDB file measured on
  the server, and no `npm ci`/`tsc`/`mastra build` was run in this environment
  (no installed `node_modules`; CI performs those). The app retention test is
  syntax-checked here and runs for real in CI after `npm ci`.
- Retention acceptance is deliberately **not** claimed: the byte cap is the
  guard's designed behaviour, and whether it holds on the 1.7 GB/10 h server
  store is a live measurement an operator makes after deploy. The guard fails
  closed rather than reporting a false all-clear.
- Official docs for the supported path:
  [Storage / retention](https://mastra.ai/docs/storage),
  [Scheduled workflows](https://mastra.ai/docs/workflows/scheduled-workflows),
  [GitHub Discussions GraphQL](https://docs.github.com/en/graphql/reference/objects#discussion),
  [Discord webhook execute](https://discord.com/developers/docs/resources/webhook#execute-webhook).
