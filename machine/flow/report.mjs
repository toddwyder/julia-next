// The words a stop leaves behind are the same wherever the card stops.
export function tripwireStop({ reason, processorId, metadata } = {}) {
  const id = metadata?.processorId ?? processorId ?? '';
  if (id === 'token-cost-control') {
    const limit = Number(metadata?.maxCost ?? 0);
    const spend = Number(metadata?.usage?.estimatedCost ?? 0);
    return {
      stopPart: 'Spending',
      stopWhy: `Card cost limit $${limit.toFixed(2)} reached (card spend: $${spend.toFixed(4)})`,
    };
  }
  if (metadata?.part === 'Playbook') {
    return { stopPart: 'Playbook', stopWhy: String(metadata?.reason ?? reason ?? 'Playbook not chosen') };
  }
  if (metadata?.observerFailure || /observational-memory/i.test(`${id} ${reason ?? ''}`)) {
    return { stopPart: 'Memory', stopWhy: `Memory model failed: ${String(reason ?? 'unknown error')}` };
  }
  return { stopPart: id || 'Agent', stopWhy: String(reason ?? 'Agent aborted') };
}

export function reportText(state, detail) {
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
    '',
    'A second failure stops the card; the next step is an Investigation.',
  ].join('\n');
}
