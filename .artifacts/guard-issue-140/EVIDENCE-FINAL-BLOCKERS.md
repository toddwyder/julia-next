# Issue #140 final-blocker repair evidence

Commands and results for the third local source/test/docs repair. Nothing was
pushed, no Discussion posted, no notification sent, and no live service,
credential, database or systemd unit was touched. Source-only work.

## The two final blockers, and the fix

1. **The installer must carry the new app retention modules.**
   `ops/factory/app/src/mastra/index.ts` imports three local app modules —
   `observability-store.ts`, `observability-retention.ts`,
   `observability-retention-route.ts` — but `ops/factory/install.sh` copied only
   `index.ts` and `local-sandbox.ts`. A clean install therefore left the entry
   point with three unresolved local imports, so `npm run check` (`tsc --noEmit`)
   and `npm run build` (`mastra build`) could not resolve them.
   `install.sh` now lists the three modules, and the install test walks the
   entry's transitive local import graph and asserts every module is present in
   the installed tree, and that `check`/`build` run after the copies.

2. **The weekly report must include a card by cost/activity, not only by
   acceptance.** `buildMondayNote` filtered cards to those whose entry fell in
   the week, so a card accepted earlier but built/failed this week was dropped —
   and its this-week trace then failed the note closed as uncorrelated. Cards are
   now included when they entered the week **or** when a trace in the week names
   them; per-card cost and failed attempts are summed only from this week's
   traces; a continued card's elapsed is its in-week activity window, not its
   whole lifetime; and each card is named once per note and each trace counted in
   exactly one week.

## Full relevant suite (green)

The CI document/policy list (with the #140 additions) passes:

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
# tests 135 / pass 135 / fail 0
```

The application/installation list passes:

```
node --test scripts/health-route.test.mjs scripts/dynamic-route.test.mjs \
  scripts/web-app.test.mjs scripts/framework-lint.test.mjs \
  scripts/personal-paths.test.mjs ops/factory/install.test.mjs
# tests 46 / pass 30 / fail 0 (16 skipped: environment-dependent)
```

Also:

```
node --test scripts/agent-docs.test.mjs scripts/line-endings.test.mjs \
  scripts/no-personal-paths.test.mjs ops/factory/*.test.mjs
# tests 113 / pass 113 / fail 0
npm run lint:framework
# graph/langgraph does not exist yet; passing.
bash -n ops/factory/install.sh                       -> status 0
node --check ops/factory/monday-note.mjs \
  ops/factory/install.test.mjs ops/factory/monday-note.test.mjs -> status 0
node --experimental-strip-types --check on the three app retention
  modules + index.ts                                 -> status 0 (syntax only)
```

## Guard reverts (red -> shipped green)

- **Installer graph.** Reverting the three `src/mastra/observability-*.ts`
  lines from `install.sh` turns
  `a clean install carries every app module the entry point imports` red
  (`fail 1`); the shipped installer is `pass 5 / fail 0`.
- **Weekly inclusion.** Reverting `monday-note.mjs` (git stash of the one file)
  turns the week test file red with two failures
  (`a card accepted earlier is included...`, `an earlier accepted card appears
  in exactly one week...`) and turns the run test file red with one failure
  (`a run names a card accepted in an earlier week...`); the shipped module is
  `pass 29 / fail 0` (note) and `pass 13 / fail 0` (run).

## What this repair does, and does not, claim

- Claimed: install coverage of the app retention modules, proven by a
  clean-install import-graph test; weekly inclusion/attribution of cards with
  cost or activity in the week, proven by unit tests with controlled fixtures;
  the full JS suite, framework lint and shell/JS syntax checks pass locally.
- **NOT claimed:** the installer's `npm ci`, `tsc` and `mastra build` were not
  run here (no installed app `node_modules`); CI performs those after `npm ci`.
  Delivery and retention remain not live-verified; no Discussion was posted, no
  notification sent, and no DuckDB file was measured.
