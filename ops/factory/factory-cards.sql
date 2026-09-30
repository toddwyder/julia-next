-- Factory 0.17.2 work_items snapshot for the Monday note. Read-only; keep in
-- step with the board's own columns. Run as the read-only Factory role the
-- wait watcher uses; the project id is passed with -v project_id=...
BEGIN TRANSACTION READ ONLY;
SELECT jsonb_build_object(
  'number', CASE
    WHEN w.board = 'review' AND w.external_source->>'externalId' ~ '^github-pr:[0-9]+$'
      THEN 'PR-' || split_part(w.external_source->>'externalId', ':', 2)
    WHEN w.board = 'work' AND w.external_source->>'externalId' ~ '^github-issue:[0-9]+$'
      THEN split_part(w.external_source->>'externalId', ':', 2)
    WHEN w.metadata->>'number' ~ '^[0-9]+$' THEN w.metadata->>'number'
    ELSE 'Factory-' || w.id::text
  END,
  'title', w.title,
  'board', w.board,
  'stages', w.stages,
  'stage_history', w.stage_history,
  'sessions', w.sessions,
  'accepted_at', w.accepted_at,
  'created_at', w.created_at,
  'external_source', w.external_source
)::text
FROM work_items w
WHERE w.factory_project_id = :'project_id'
  AND w.board IN ('work', 'review');
COMMIT;
