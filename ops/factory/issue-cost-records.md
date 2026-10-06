# Structured issue-cost record (#211)

Apply `issue-cost-records.migration.sql` with the Factory PostgreSQL operator
connection before enabling a writer. Verify `factory_issue_cost_records` exists,
then use the normal read-only query path to read a saved `record` value. The
writer reads `issue:<number>` back after every save. An identical replay leaves
its JSON unchanged; a later UAT-return round can update the same row with new
dated rework and review-round evidence, never a second issue row.

Rollback is `issue-cost-records.rollback.sql`, and is safe only before a later
slice relies on a saved record. It deliberately drops the table, so do not use
it to repair a live record.

The record is JSONB, versioned (`version: 1`) and contains identity, aggregated
cost and token fields, stage timing, waits, rescues, review rounds, dated
rework, fallback counts and named gaps. It stores no prompt or message body.
`#212` owns the finalization handshake and raw-trace deletion; this slice
neither deletes traces nor publishes the Monday note.

## Capture command

After the migration, run the installed command as the Factory service account.
It opens the server-owned DuckDB trace store with DuckDB's `READ_ONLY` access
mode and reads Factory's PostgreSQL message store in a read-only transaction;
it then writes and reads back one cost row through the service account's narrow
table grant. This avoids a human WorkOS sign-in for the protected HTTP routes.
It is an operational coupling to Mastra's local `span_events` and
`mastra_messages` schemas: keep the regression tests and live proof, and revise
this reader if a Factory/Mastra upgrade changes either schema.

```sh
sudo -u julia-factory env ISSUE_COST_CAPTURE_PROJECT_ID=<project-id> \
  node /var/lib/julia-factory/app/ops/factory/issue-cost-capture.mjs --factory-card <issue-number>
sudo -u julia-factory node /var/lib/julia-factory/app/ops/factory/issue-cost-capture.mjs --laptop-pr <pr-number>
```

The laptop PR must have exactly one GitHub issue relation in its timeline; the
command refuses an absent or ambiguous relation rather than inferring one from
its text. Set `ISSUE_COST_CAPTURE_GITHUB_TOKEN` only when GitHub's public read
limit requires it. The token is read from the environment and is never printed.
`ISSUE_COST_CAPTURE_DATABASE` defaults to `julia_factory_trial` and
`ISSUE_COST_CAPTURE_FACTORY_BOT_LOGIN` may name the Factory bot for rescue
classification. The Factory capture's time window starts at the card's entered
time and ends when the command runs; it reads the supported trace and message
routes, then writes its idempotent record.

Fallback marks are read from `mastra_messages`, filtered by both thread and
resource id, without printing message bodies.
