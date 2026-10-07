/** Refresh public OpenRouter token prices for models Factory has actually used. */
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
export const MODEL_ID_MAP: Record<string, string> = {
  'openai/gpt-6-sol': 'openai/gpt-6-sol',
  'moonshotai/Kimi-K2.7-Code': 'moonshotai/kimi-k2.7-code',
  'deepseek/deepseek-v4-pro': 'deepseek/deepseek-v4-pro',
  'command-code/deepseek/deepseek-v4-flash': 'deepseek/deepseek-v4-flash',
};
const priceFields = { freshInputTokens: 'prompt', cacheReadTokens: 'input_cache_read', cacheWriteTokens: 'input_cache_write', outputTokens: 'completion', thinkingTokens: 'internal_reasoning' } as const;

type Database = { any(sql: string, values?: unknown[]): Promise<Array<Record<string, unknown>>> };
type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export async function refreshModelPrices({ database, fetchImpl = fetch, now = new Date(), log = console.log }: { database: Database; fetchImpl?: Fetch; now?: Date; log?: (line: string) => void }): Promise<void> {
  let response: Awaited<ReturnType<Fetch>>;
  try { response = await fetchImpl(OPENROUTER_MODELS_URL); if (!response.ok) throw new Error(`HTTP ${response.status}`); }
  catch (error) { log(`model-price-refresh event=failed error=${error instanceof Error ? error.message : String(error)}`); return; }
  let payload: any;
  try { payload = await response.json(); } catch (error) { log(`model-price-refresh event=failed error=invalid-model-list`); return; }
  const used = await database.any("SELECT DISTINCT token->>'provider' provider, token->>'model' model FROM factory_issue_cost_records CROSS JOIN LATERAL jsonb_array_elements(record->'tokens') token");
  for (const row of used) {
    const provider = String(row.provider), model = String(row.model), routerId = MODEL_ID_MAP[`${provider}/${model}`];
    const remote = routerId && payload.data?.find((item: any) => item.id === routerId);
    if (!remote) { log(`model-price-refresh event=price-unknown provider=${provider} model=${model}`); continue; }
    for (const [tokenType, field] of Object.entries(priceFields)) {
      const raw = remote.pricing?.[field]; const rate = typeof raw === 'string' ? Number(raw) : NaN;
      if (!Number.isFinite(rate)) continue;
      const latest = await database.any('SELECT usd_per_token FROM factory_model_prices WHERE provider=$1 AND model=$2 AND token_type=$3 ORDER BY effective_from DESC LIMIT 1', [provider, model, tokenType]);
      if (Number(latest[0]?.usd_per_token) === rate) continue;
      await database.any('INSERT INTO factory_model_prices (provider, model, token_type, usd_per_token, effective_from) VALUES ($1,$2,$3,$4,$5)', [provider, model, tokenType, rate, now.toISOString()]);
    }
  }
  log('model-price-refresh event=completed');
}
