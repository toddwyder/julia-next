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

// The words a stop leaves behind are the same wherever the card stops. A stop on spending also
// states the most the card can overshoot: the helpers running when the cap was crossed, each worth
// at worst the dearest call the card has already paid for.
export function reportText(state, detail, spending, helperConcurrency) {
  const dearest = Math.max(0, ...(spending?.calls ?? []).map(call => call.usd));
  const overshoot = state.stopPart === 'Spending' && dearest > 0
    ? [`Worst overshoot: $${(helperConcurrency * dearest).toFixed(3)} (${helperConcurrency} helpers x $${dearest.toFixed(3)}, the dearest call on this card)`]
    : [];
  return [
    `# ${state.card} stopped`,
    '',
    `Part: ${state.stopPart || 'unknown'}`,
    `Why: ${state.stopWhy || 'no reason recorded'}`,
    `Check returns: ${state.checkReturns ?? 0}`,
    `Shipping failures: ${state.failCount}`,
    `Failures counted: ${state.failCount}`,
    `Shipping rounds: ${state.reviewRound}`,
    `Build rounds: ${state.buildRounds}`,
    ...(state.copy ? [`Copy: ${state.copy}`, `Started from main at: ${state.base}`] : []),
    `Last detail: ${detail || 'none'}`,
    ...overshoot,
    '',
    ...tokenReport(spending?.calls ?? []),
    '',
    'A second failure stops the card; the next step is an Investigation.',
  ].join('\n');
}
