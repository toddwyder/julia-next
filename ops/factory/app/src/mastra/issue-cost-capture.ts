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
    const page = await observability.listTraces({ filters: { sessionId }, pagination: { page: 0, perPage: 100 } });
    spans.push(...page.spans);
    if (page.pagination?.hasMore) throw new Error(`trace pagination for session ${sessionId} is incomplete`);
  }
  return spans;
}

function recordFor(card: Card, number: number, spans: Array<Record<string, any>>, fallbackReasons: string[]) {
  const gaps: string[] = [];
  let totalUsd: number | null = 0;
  const byProviderModel = spans.map((span) => {
    const attributes = span.attributes && typeof span.attributes === 'object' ? span.attributes : {};
    const cost = attributes.costContext?.estimatedCost;
    const traceUsage = usage(attributes);
    if (!Number.isFinite(cost)) { totalUsd = null; gaps.push(`trace ${span.spanId ?? span.id ?? '(no id)'}: cost unavailable`); }
    else if (totalUsd !== null) totalUsd += cost;
    if (!traceUsage) gaps.push(`trace ${span.spanId ?? span.id ?? '(no id)'}: usage unavailable`);
    return { stage: 'build', provider: attributes.costContext?.provider ?? 'unknown', model: attributes.costContext?.model ?? 'unknown', costUsd: Number.isFinite(cost) ? cost : null,
      freshInputTokens: traceUsage?.freshInputTokens ?? null, cachedInputTokens: traceUsage?.cachedInputTokens ?? null, outputTokens: traceUsage?.outputTokens ?? null, thinkingTokens: traceUsage?.thinkingTokens ?? null };
  });
  const completedAt = card.stageHistory?.find((entry) => entry.stage === 'done')?.enteredAt ?? null;
  return { version: 1, identity: { issueNumber: number, title: card.title, kind: 'factory', outcome: 'done', completedAt },
    cost: { totalUsd, faceValueUsd: totalUsd, byProviderModel }, stages: card.stageHistory ?? [], waits: [], rescues: [], reviewRounds: [], rework: [],
    fallbacks: { poolExhausted: fallbackReasons.filter((reason) => reason === 'pool-exhausted').length, persistentOutage: fallbackReasons.filter((reason) => reason === 'persistent-outage').length }, gaps: [...new Set(gaps)], source: { traceCount: spans.length, pullRequestNumber: null } };
}

export async function captureFinishedFactoryCards({ projectId, projects, workItems, observability, memory, database, log = console.log }: CaptureDependencies): Promise<void> {
  const project = (await projects.listAll()).find((candidate) => candidate.id === projectId);
  if (!project) throw new Error(`Factory project ${projectId} was not found`);
  const cards = await workItems.list({ orgId: project.orgId, factoryProjectId: projectId });
  for (const card of cards) {
    const number = issueNumber(card);
    if (!number || !card.stages.includes('done')) continue;
    try {
      if ((await database.any('SELECT issue_number FROM factory_issue_cost_records WHERE issue_number = $1', [number])).length) { log(`issue-cost-capture event=skipped issue=${number} reason=already-saved`); continue; }
      const sessions = Object.values(card.sessions ?? {});
      const spans = await spansForSessions(observability, sessions.map((session) => session.sessionId));
      const reasons: string[] = [];
      for (const session of sessions) {
        const page = await memory.listMessages({ threadId: session.threadId, resourceId: session.sessionId, page: 0, perPage: 100, orderBy: { field: 'createdAt', direction: 'DESC' } });
        if (page.hasMore) throw new Error(`message pagination for session ${session.sessionId} is incomplete`);
        for (const part of page.messages.flatMap((message: any) => message.parts ?? [])) if (part.type === 'data-mastracode-pack-fallback' && (part.data?.reason === 'pool-exhausted' || part.data?.reason === 'persistent-outage')) reasons.push(part.data.reason);
      }
      const record = recordFor(card, number, spans, reasons);
      const saved = await database.one('INSERT INTO factory_issue_cost_records (record_key, issue_number, record) VALUES ($1, $2, $3::jsonb) ON CONFLICT (record_key) DO UPDATE SET record = EXCLUDED.record WHERE factory_issue_cost_records.record IS DISTINCT FROM EXCLUDED.record RETURNING record', [`issue:${number}`, number, JSON.stringify(record)]);
      if (!saved.record) throw new Error('saved cost record was not read back');
      log(`issue-cost-capture event=captured issue=${number}`);
    } catch (error) { log(`issue-cost-capture event=failed issue=${number} error=${error instanceof Error ? error.message : String(error)}`); }
  }
}
