# Structured issue-cost record (#211)

Apply `issue-cost-records.migration.sql` with the Factory PostgreSQL operator
connection before enabling a writer. Verify `factory_issue_cost_records` exists,
then use the normal read-only query path to read a saved `record` value. The
writer inserts `issue:<number>` once; a replay does not overwrite it and reads
that same row back.

Rollback is `issue-cost-records.rollback.sql`, and is safe only before a later
slice relies on a saved record. It deliberately drops the table, so do not use
it to repair a live record.

The record is JSONB, versioned (`version: 1`) and contains identity, aggregated
cost and token fields, stage timing, wait/rescue/rework placeholders, fallback
counts and named gaps. It stores no prompt or message body. `#212` owns the
finalization handshake, record amendments for UAT return rounds, and raw-trace
deletion; this slice neither deletes traces nor publishes the Monday note.

Fallback marks are read through Mastra's supported `GET
/memory/threads/:threadId/messages` route. The pinned CLI names it in
`ops/factory/app/node_modules/mastra/dist/commands/api/route-metadata.generated.d.ts:851-861`;
Factory itself delegates its message reader to memory `listMessages` at
`ops/factory/app/node_modules/@mastra/factory/dist/factory.js:440-446`.
