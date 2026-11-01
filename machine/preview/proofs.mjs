// A proof is a command whose exit code this machine reads. The list depends on
// what the change touches: a change that never meets the dashboard is not
// proven by driving the dashboard, and a change that does meet it is.
import { missingProgram } from '../shipping/harness.mjs';

export const SERVER_TESTS = 'server tests';
export const LOCAL_TESTS = 'local tests';
export const DASHBOARD_PROOFS = 'dashboard proofs';

const SERVER = { name: SERVER_TESTS, argv: ['node', 'scripts/test-owners.mjs', '--run', 'server'], expects: 'tests', noSkips: true };
const LOCAL = { name: LOCAL_TESTS, argv: ['node', 'scripts/test-owners.mjs', '--run', 'local'], expects: 'tests' };

export function proofsFor(scope, { address = null } = {}) {
  // The pull request's own checks already run the local tests in CI. What CI
  // cannot run is the server suite, so that is the proof a machine change owes.
  if (scope !== 'dashboard') return [SERVER];
  return [SERVER, LOCAL, { name: DASHBOARD_PROOFS, argv: ['node', 'dashboard/scripts/lanes.mjs', '--url', address ?? ''], expects: 'lanes' }];
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

// The lanes print one line per lane and no summary, so the lines that name a
// lane are the whole of what the run says it did. A report of no lane is a run
// that drove nothing, and a report of fewer lanes than the checkout declares is
// a run that stopped partway.
export function lanesIn(output) {
  const seen = new Map();
  for (const match of plain(output).matchAll(/^lane (\d+) (PASS|FAIL)\b/gm)) seen.set(Number(match[1]), match[2]);
  const found = [...seen.values()];
  return { reported: found.length, pass: found.filter(result => result === 'PASS').length, fail: found.filter(result => result === 'FAIL').length };
}

// How many lanes the checkout under test declares, read from its own source so
// a run that drives three of eleven cannot report itself complete.
export function countLanes(source) {
  const text = typeof source === 'string' ? source : '';
  return [...text.matchAll(/^[ \t]*lane\((\d+)\s*,/gm)].length;
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

// A command that exits 0 having collected nothing proves nothing, so a proof
// says what it collected and what it should have collected. A test suite owes a
// summary with tests in it, a lane run owes a line per lane the checkout
// declares, and a suite whose tests skipped is a failure where skipping means
// the engine was missing.
export function proofResult({ proof, code, seconds = null, output = '', declared = null } = {}) {
  const counts = countsIn(output);
  const lanes = lanesIn(output);
  const skipped = skipsIn(output);
  const expects = proof?.expects ?? null;
  const expectedLanes = declared ?? proof?.declared ?? null;
  const gaps = [];
  if (expects !== 'tests' && expects !== 'lanes') {
    gaps.push('the proof does not say what it should have collected, so nothing is proven');
  }
  if (expects === 'tests') {
    if (!counts) gaps.push('printed no test summary, so nothing is proven');
    else if (counts.tests === 0) gaps.push('collected no tests, so nothing is proven');
  }
  if (expects === 'lanes') {
    if (lanes.reported === 0) gaps.push('reported no lane, so the dashboard was not driven');
    else if (expectedLanes && lanes.reported < expectedLanes) gaps.push(`reported ${lanes.reported} of ${expectedLanes} lanes, so part of the dashboard was never driven`);
  }
  if (proof?.noSkips && skipped > 0) gaps.push(`skipped ${skipped} test${skipped === 1 ? '' : 's'}, and a skipped proof is a failure`);
  const ran = counts === null
    ? (lanes.reported ? `, ${lanes.reported} lanes, ${lanes.pass} passed, ${lanes.fail} failed` : '')
    : `, ${counts.tests} tests, ${counts.pass} passed, ${counts.fail} failed`;
  const why = code === 0 ? gaps : [lastLines(output), ...gaps].filter(Boolean);
  return {
    name: proof?.name ?? '(unnamed proof)',
    command: Array.isArray(proof?.argv) ? proof.argv.join(' ') : '',
    ok: code === 0 && gaps.length === 0,
    code: typeof code === 'number' ? code : null,
    seconds,
    skipped,
    detail: `exited ${code ?? 'without a code'}${ran}${why.length ? `: ${why.join('; ')}` : ''}`,
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
