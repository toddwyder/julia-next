# Issue #140 — Monday note and bounded trace storage

## Goal

Two pieces of our own, approved by ADR 0009 and listed on the exceptions list when built:

1. The **Monday note** — a weekly program that reads Factory's own card records and Mastra's
   trace cost data and posts one plain-language summary as a GitHub Discussion in the
   **Monday notes** category, notifying Todd's phone. Discussions are not ingested by Factory,
   so the note never lands in Intake.
2. **Supported trace retention/cleanup** that keeps the observability store bounded. The
   change log records the DuckDB trace store at 1.7 GB after ~10 hours with 30 GB free
   (`docs/agents/factory-platform-auth-change-log.md:124`); Studio and trace retention are
   this card's.

## Scope

- In: scheduled generation of the weekly report from Mastra traces and Factory card records;
  the GitHub Discussion publisher and Todd-notification adapters; the retention/cleanup plan
  and its enforcement through the storage backend's own retention.
- Out: live posting of a Discussion, live phone notification, any change to the running
  Factory service or its database, browser verification of Studio, and Julia features.

## Seams (Todd approved 2026-09-30, ahead of #148)

- **Cost-report generation** — `buildMondayNote(input)` in `ops/factory/monday-note.mjs`. Input
  is fixture Mastra trace records plus Factory card records; output is the note text and its
  per-card lines. Tested in `ops/factory/monday-note.test.mjs`.
- **Discussion and notification adapters** — `publishMondayNote({ note, discussions,
  notifications })`, called with fakes. Asserts the Discussion lands in the `Monday notes`
  category with the note body, and the notification carries its link exactly once.
- **Retention** — `selectExpiredSpans` / `runTraceCleanup` in `ops/factory/trace-retention.mjs`.
  The program plans what falls outside the retention window and hands the cutoff to the storage
  backend's own retention (the supported Mastra path, already configured via `DEFAULT_RETENTION`
  in `ops/factory/app/src/mastra/index.ts:344,349`); it never deletes rows itself.

## Phases

### 1. Weekly report from fixture traces (red → green → guard)

- Test first: `buildMondayNote` returns the card lines, total spend, failed attempts, elapsed
  time, and the Done-by-Factory line, from fixture traces and card records; a quiet week says so;
  the note states the outside-Factory exclusion.
- Implement the smallest pure function that passes.
- Guard: restore the pre-implementation module in a copy and confirm the same tests go red.

### 2. Discussion and notification adapters (red → green → guard)

- Test first: one post to the `Monday notes` category, one notification with the Discussion URL;
  a second run for the same week does not post or notify twice.
- Implement the orchestration over injected adapters.
- Guard: same reversion check.

### 3. Bounded trace storage (red → green → guard)

- Test first: a 20-day, over-budget span inventory yields exactly the spans outside the
  retention window; cleanup calls the storage backend's retention once and reports the result.
- Implement.
- Guard: same reversion check.

## Observability

The note itself is the weekly record. Each run prints the count of cards, total spend, the
discussion URL, and for trace cleanup the number of expired spans and the store size before and
after. A cleanup that leaves the store over budget is reported, not retried.

## Risks

- Factory's real card-move and trace schemas may differ from the fixtures; the adapters are the
  single place that shape is normalised, so a live mismatch is a small fix there.
- Mastra's own retention behaviour is configured today but unverified live; this card proves the
  plan and the call, not the live DuckDB outcome, which is an operator step in production.

## Assumptions

- Todd's approval of these seams holds from 2026-09-30; no Discussion is published and no phone
  notification is sent by this card.
- The note is generated on a schedule (systemd timer, like the wait watcher), not by a
  hand-built loop.
