// A proof is a command whose exit code this machine reads. The list depends on
// what the change touches: a change that never meets the dashboard is not
// proven by driving the dashboard, and a change that does meet it is.
import { missingProgram } from '../shipping/harness.mjs';

export const SERVER_TESTS = 'server tests';
export const LOCAL_TESTS = 'local tests';
export const DASHBOARD_PROOFS = 'dashboard proofs';

const SERVER = { name: SERVER_TESTS, argv: ['node', 'scripts/test-owners.mjs', '--run', 'server'] };
const LOCAL = { name: LOCAL_TESTS, argv: ['node', 'scripts/test-owners.mjs', '--run', 'local'] };

export function proofsFor(scope, { address = null } = {}) {
  // The pull request's own checks already run the local tests in CI. What CI
  // cannot run is the server suite, so that is the proof a machine change owes.
  if (scope !== 'dashboard') return [SERVER];
  return [SERVER, LOCAL, { name: DASHBOARD_PROOFS, argv: ['node', 'dashboard/scripts/lanes.mjs', '--url', address ?? ''] }];
}

// `node --test` prints one summary line per run, and a skipped proof is a
// failure here: the six engine-backed tests skip on a runner with no Mastra
// Code program, and those six are exactly the ones this machine exists to run.
export function skipsIn(output) {
  if (typeof output !== 'string') return 0;
  let total = 0;
  for (const match of output.matchAll(/^\u2139 skipped (\d+)$/gm)) total += Number(match[1]);
  return total;
}

export function proofResult({ proof, code, seconds = null, output = '' } = {}) {
  return {
    name: proof?.name ?? '(unnamed proof)',
    command: Array.isArray(proof?.argv) ? proof.argv.join(' ') : '',
    ok: code === 0,
    code: typeof code === 'number' ? code : null,
    seconds,
    skipped: skipsIn(output),
    detail: code === 0 ? 'exited 0' : `exited ${code ?? 'without a code'}`,
  };
}

// A proof that cannot run leaves a failed line, never a missing one, because a
// proof nobody ran is the same to a reader as a proof that passed.
export function proofThatCouldNotRun(proof, reason) {
  return {
    name: proof?.name ?? '(unnamed proof)',
    command: Array.isArray(proof?.argv) ? proof.argv.join(' ') : '',
    ok: false,
    code: null,
    seconds: null,
    skipped: 0,
    detail: reason,
  };
}

// The engine-backed tests import Mastra from the installed program, so a runner
// without that program fails these proofs rather than quietly skipping them.
export function programReason() {
  return missingProgram();
}
