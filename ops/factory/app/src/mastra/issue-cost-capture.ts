/** In-process durable cost capture for completed Factory cards (#211). */

type Card = {
  title: string;
  stages: string[];
  externalSource?: { externalId?: string } | null;
  stageHistory?: Array<{ stage: string; enteredAt: string; exitedAt?: string; by?: string; exitedBy?: string }>;
  sessions?: Record<string, { sessionId: string; threadId: string }>;
};

type CaptureDependencies = {
  projectId: string;
  projects: { listAll(): Promise<Array<{ id: string; orgId: string }>> };
  workItems: { list(input: { orgId: string; factoryProjectId: string }): Promise<Card[]> };
  observability: { listTraces(input: object): Promise<any> };
  memory: { listMessages(input: object): Promise<any> };
  database: { any(sql: string, values?: unknown[]): Promise<Array<{ issue_number?: number }>>; one(sql: string, values?: unknown[]): Promise<{ record: unknown }> };
  log?: (line: string) => void;
};

function issueNumber(card: Card): number | null {
  const match = card.externalSource?.externalId?.match(/^github-issue:(\d+)$/);
  return match ? Number(match[1]) : null;
}

function usage(attributes: Record<string, any>): Record<string, number> | null {
  const value = attributes.usage;
  if (!value || !Number.isFinite(value.inputTokens) || !Number.isFinite(value.outputTokens)) return null;
  const cached = value.inputTokenDetails?.cacheRead ?? 0;
  const thinking = value.outputTokenDetails?.reasoning ?? 0;
  if (!Number.isFinite(cached) || !Number.isFinite(thinking) || value.inputTokens < cached) return null;
  return { freshInputTokens: value.inputTokens - cached, cachedInputTokens: cached, outputTokens: value.outputTokens, thinkingTokens: thinking };
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

async function messagesForSession(memory: CaptureDependencies['memory'], session: { sessionId: string; threadId: string }) {
  const messages: any[] = [];
  for (let page = 0; ; page += 1) {
    let result: any;
    try {
      result = await memory.listMessages({ threadId: session.threadId, resourceId: session.sessionId, page, perPage: 100, orderBy: { field: 'createdAt', direction: 'DESC' } });
    } catch (error) {
      throw new Error(`message read failed for session ${session.sessionId} page ${page}: ${error instanceof Error ? error.message : String(error)}`);
    }
    messages.push(...result.messages);
    if (!result.hasMore) return messages;
  }
}

function effortFor(span: Record<string, any>) {
  const options = span.attributes?.providerOptions ?? span.attributes?.parameters ?? {};
  const nested: any = Object.values(options).find((v: any) => v?.reasoningEffort ?? v?.thinkingLevel);
  const value = options.reasoningEffort ?? options.thinkingLevel ?? nested?.reasoningEffort ?? nested?.thinkingLevel;
  return typeof value === 'string' ? { effort: value, effortSource: 'span' } : { effort: 'effort unknown', effortSource: 'unknown' };
}

function recordFor(card: Card, number: number, spans: Array<Record<string, any>>) {
  const gaps: string[] = [];
  const tokens = new Map<string, any>();
  for (const span of spans) {
    const attributes = span.attributes && typeof span.attributes === 'object' ? span.attributes : {};
    const detail = attributes.usage?.inputTokenDetails ?? {};
    const read = detail.cacheRead ?? 0, write = detail.cacheWrite ?? 0;
    const fresh = Number.isFinite(attributes.usage?.inputTokens) ? attributes.usage.inputTokens - read : null;
    const output = attributes.usage?.outputTokens, thinking = attributes.usage?.outputTokenDetails?.reasoning ?? 0;
    const effort = effortFor(span), provider = attributes.costContext?.provider ?? 'unknown', model = attributes.costContext?.model ?? 'unknown';
    const key = `${provider}|${model}|${effort.effort}|${effort.effortSource}`;
    const row = tokens.get(key) ?? { provider, model, ...effort, freshInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, thinkingTokens: 0 };
    if (![fresh, read, write, output, thinking].every(Number.isFinite)) gaps.push(`trace ${span.spanId ?? span.id ?? '(no id)'}: usage unavailable`);
    else { row.freshInputTokens += fresh; row.cacheReadTokens += read; row.cacheWriteTokens += write; row.outputTokens += output; row.thinkingTokens += thinking; }
    tokens.set(key, row);
  }
  const completedAt = card.stageHistory?.find((entry) => entry.stage === 'done')?.enteredAt ?? null;
  if (!Object.keys(card.sessions ?? {}).length) gaps.push('no-sessions-on-card');
  return { version: 2, identity: { issueNumber: number, title: card.title, kind: 'factory', outcome: 'done', completedAt }, tokens: [...tokens.values()], gaps: [...new Set(gaps)], source: { traceCount: spans.length } };
}

export async function captureFinishedFactoryCards({ projectId, projects, workItems, observability, memory, database, log = console.log }: CaptureDependencies): Promise<void> {
  const project = (await projects.listAll()).find((candidate) => candidate.id === projectId);
  if (!project) throw new Error(`Factory project ${projectId} was not found`);
  const cards = await workItems.list({ orgId: project.orgId, factoryProjectId: projectId });
  for (const card of cards) {
    const number = issueNumber(card);
    if (!number || !card.stages.includes('done')) continue;
    try {
      const sessions = Object.values(card.sessions ?? {});
      const spans = await spansForSessions(observability, sessions.map((session) => session.sessionId));
      const record = recordFor(card, number, spans);
      const saved = await database.one('INSERT INTO factory_issue_cost_records (record_key, issue_number, record) VALUES ($1, $2, $3::jsonb) ON CONFLICT (record_key) DO UPDATE SET record = EXCLUDED.record WHERE factory_issue_cost_records.record IS DISTINCT FROM EXCLUDED.record RETURNING record', [`issue:${number}`, number, JSON.stringify(record)]);
      if (!saved.record) throw new Error('saved cost record was not read back');
      log(`issue-cost-capture event=captured issue=${number}`);
    } catch (error) { log(`issue-cost-capture event=failed issue=${number} error=${error instanceof Error ? error.message : String(error)}`); }
  }
}
