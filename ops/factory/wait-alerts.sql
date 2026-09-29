-- Factory 0.17.2 wait snapshot. Read-only; keep in step with its attention providers.
BEGIN TRANSACTION READ ONLY;
WITH pending_tools AS (
  SELECT DISTINCT ON (b.session_id, p.part->'toolInvocation'->>'toolCallId')
    b.session_id, b.thread_id, w.id AS work_item_id, w.title,
    p.part->'toolInvocation' AS invocation, m."createdAtZ" AS occurred_at,
    b.factory_project_id
  FROM factory_run_bindings b
  JOIN work_items w ON w.id::text = b.work_item_id
  JOIN mastra_messages m ON m.thread_id = b.thread_id
  CROSS JOIN LATERAL jsonb_array_elements(m.content::jsonb->'parts') AS p(part)
  WHERE b.factory_project_id = :'project_id' AND b.status = 'active'
    AND p.part->>'type' = 'tool-invocation'
    AND p.part->'toolInvocation'->>'toolName' IN ('ask_user', 'submit_plan', 'request_access')
  ORDER BY b.session_id, p.part->'toolInvocation'->>'toolCallId', m."createdAtZ" DESC
), waits AS (
  SELECT jsonb_build_object(
    'kind', 'agent-waiting', 'key', 'agent-waiting:' || session_id || ':' || (invocation->>'toolCallId'),
    'title', title, 'detail', CASE invocation->>'toolName'
      WHEN 'submit_plan' THEN 'A plan is waiting for your review'
      WHEN 'request_access' THEN 'The agent needs your permission'
      ELSE 'The agent is waiting for your answer' END,
    'path', '/factories/' || factory_project_id || '/workspaces/' || session_id || '/threads/' || thread_id,
    'occurred_at', occurred_at
  ) AS item
  FROM pending_tools p
  WHERE invocation->>'state' = 'call'
    AND NOT EXISTS (
      SELECT 1 FROM factory_attention_receipts r
      WHERE r.user_id = :'user_id' AND r.factory_project_id = p.factory_project_id
        AND r.kind = 'agent-waiting' AND r.source_id = p.session_id
        AND r.state = 'archived' AND r.created_at >= p.occurred_at)
  UNION ALL
  SELECT jsonb_build_object(
    'kind', 'automation-proposed', 'key', 'automation-proposed:' || d.id::text,
    'title', COALESCE(w.title, 'Factory automation'),
    'detail', CASE WHEN d.decision->>'type' = 'transition' THEN
      'Approve moving this card to ' || COALESCE(d.decision->>'stage', 'the next phase')
      ELSE 'Approve a proposed Factory run' END,
    'path', CASE WHEN w.id IS NULL THEN '/factories/' || d.factory_project_id || '/attention'
      ELSE '/factories/' || d.factory_project_id || '/' || w.board || '?item=' || w.id::text END,
    'occurred_at', d.created_at
  )
  FROM factory_deferred_decisions d
  LEFT JOIN work_items w ON w.id::text = d.work_item_id
  WHERE d.factory_project_id = :'project_id' AND d.status = 'proposed'
    AND NOT EXISTS (
      SELECT 1 FROM factory_attention_receipts r
      WHERE r.user_id = :'user_id' AND r.factory_project_id = d.factory_project_id
        AND r.kind = 'automation-proposed' AND r.source_id = d.id::text
        AND r.occurrence = 0 AND r.state = 'archived')
  UNION ALL
  SELECT jsonb_build_object(
    'kind', 'automation-failed', 'key', 'automation-failed:' || d.id::text || ':' || d.failure_occurrence,
    'title', COALESCE(w.title, 'Factory automation failed'),
    'detail', 'Factory needs attention after an automation failure',
    'path', CASE WHEN w.id IS NULL THEN '/factories/' || d.factory_project_id || '/attention'
      ELSE '/factories/' || d.factory_project_id || '/' || w.board || '?item=' || w.id::text END,
    'occurred_at', d.updated_at
  )
  FROM factory_deferred_decisions d
  LEFT JOIN work_items w ON w.id::text = d.work_item_id
  WHERE d.factory_project_id = :'project_id' AND d.status = 'failed'
    AND NOT EXISTS (
      SELECT 1 FROM factory_attention_receipts r
      WHERE r.user_id = :'user_id' AND r.factory_project_id = d.factory_project_id
        AND r.kind = 'automation-failed' AND r.source_id = d.id::text
        AND r.occurrence = d.failure_occurrence AND r.state = 'archived')
  UNION ALL
  SELECT jsonb_build_object(
    'kind', 'supervisor-finding', 'key', 'supervisor-finding:' || f.finding_key || ':' || f.occurrence,
    'title', COALESCE(f.finding->>'title', 'Factory supervisor finding'),
    'detail', 'A Factory supervisor finding needs attention',
    'path', '/factories/' || f.factory_project_id || '/supervisor',
    'occurred_at', f.opened_at
  )
  FROM factory_supervisor_findings f
  WHERE f.factory_project_id = :'project_id' AND f.resolved_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM factory_attention_receipts r
      WHERE r.user_id = :'user_id' AND r.factory_project_id = f.factory_project_id
        AND r.kind = 'supervisor-finding' AND r.source_id = f.finding_key
        AND r.occurrence = f.occurrence AND r.state = 'archived')
  UNION ALL
  SELECT jsonb_build_object(
    'kind', 'mention', 'key', 'mention:' || x.comment_id,
    'title', w.title, 'detail', 'You were mentioned on this card',
    'path', '/factories/' || w.factory_project_id || '/' || w.board || '?item=' || w.id::text || '&comment=' || x.comment_id,
    'occurred_at', x.occurred_at
  )
  FROM work_item_comment_mentions x
  JOIN work_item_comments c ON c.id::text = x.comment_id AND c.deleted_at IS NULL
  JOIN work_items w ON w.id::text = x.work_item_id
  WHERE x.factory_project_id = :'project_id' AND x.mentioned_id = :'user_id'
    AND NOT EXISTS (
      SELECT 1 FROM factory_attention_receipts r
      WHERE r.user_id = :'user_id' AND r.factory_project_id = x.factory_project_id
        AND r.kind = 'mention' AND r.source_id = x.comment_id
        AND r.occurrence = 0 AND r.state = 'archived')
  UNION ALL
  SELECT jsonb_build_object(
    'kind', 'triage-approval',
    'key', 'triage-approval:' || w.id::text || ':' || COALESCE((w.stage_history->-1)->>'enteredAt', w.created_at::text),
    'title', w.title, 'detail', 'This Triage card needs your approval',
    'path', '/factories/' || w.factory_project_id || '/work?item=' || w.id::text,
    'occurred_at', w.updated_at
  )
  FROM work_items w
  WHERE w.factory_project_id = :'project_id' AND w.board = 'work'
    AND w.stages @> '["triage"]'::jsonb AND w.accepted_at IS NULL
    AND COALESCE(w.metadata->'labels', '[]'::jsonb) ? 'status: needs approval'
)
SELECT item::text FROM waits ORDER BY item->>'kind', item->>'key';
COMMIT;
