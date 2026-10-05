-- #211 rollback: only use before any record is relied on by a later slice.
BEGIN;
DROP TABLE IF EXISTS factory_issue_cost_records;
COMMIT;
