/** In-process durable cost capture for completed Factory cards (#211). */

type Card = {
  title: string;
  stages: string[];
  externalSource?: { externalId?: string } | null;
  stageHistory?: Array<{ stage: string; enteredAt: string; exitedAt?: string; by?: string; exitedBy?: string }>;
  sessions?: Record<string, { sessionId: string; threadId: string; thinkingLevel?: string; mode?: string }>;
};

type CaptureDependencies = {
  projectId: string;
  projects: { listAll(): Promise<Array<{ id: string; orgId: string }>> };
  workItems: { list(input: { orgId: string; factoryProjectId: string }): Promise<Card[]> };
  observability: { listTraces(input: object): Promise<any> };
  currentModeDefault?: (mode?: string) => string | undefined;
  database: { any(sql: string, values?: unknown[]): Promise<Array<{ issue_number?: number }>>; one(sql: string, values?: unknown[]): Promise<{ record: unknown }> };
  log?: (line: string) => void;
};

function issueNumber(card: Card): number | null {
  const match = card.externalSource?.externalId?.match(/^github-issue:(\d+)$/);
  return match ? Number(match[1]) : null;
}

async function spansForSessions(observability: CaptureDependencies['observability'], sessionIds: string[]) {
  const spans: Array<Record<string, any>> = [];
  for (const sessionId of sessionIds) {
    for (let page = 0; ; page += 1) {
      const result = await observability.listTraces({ filters: { sessionId }, pagination: { page, perPage: 100 } });
      spans.push(...result.spans);
      if (!result.pagination?.hasMore) break;
    }
  }
  return spans;
}

function effortFor(span: Record<string, any>, session: NonNullable<Card['sessions']>[string] | undefined, currentModeDefault?: CaptureDependencies['currentModeDefault']) {
  const options = [span.attributes?.providerOptions, span.attributes?.parameters].filter((value) => value && typeof value === 'object');
  const value = options.flatMap((option: any) => [option.reasoningEffort, option.thinkingLevel, ...Object.values(option).flatMap((nested: any) => [nested?.reasoningEffort, nested?.thinkingLevel])]).find((candidate) => typeof candidate === 'string');
  if (typeof value === 'string') return { effort: value, effortSource: 'span' };
  if (typeof session?.thinkingLevel === 'string') return { effort: session.thinkingLevel, effortSource: 'session' };
  const defaultEffort = currentModeDefault?.(session?.mode);
  if (typeof defaultEffort === 'string') return { effort: defaultEffort, effortSource: 'current-default (may differ from run time)' };
  return { effort: 'effort unknown', effortSource: 'unknown' };
}

type TokenValue = number | 'unknown';
type TokenRow = { provider: string; model: string; effort: string; effortSource: string; freshInputTokens: TokenValue; cacheReadTokens: TokenValue; cacheWriteTokens: TokenValue; outputTokens: TokenValue; thinkingTokens: TokenValue };

function addToken(row: TokenRow, field: keyof Pick<TokenRow, 'freshInputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'outputTokens' | 'thinkingTokens'>, value: unknown) {
  if (!Number.isFinite(value)) row[field] = 'unknown';
  else if (row[field] !== 'unknown') row[field] += value as number;
}

function recordFor(card: Card, number: number, spans: Array<Record<string, any>>, currentModeDefault?: CaptureDependencies['currentModeDefault']) {
  const gaps: string[] = [];
  const tokens = new Map<string, any>();
  const sessionById = new Map(Object.values(card.sessions ?? {}).map((session) => [session.sessionId, session]));
  for (const span of spans) {
    const attributes = span.attributes && typeof span.attributes === 'object' ? span.attributes : {};
    const detail = attributes.usage?.inputTokenDetails;
    const read = detail?.cacheRead;
    const write = detail?.cacheWrite;
    const input = attributes.usage?.inputTokens;
    const fresh = Number.isFinite(input) && Number.isFinite(read) && input >= read ? input - read : null;
    const output = attributes.usage?.outputTokens;
    const thinking = attributes.usage?.outputTokenDetails?.reasoning;
    const effort = effortFor(span, sessionById.get(span.sessionId), currentModeDefault), provider = attributes.costContext?.provider ?? 'unknown', model = attributes.costContext?.model ?? 'unknown';
    const key = `${provider}|${model}|${effort.effort}|${effort.effortSource}`;
    const row: TokenRow = tokens.get(key) ?? { provider, model, ...effort, freshInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, thinkingTokens: 0 };
    addToken(row, 'freshInputTokens', fresh);
    addToken(row, 'cacheReadTokens', read);
    addToken(row, 'cacheWriteTokens', write);
    addToken(row, 'outputTokens', output);
    addToken(row, 'thinkingTokens', thinking);
    tokens.set(key, row);
  }
  const completedAt = card.stageHistory?.find((entry) => entry.stage === 'done')?.enteredAt ?? null;
  if (!Object.keys(card.sessions ?? {}).length) gaps.push('no-sessions-on-card');
  return { version: 2, identity: { issueNumber: number, title: card.title, kind: 'factory', outcome: 'done', completedAt }, tokens: [...tokens.values()], gaps: [...new Set(gaps)], source: { traceCount: spans.length } };
}

export async function captureFinishedFactoryCards({ projectId, projects, workItems, observability, currentModeDefault, database, log = console.log }: CaptureDependencies): Promise<void> {
  const project = (await projects.listAll()).find((candidate) => candidate.id === projectId);
  if (!project) throw new Error(`Factory project ${projectId} was not found`);
  const cards = await workItems.list({ orgId: project.orgId, factoryProjectId: projectId });
  for (const card of cards) {
    const number = issueNumber(card);
    if (!number || !card.stages.includes('done')) continue;
    try {
      const sessions = Object.values(card.sessions ?? {});
      const spans = await spansForSessions(observability, sessions.map((session) => session.sessionId));
      const record = recordFor(card, number, spans, currentModeDefault);
      const saved = await database.one('INSERT INTO factory_issue_cost_records (record_key, issue_number, record) VALUES ($1, $2, $3::jsonb) ON CONFLICT (record_key) DO UPDATE SET record = EXCLUDED.record WHERE factory_issue_cost_records.record IS DISTINCT FROM EXCLUDED.record RETURNING record', [`issue:${number}`, number, JSON.stringify(record)]);
      if (!saved.record) throw new Error('saved cost record was not read back');
      log(`issue-cost-capture event=captured issue=${number}`);
    } catch (error) { log(`issue-cost-capture event=failed issue=${number} error=${error instanceof Error ? error.message : String(error)}`); }
  }
}
