-- #211: one immutable structured snapshot per closed issue. Apply with psql
-- against the existing Factory PostgreSQL database before enabling a writer.
BEGIN;
CREATE TABLE IF NOT EXISTS factory_issue_cost_records (
  record_key text PRIMARY KEY,
  issue_number bigint UNIQUE CHECK (issue_number > 0),
  record jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (record_key = 'issue:' || issue_number::text AND record->'identity'->>'issueNumber' = issue_number::text)
    OR
    (record_key LIKE 'unmatched-review:%' AND issue_number IS NULL AND record->'identity'->>'kind' = 'unmatched-review')
  )
);
GRANT SELECT, INSERT, UPDATE ON factory_issue_cost_records TO "julia-factory";
COMMIT;
