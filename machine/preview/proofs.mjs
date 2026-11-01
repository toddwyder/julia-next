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

// test-owners colours its output, so the summary lines arrive wrapped in escape
// codes and a plain `^` anchor would never see them.
function plain(output) {
  return typeof output === 'string' ? output.replace(/\u001b\[[0-9;]*m/g, '') : '';
}

// `node --test` prints one summary line per run, and a skipped proof is a
// failure here: the six engine-backed tests skip on a runner with no Mastra
// Code program, and those six are exactly the ones this machine exists to run.
export function skipsIn(output) {
  let total = 0;
  for (const match of plain(output).matchAll(/^\u2139 skipped (\d+)$/gm)) total += Number(match[1]);
  return total;
}

// A command that exits 0 having collected nothing proves nothing, so the counts
// go on the line and an empty run is a failure. The dashboard lanes print no
// counts, which is why a missing summary is not itself a failure.
export function countsIn(output) {
  const text = plain(output);
  const tests = text.match(/^\u2139 tests (\d+)$/m);
  if (!tests) return null;
  const count = name => Number(text.match(new RegExp(`^\u2139 ${name} (\\d+)$`, 'm'))?.[1] ?? 0);
  return { tests: Number(tests[1]), pass: count('pass'), fail: count('fail') };
}

// A failed proof says what went wrong on the same line, because a reader who
// never sees the terminal cannot open the log of a run that happened elsewhere.
// The lines that name a failure come before the last lines printed: a suite that
// fails early keeps printing passes afterwards.
const NAMES_A_FAILURE = /(\bFAIL\b|\bfailing\b|\u2716|not ok|Error:|AssertionError)/;

export function lastLines(output, count = 3) {
  const lines = plain(output).split('\n').map(line => line.trim()).filter(Boolean);
  const named = lines.filter(line => NAMES_A_FAILURE.test(line));
  const tail = (named.length ? named : lines).slice(-count).join('; ');
  return tail.length > 400 ? `${tail.slice(0, 399)}\u2026` : tail;
}

export function proofResult({ proof, code, seconds = null, output = '' } = {}) {
  const counts = countsIn(output);
  const empty = counts !== null && counts.tests === 0;
  const ran = counts === null ? '' : `, ${counts.tests} tests, ${counts.pass} passed, ${counts.fail} failed`;
  const failed = code !== 0 && !empty;
  const tail = failed ? lastLines(output) : '';
  return {
    name: proof?.name ?? '(unnamed proof)',
    command: Array.isArray(proof?.argv) ? proof.argv.join(' ') : '',
    ok: code === 0 && !empty,
    code: typeof code === 'number' ? code : null,
    seconds,
    skipped: skipsIn(output),
    detail: code === 0 ? `exited 0${ran}${empty ? ': nothing ran, so nothing was proven' : ''}` : `exited ${code ?? 'without a code'}${ran}${tail ? `: ${tail}` : ''}`,
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
