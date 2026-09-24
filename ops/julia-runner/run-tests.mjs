// run-tests.mjs -- the test worker for julia-minimal-runner (JUL-122).
//
// Installed root-owned at /opt/julia-runner/ops/julia-runner/run-tests.mjs and
// started only by `sudo -n -u julia-tester /usr/bin/node <this file>` (./sudoers).
// No model is involved: it reads {worktree, run, files} as JSON on stdin, runs
// one of the approved test commands in that worktree (the lint, the suite, or
// named test files -- see TEST_RUNS in the checks module), and answers with one
// JSON line {status, output}. julia-tester has no groups beyond the worktree
// group and no service keys, so a test Gemini wrote runs with nothing to steal.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { localTester } from '../../scripts/julia-minimal-runner-checks.mjs';
import { worktreeProblem } from './run-gemini.mjs';

export async function answer(request, { tester = localTester, problem = worktreeProblem } = {}) {
  const refused = problem(request?.worktree);
  if (refused) return { status: 2, output: refused };
  // The worktree belongs to the runner's account, so git refuses to work in it
  // as julia-tester ("dubious ownership"), and tests that run git fail for
  // that reason alone. Trust exactly this worktree, for this run only: git
  // 2.43 on the server has no wildcard for the worktrees folder, and a
  // standing "trust everything" setting would be wider than this needs.
  const trustThisWorktree = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: request.worktree };
  try {
    return await tester({ worktree: request.worktree, run: request.run, files: request.files ?? [] }, {
      env: { HOME: homedir(), PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', ...trustThisWorktree },
    });
  } catch (error) {
    return { status: 2, output: `refused: ${error.message}` };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  answer(JSON.parse(readFileSync(0, 'utf8'))).then((reply) => process.stdout.write(`${JSON.stringify(reply)}\n`));
}
