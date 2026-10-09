import { isDeepStrictEqual } from 'node:util';

// Continuation of a saved independent PASS. No worker calls or tracker writes.
// Writes are journalled before execution. Ambiguous writes require inspection;
// a restart never guesses whether a push, merge, or rollback happened.
export async function continueRelease(input, services) {
  const { issueId, commit, handoffPath, worktree, configuration, decision } = input;
  const binding = { issueId, commit, handoffPath, worktree, configuration };
  let state = await services.load();
  const park = reason => ({ outcome: 'park', reason });
  if (!/^[a-f0-9]{40}$/i.test(commit ?? '') || !configuration || !worktree?.path) return park('missing reviewed release input');
  if (state && !isDeepStrictEqual(state.binding, binding)) return park('release configuration or reviewed input changed');
  state ??= { schema: 1, binding, actions: [], stage: 'publish' };
  const persist = () => services.save(state);
  if (state.result) return state.result;
  if (state.actions.some(action => action.status === 'started')) return park('an external release write was interrupted; inspect its saved journal before continuing');
  if (!await services.verify(binding)) return park('saved independent PASS or exact clean candidate could not be verified');
  const write = async (kind, operation) => {
    const done = state.actions.find(action => action.kind === kind && action.status === 'done');
    if (done) return done.result;
    const action = { kind, status: 'started', startedAt: new Date().toISOString() };
    state.actions.push(action); await persist();
    action.result = await operation(); action.status = 'done'; await persist();
    return action.result;
  };
  state.pr ??= await write('publish', () => services.publish(binding));
  state.preview ??= await services.preview(binding);
  if (!state.preview?.ready) { state.preview = null; state.stage = 'preview'; await persist(); return { outcome: 'awaiting-preview', pr: state.pr }; }
  if (state.preview.commit !== commit) return park('preview does not belong to the reviewed commit');
  state.stage = 'uat'; await persist();
  if (!state.acceptance) {
    if (!decision) return { outcome: 'awaiting-uat', pr: state.pr, preview: state.preview, commit };
    if (decision.issueId !== issueId || decision.commit !== commit || decision.previewId !== state.preview.id || decision.previewUrl !== state.preview.url || decision.decidedBy !== (configuration.uatOperator ?? 'Todd')) return park('UAT decision must name this issue, reviewed commit, preview and Todd');
    if (decision.decision === 'send-back') { state.result = { outcome: 'sent-back', reason: decision.reason ?? 'Todd requested changes', preview: state.preview }; await persist(); return state.result; }
    if (decision.decision !== 'accept') return park('unknown UAT decision');
    state.acceptance = decision; await persist();
  }
  if (!state.merge) {
    const gate = await services.mergeGate({ ...binding, pr: state.pr });
    if (!gate.pass || gate.head !== commit || !gate.previous?.id) return park('PR head, required checks, or prior production deployment could not be verified');
    state.previous = gate.previous; await persist();
    state.merge = await write('merge', () => services.merge({ ...binding, pr: state.pr }));
    if (!/^[a-f0-9]{40}$/i.test(state.merge?.commit ?? '')) return park('merge response has no immutable commit');
    state.stage = 'production'; await persist();
  }
  try { state.production ??= await services.production({ ...binding, mergedCommit: state.merge.commit }); }
  catch (error) { state.productionObservation = { outcome: 'park', reason: 'production observation failed; inspect Vercel and resume monitoring', mergedCommit: state.merge.commit, diagnostic: error.diagnostic ?? { operation: 'production observation', code: 'UNEXPECTED_ERROR' } }; await persist(); return state.productionObservation; }
  if (!state.production?.ready) { state.production = null; state.productionObservation = { outcome: 'awaiting-production', reason: 'bounded production observation timed out; resume monitoring this merged commit', mergedCommit: state.merge.commit }; await persist(); return state.productionObservation; }
  if (state.production.commit !== state.merge.commit) return park('production deployment does not belong to the merged commit');
  if (!state.smoke) {
    try { state.smoke = state.merge.treeMatches === false ? { pass: false, reason: 'merged tree differs from reviewed tree' } : state.production.failed ? { pass: false, reason: state.production.reason } : await services.smoke({ ...binding, deployment: state.production, mergedCommit: state.merge.commit }); }
    catch { state.smoke = { pass: false, reason: 'production smoke could not finish; inspect smoke evidence' }; }
    await persist();
  }
  if (state.smoke.pass === true) state.result = { outcome: 'released', pr: state.pr, production: state.production, mergedCommit: state.merge.commit };
  else {
    state.rollback = await write('rollback', () => services.rollback({ ...binding, previous: state.previous, failed: state.production }));
    state.result = { outcome: state.rollback?.pass === true ? 'rolled-back' : 'rollback-failed', smoke: state.smoke, rollback: state.rollback, mergedCommit: state.merge.commit };
  }
  state.stage = 'finished'; await persist(); return state.result;
}
