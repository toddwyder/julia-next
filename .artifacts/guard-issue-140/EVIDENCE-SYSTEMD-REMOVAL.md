# Issue #140 repair: prove the Mastra schedule, remove the systemd duplicate trigger

Commands and results for the local repair that (1) proves the Mastra scheduled workflow
reliably reaches the configured DuckDB prune target and (2) removes the duplicate systemd
retention trigger. Nothing was pushed, deployed, or run against a live service, database,
credential, or systemd unit. Source, tests, installer and docs only.

## 1. Proof: the framework schedule reaches the DuckDB prune target

New test `ops/factory/app/observability-retention-schedule.test.mjs` is a real framework
integration test, not a string match. It uses the real `Mastra`, the real exported
`observabilityRetentionWorkflow`, the real `Scheduler` that `startWorkers()` auto-injects,
`InMemoryStore` and `EventEmitterPubSub`, and it drives a real due-schedule fire:

- `startWorkers()` registers the declarative schedule row `wf_observability-retention` with
  the production cron `0 4 * * *` (target type `workflow`, status `active`, a computed
  `nextFireAt`).
- The scheduler the framework started reports `isRunning === true`.
- Forcing the row due and ticking the real scheduler fires the workflow; the event processor
  runs the step, and the configured prune target is called exactly once.
- The composed production storage (`composeStorageWithObservability`, the app's real storage
  shape) delegates the `schedules` domain to the default storage, so the scheduler finds it.
- The app entry `src/mastra/index.ts` configures the scheduled step with the real DuckDB
  store (`observabilityDuckDB.prune` + documented `CHECKPOINT`), and no longer wires the
  removed route.
- The generated production server (`@mastra/deployer/dist/server/index.js`, the pinned
  deployer the build uses) calls `startWorkers()`, the entry point this test exercises.

Because the app's TypeScript imports local modules with `.js` specifiers (bundler
resolution), Node's built-in type stripping needs a resolver that maps `./x.js` to `./x.ts`.
That is `ops/factory/app/typescript-esm-loader.mjs` + `register-typescript-esm.mjs`, using
Node's built-in `module.register` hook -- no new dependency, no build step. CI now runs both
app retention tests with it.

### Red -> green (TDD)

Removing `schedule: { cron: OBSERVABILITY_PRUNE_CRON }` from `observability-retention.ts`
turns the scheduled proof red, and restoring it turns it green:

```
# schedule removed
not ok 1 - startWorkers() registers the workflow declarative schedule with the production cron
not ok 2 - the scheduler the framework starts is running after startWorkers()
not ok 3 - a due schedule fires the workflow, and its step reaches the configured prune target
not ok 4 - the scheduled step reports the real prune result and records a trigger
# tests 7 / pass 3 / fail 4

# schedule restored (shipped)
# tests 7 / pass 7 / fail 0
```

## 2. Removal: only the systemd duplicate trigger

Removed (`git rm`):

- `ops/factory/julia-factory-trace-retention.service`
- `ops/factory/julia-factory-trace-retention.timer`
- `ops/factory/trace-prune-request.mjs` and its test (the unit's ExecStart)
- `ops/factory/app/src/mastra/observability-retention-route.ts` and its registration in
  `src/mastra/index.ts` (the signed `/julia/run-retention` door the unit called)

Kept: every unrelated systemd unit (`julia-factory-monday-note.{service,timer}`,
`julia-factory-wait-alerts.{service,timer}`), and the read-only diagnostic
`ops/factory/trace-retention.mjs`. The diagnostic is not a trigger -- nothing schedules it --
so it stays as a hand-run size check.

Installer updated: `install-monday-note.sh` no longer installs the retention units or writes
`/etc/julia-factory-retention/secret.env`; `install.sh` no longer copies `trace-prune-request.mjs`.
`README.md` describes the Mastra schedule as the only trigger, with updated operator steps.

## 3. Full relevant suite (green, local)

```
# CI document/policy list (with #140)
node --test scripts/agent-docs.test.mjs scripts/line-endings.test.mjs \
  scripts/no-personal-paths.test.mjs scripts/merge-pr.test.mjs \
  scripts/publish-pr.test.mjs scripts/publish-pr.real-git.test.mjs \
  scripts/publish-via-github-app.test.mjs ops/factory/workflows.test.mjs \
  ops/factory/skills.test.mjs ops/factory/monday-note.test.mjs \
  ops/factory/monday-note-run.test.mjs ops/factory/monday-note-adapters.test.mjs \
  ops/factory/monday-note-units.test.mjs ops/factory/mastra-traces.test.mjs \
  ops/factory/factory-cards.test.mjs ops/factory/trace-retention.test.mjs
# tests 130 / pass 130 / fail 0

# Application/installation list
node --test scripts/health-route.test.mjs scripts/dynamic-route.test.mjs \
  scripts/web-app.test.mjs scripts/framework-lint.test.mjs \
  scripts/personal-paths.test.mjs ops/factory/install.test.mjs
# tests 46 / pass 30 / fail 0 (16 skipped: environment-dependent)

# App TypeScript retention tests (CI command)
(cd ops/factory/app && node --experimental-strip-types --import ./register-typescript-esm.mjs \
  --test observability-retention.test.mjs observability-retention-schedule.test.mjs)
# tests 21 / pass 21 / fail 0

npm run check --prefix ops/factory/app   # tsc --noEmit: clean
npm run lint:framework                   # graph/langgraph does not exist yet; passing.
bash -n ops/factory/install.sh ops/factory/install-monday-note.sh   # ok
node --check on the changed .mjs files                              # ok
```

The app dependencies were installed offline (`npm ci --offline` in `ops/factory/app`)
solely to run the real framework test and `tsc`; `node_modules` is gitignored and not
committed.

## What this repair does, and does not, claim

- Claimed: with the pinned `@mastra/core` the framework registers the retention schedule
  from the workflow declaration and fires it into the configured prune target; the composed
  production storage exposes the `schedules` domain; the generated server calls
  `startWorkers()`; the systemd duplicate trigger and its route/program are removed; the
  read-only diagnostic is kept and is not scheduled.
- **NOT claimed:** the prune was not run against the live server DuckDB file, no deploy
  happened, and the byte cap is not live-measured. Live verification remains an operator step
  after deploy, as before.
