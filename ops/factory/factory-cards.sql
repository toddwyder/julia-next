-- Factory 0.17.2 work_items snapshot for the Monday note. Read-only; keep in
-- step with the board's own columns. Run as the read-only Factory role the
-- wait watcher uses; the project id is passed with -v project_id=...
BEGIN TRANSACTION READ ONLY;
WITH note_items AS (
  SELECT id, title, board, stages, stage_history, sessions, metadata,
         accepted_at, created_at, external_source, false AS record_missing
  FROM work_items
  WHERE factory_project_id = :'project_id' AND board IN ('work', 'review')
  UNION ALL
  -- Factory retains run bindings after a card record disappears. Keep their
  -- actual work-item IDs; never guess an issue number or silently drop spend.
  SELECT b.work_item_id::uuid, 'no recorded card title (retained Factory run binding)',
         'work', '[]'::jsonb, '[]'::jsonb,
         jsonb_object_agg(b.thread_id, jsonb_build_object('threadId', b.thread_id, 'sessionId', b.session_id)),
         '{}'::jsonb, min(b.created_at), min(b.created_at), NULL::jsonb, true
  FROM (SELECT DISTINCT ON (thread_id, work_item_id) * FROM factory_run_bindings
        WHERE factory_project_id = :'project_id'
        ORDER BY thread_id, work_item_id, created_at DESC) b
  WHERE b.factory_project_id = :'project_id'
    AND NOT EXISTS (SELECT 1 FROM work_items current_card WHERE current_card.id::text = b.work_item_id)
  GROUP BY b.work_item_id
)
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
  'record_missing', w.record_missing,
  'board', w.board,
  'stages', w.stages,
  'stage_history', w.stage_history,
  'sessions', w.sessions,
  'session_bindings', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'threadId', b.thread_id, 'sessionId', b.session_id, 'role', b.role, 'at', b.created_at
  )) FROM factory_run_bindings b WHERE b.work_item_id = w.id::text
      AND b.factory_project_id = :'project_id'), '[]'::jsonb),
  -- Only the phase runtime fields leave the message store; never prompt text.
  'phase_snapshots', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'threadId', m.thread_id, 'at', m.created_at,
      'phase', m.phase, 'effort', m.effort, 'model', m.model
    ) ORDER BY m.created_at)
    FROM julia_monday_phase_snapshots m
    WHERE m.thread_id IN (
      SELECT value->>'threadId' FROM jsonb_each(w.sessions)
      UNION SELECT b.thread_id FROM factory_run_bindings b
        WHERE b.work_item_id = w.id::text AND b.factory_project_id = :'project_id'
    )
  ), '[]'::jsonb),
  'accepted_at', w.accepted_at,
  'created_at', w.created_at,
  'external_source', w.external_source
)::text
FROM note_items w;
COMMIT;
