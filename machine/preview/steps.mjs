// The five moves of the machine, written as plain functions over injected
// dependencies so the decisions can be read and tested without a live server.
import { checksVerdict } from './checks.mjs';
import { DASHBOARD_PROOFS, LOCAL_TESTS, programReason, proofResult, proofThatCouldNotRun, proofsFor } from './proofs.mjs';
import { sameDigest } from './preview.mjs';
import { scopeOf, scopeReason } from './scope.mjs';

export const MAX_FAILS = 2;

async function persist(deps, state) {
  await deps.saveRecord(state);
  return state;
}

export async function gather(deps, input) {
  const card = await deps.getIssue(input.card);
  if (!card) throw new Error(`no card named ${input.card}`);
  const { sha: reported, files } = await deps.pullFiles(input.pr);
  const sha = await deps.prepareCheckout(input.pr, deps.runDir, deps.checkout);
  if (reported && sha && reported !== sha) {
    throw new Error(`the pull request moved while the machine read it: GitHub reports ${reported}, the checkout is at ${sha}`);
  }
  const scope = scopeOf(files);
  const state = {
    ...input,
    card,
    sha,
    checkout: deps.checkout,
    files,
    scope,
    scopeReason: scopeReason(scope, files),
    live: deps.liveStateDir ? { dir: deps.liveStateDir, before: deps.digest(deps.liveStateDir), after: null, unchanged: false } : null,
    preview: null,
    previewGap: null,
    checks: null,
    proofs: [],
    verdict: null,
    items: [],
    failing: [],
    failCount: 0,
    stopped: false,
    at: new Date().toISOString(),
  };
  return persist(deps, state);
}

export async function preview(deps, state) {
  if (state.scope !== 'dashboard') {
    return persist(deps, { ...state, preview: null, previewGap: null });
  }
  try {
    const built = await deps.buildPreview({ checkout: state.checkout, runDir: deps.runDir, sha: state.sha });
    return persist(deps, { ...state, preview: built, previewGap: null });
  } catch (error) {
    return persist(deps, { ...state, preview: null, previewGap: error.message });
  }
}

export async function checks(deps, state) {
  try {
    const runs = await deps.checkRuns(state.sha);
    return persist(deps, { ...state, checks: checksVerdict(runs, state.sha) });
  } catch (error) {
    // The pull request's checks decide whether the change is fit to look at. A
    // reader that could not reach them gets a failing line, not a silent pass.
    const failed = [`the pull request's checks could not be read: ${error.message}`];
    return persist(deps, { ...state, checks: { sha: state.sha, ok: false, items: [], failed, counts: { total: 0, passed: 0, failed: 0, skipped: 0 } } });
  }
}

export async function proofs(deps, state) {
  const address = state.preview?.address ?? null;
  const gap = programReason();
  const results = [];
  for (const proof of proofsFor(state.scope, { address })) {
    if (proof.name === DASHBOARD_PROOFS && !address) {
      results.push(proofThatCouldNotRun(proof, state.previewGap ?? 'the preview never answered, so there is no address to drive'));
      continue;
    }
    if (proof.name === LOCAL_TESTS && gap) {
      results.push(proofThatCouldNotRun(proof, `${gap}, so the engine-backed tests would skip and a skipped proof is a failure`));
      continue;
    }
    let run;
    try {
      run = await deps.runProof(proof);
    } catch (error) {
      results.push(proofThatCouldNotRun(proof, `the command could not be started: ${error.message}`));
      continue;
    }
    results.push(proofResult({ proof, code: run.code, seconds: run.seconds, output: run.output }));
  }
  return persist(deps, { ...state, proofs: results });
}

export async function settle(deps, state, { verdictOf, failedBefore = 0 } = {}) {
  await deps.stopPreview();
  const live = state.live ? { ...state.live, after: deps.digest(state.live.dir) } : null;
  if (live) live.unchanged = sameDigest(live.before, live.after);
  const judged = verdictOf({
    scope: state.scope,
    checks: state.checks,
    preview: state.preview,
    previewGap: state.previewGap,
    proofs: state.proofs,
    live,
  });
  const failCount = judged.ok ? 0 : failedBefore + 1;
  const record = {
    ...state,
    live,
    verdict: judged.verdict,
    items: judged.items,
    failing: judged.failing,
    failCount,
    stopped: !judged.ok && failCount >= MAX_FAILS,
    at: new Date().toISOString(),
  };
  await deps.saveRecord(record);
  const posted = await deps.post(record);
  return { ...record, posted };
}
