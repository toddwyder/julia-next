-- Read-time face value for #211 records. Unknown token or price stays NULL.
WITH token_rows AS (
  SELECT r.issue_number, r.saved_at, t
  FROM factory_issue_cost_records r CROSS JOIN LATERAL jsonb_array_elements(r.record->'tokens') t
), token_prices AS (
  SELECT tr.*, v.token_type, v.token_value, price.usd_per_token AS rate, price.basis AS price_basis
  FROM token_rows tr CROSS JOIN LATERAL jsonb_each_text(tr.t) v(token_type, token_value)
  LEFT JOIN LATERAL (
    SELECT p.usd_per_token,
      CASE WHEN p.effective_from <= tr.saved_at THEN 'in force' ELSE 'earliest known price' END AS basis
    FROM factory_model_prices p
    WHERE p.provider=tr.t->>'provider' AND p.model=tr.t->>'model' AND p.token_type=v.token_type
    ORDER BY (p.effective_from <= tr.saved_at) DESC,
      CASE WHEN p.effective_from <= tr.saved_at THEN p.effective_from END DESC,
      CASE WHEN p.effective_from > tr.saved_at THEN p.effective_from END ASC
    LIMIT 1
  ) price ON true
  WHERE v.token_type IN ('freshInputTokens','cacheReadTokens','cacheWriteTokens','outputTokens','thinkingTokens')
)
SELECT issue_number, t->>'provider' provider, t->>'model' model, t->>'effort' effort, t->'effortSources' effort_sources,
  jsonb_object_agg(token_type, token_value) token_counts,
  CASE WHEN bool_and(rate IS NOT NULL AND token_value <> 'unknown')
       THEN sum(NULLIF(token_value, 'unknown')::numeric * rate) END AS face_value_usd,
  CASE WHEN bool_and(rate IS NOT NULL AND token_value <> 'unknown') THEN NULL ELSE 'price unknown' END AS price_reason,
  CASE WHEN bool_and(rate IS NOT NULL AND token_value <> 'unknown')
         THEN CASE WHEN bool_or(price_basis = 'earliest known price') THEN 'earliest known price' ELSE 'in force' END END AS price_basis
FROM token_prices GROUP BY issue_number, t->>'provider', t->>'model', t->>'effort', t->'effortSources';
