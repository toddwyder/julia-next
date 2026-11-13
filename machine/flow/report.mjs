// The card report carries one table of what the card read, grouped by the agent that read it and
// the model it read with. The ledger already prices every finished call; this only adds the tokens
// up, so a reader can see which model each agent spent its reading on.

const LEAD = 'flow-build';

const count = value => value.toLocaleString('en-US');

const agentName = agent => (agent === LEAD ? 'Lead' : agent || 'unknown agent');

const rows = calls => {
  const groups = new Map();
  for (const call of calls) {
    const key = `${call.agent ?? ''}|${call.provider ?? ''}/${call.model ?? ''}`;
    const group = groups.get(key) ?? {
      agent: agentName(call.agent),
      model: `${call.provider ?? 'unknown'}/${call.model ?? 'unknown'}`,
      calls: 0,
      read: 0,
      cached: 0,
      written: 0,
    };
    const cached = call.cacheReadTokens ?? 0;
    group.calls += 1;
    group.read += Math.max(0, (call.inputTokens ?? 0) - cached);
    group.cached += cached;
    group.written += call.outputTokens ?? 0;
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => b.read + b.cached - (a.read + a.cached) || a.agent.localeCompare(b.agent),
  );
};

export function tokenReport(calls = []) {
  const totals = rows(calls);
  if (totals.length === 0) return ['## Tokens read', '', 'No model call finished on this card.'];
  return [
    '## Tokens read',
    '',
    '| Agent | Model | Calls | Read | Cached | Written |',
    '| --- | --- | --- | --- | --- | --- |',
    ...totals.map(
      row =>
        `| ${row.agent} | ${row.model} | ${count(row.calls)} | ${count(row.read)} | ${count(row.cached)} | ${count(row.written)} |`,
    ),
  ];
}
