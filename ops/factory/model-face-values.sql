-- Read-time face value for #211 records. Unknown token or price stays NULL.
WITH token_rows AS (
  SELECT r.issue_number, r.saved_at, t
  FROM factory_issue_cost_records r CROSS JOIN LATERAL jsonb_array_elements(r.record->'tokens') t
), token_prices AS (
  SELECT tr.*, v.token_type, v.token_value,
    (SELECT p.usd_per_token FROM factory_model_prices p
     WHERE p.provider=tr.t->>'provider' AND p.model=tr.t->>'model' AND p.token_type=v.token_type
       AND p.effective_from <= tr.saved_at ORDER BY p.effective_from DESC LIMIT 1) rate
  FROM token_rows tr CROSS JOIN LATERAL jsonb_each_text(tr.t) v(token_type, token_value)
  WHERE v.token_type IN ('freshInputTokens','cacheReadTokens','cacheWriteTokens','outputTokens','thinkingTokens')
)
SELECT issue_number, t->>'provider' provider, t->>'model' model, t->>'effort' effort,
  jsonb_object_agg(token_type, token_value) token_counts,
  CASE WHEN bool_and(rate IS NOT NULL AND token_value <> 'unknown')
       THEN sum(token_value::numeric * rate) END AS face_value_usd,
  CASE WHEN bool_and(rate IS NOT NULL AND token_value <> 'unknown') THEN NULL ELSE 'price unknown' END AS price_reason
FROM token_prices GROUP BY issue_number, t->>'provider', t->>'model', t->>'effort';
