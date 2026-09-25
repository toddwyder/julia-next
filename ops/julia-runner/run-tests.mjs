// run-tests.mjs -- the test worker for julia-minimal-runner (JUL-122).
//
// Installed root-owned at /opt/julia-runner/ops/julia-runner/run-tests.mjs and
// started only by `sudo -n -u julia-tester /usr/bin/node <this file>` (./sudoers).
// No model is involved: it reads {worktree, run, files, limit_seconds} as JSON
// on stdin, runs one of the approved test commands in that worktree (the lint,
// the suite, or named test files -- see TEST_RUNS in the checks module), and
// answers with one JSON line {status, output}. julia-tester has no groups
// beyond the worktree group and no service keys, so a test Gemini wrote runs
// with nothing to steal. A run past its time limit (JUL-126) is stopped with
// everything it started; the worker then exits 124 and says so on stderr.
// While the tests print, it also prints {"progress":true} lines, at most one a
// second, so the graph can show the card moving.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { localTester, testCommand } from '../../scripts/julia-minimal-runner-checks.mjs';
import { worktreeProblem } from './run-gemini.mjs';
import { LIMITS, limitSeconds, runLimited, STOPPED_EXIT, stoppedLine } from './time-limit.mjs';

// The worktree belongs to the runner's account, so git refuses to work in it
// as julia-tester ("dubious ownership"), and tests that run git fail for
// that reason alone. Trust exactly this worktree, for this run only: git
// 2.43 on the server has no wildcard for the worktrees folder, and a
// standing "trust everything" setting would be wider than this needs.
const testEnv = (worktree) => ({
  HOME: homedir(), PATH: '/usr/bin:/bin', LANG: 'C.UTF-8',
  GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: worktree,
});

export async function answer(request, { tester = localTester, problem = worktreeProblem } = {}) {
  const refused = problem(request?.worktree);
  if (refused) return { status: 2, output: refused };
  try {
    return await tester({ worktree: request.worktree, run: request.run, files: request.files ?? [] }, { env: testEnv(request.worktree) });
  } catch (error) {
    return { status: 2, output: `refused: ${error.message}` };
  }
}

// The most test output kept for the answer; beyond it, the oldest is dropped.
export const MAX_OUTPUT = 16 * 1024 * 1024;

// What the server's worker does: the same test run, under its time limit.
// onOutput is called whenever the tests print, so the graph sees them moving.
export async function answerWithin(request, { run = runLimited, problem = worktreeProblem, onOutput = () => {} } = {}) {
  const refused = problem(request?.worktree);
  if (refused) return { status: 2, output: refused };
  let command;
  try {
    command = testCommand({ run: request.run, files: request.files ?? [] });
  } catch (error) {
    return { status: 2, output: `refused: ${error.message}` };
  }
  const seconds = limitSeconds(request.limit_seconds, LIMITS.tests);
  let output = '';
  const collect = (chunk) => {
    output += chunk;
    if (output.length > MAX_OUTPUT) output = output.slice(-MAX_OUTPUT);
    onOutput();
  };
  const options = { cwd: request.worktree, env: testEnv(request.worktree), stdio: ['ignore', 'pipe', 'pipe'] };
  const result = await run(command.command, command.args, options, {
    seconds, started: (child) => { child.stdout.on('data', collect); child.stderr.on('data', collect); },
  });
  if (result.stopped) return { status: STOPPED_EXIT, stopped: true, output: stoppedLine(seconds) };
  if (result.error) return { status: 2, output: `refused: the test command did not start: ${result.error.message}` };
  return { status: result.code ?? 1, output };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // A progress line at most once a second while the tests print; the answer is the last line.
  let last = 0;
  const onOutput = () => {
    if (Date.now() - last < 1000) return;
    last = Date.now();
    process.stdout.write('{"progress":true}\n');
  };
  answerWithin(JSON.parse(readFileSync(0, 'utf8')), { onOutput }).then((reply) => {
    if (reply.stopped) {
      console.error(reply.output);
      process.exit(STOPPED_EXIT);
    }
    process.stdout.write(`${JSON.stringify(reply)}\n`);
  });
}
