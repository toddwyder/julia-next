// julia-minimal-runner-checks.mjs -- the red proof and the checks for
// julia-minimal-runner.mjs (JUL-122). The runner never runs a candidate's
// tests itself: every lint, suite and seam-test run is a request to the test
// worker, `test({ worktree, run, files })`, which on the server runs in its
// own account with no access to the runner's Linear credential. Git work
// (switching the worktree between commits) stays with the runner.
import { spawnSync } from 'node:child_process';

// A large buffer so a big diff is measured and refused by the review size
// limit, instead of overflowing Node's 1 MB default and crashing the run.
export function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
  return result.stdout.trim();
}

// The three runs a test worker will do, and nothing else. `files` must be
// test files inside the worktree.
export const TEST_RUNS = {
  lint: { command: 'npm', args: ['run', 'lint:framework'] },
  runnerSuite: { command: 'node', args: ['scripts/julia-runner-suite.mjs'] },
  suite: { command: 'node', args: ['--test', '--test-reporter=spec', 'scripts/*.test.mjs'] },
  // The spec reporter always: Node 22 prints TAP off a terminal, and the
  // regression comparison reads the spec reporter's "✖ name" lines.
  files: { command: 'node', args: ['--test', '--test-reporter=spec'] },
};

export function testCommand({ run, files = [] }) {
  const spec = TEST_RUNS[run];
  if (!spec) throw new Error(`the test worker runs only ${Object.keys(TEST_RUNS).join(', ')}, not ${JSON.stringify(run)}`);
  if (run !== 'files') return { command: spec.command, args: spec.args };
  const safe = files.length > 0 && files.every((file) => /^[\w./-]+\.test\.mjs$/.test(file) && !file.split('/').includes('..'));
  if (!safe) throw new Error(`the test worker runs only test files inside the worktree, not ${JSON.stringify(files)}`);
  return { command: spec.command, args: [...spec.args, ...files] };
}

// A `node --test` started from inside another test run inherits
// NODE_TEST_CONTEXT and then exits 0 even when its tests fail (measured
// 24 Sep, Node 24). No test run may inherit it.
const { NODE_TEST_CONTEXT: _inherited, ...TEST_ENV } = process.env;

// The test worker as a plain local process: what the fixture tests use, and
// what the server's worker does inside its own account.
export async function localTester(request, { env = TEST_ENV } = {}) {
  const { command, args } = testCommand(request);
  const result = spawnSync(command, args, { cwd: request.worktree, encoding: 'utf8', env, shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const SUITE_SCOPE = 'the `scripts/*.test.mjs` suite (the scope CI runs)';
const failedTests = (output) => new Set([...String(output).matchAll(/^✖ (.+?) \([\d.]+m?s\)\s*$/gm)].map((match) => match[1]));

// Run `check` with the worktree switched to `commit`, optionally carrying some
// of the candidate's files along, then put the branch back exactly.
export async function onCommit({ worktree, branch, commit, carry = [], sha }, check) {
  git(worktree, 'checkout', '-q', '--detach', commit);
  try {
    if (carry.length) git(worktree, 'checkout', '-q', sha, '--', ...carry);
    return await check();
  } finally {
    git(worktree, 'checkout', '-q', '-f', branch);
  }
}

// The lint must pass. The suite may fail only in tests that already failed on
// the start commit: on the Windows laptop two tests fail for path reasons
// before any change (24 Sep), and a change is judged on what it breaks.
export async function runChecks({ worktree, branch, base, test, strict = false }) {
  const lint = await test({ worktree, run: 'lint' });
  if (lint.status !== 0) return { pass: false, summary: 'lint failed (`npm run lint:framework`)', output: lint.output.slice(-4000) };
  const suite = await test({ worktree, run: 'suite' });
  if (suite.status === 0) return { pass: true, summary: `lint:framework and ${SUITE_SCOPE} passed`, output: '' };
  if (strict) return { pass: false, summary: 'candidate suite failed or did not complete', output: suite.output };
  const failed = [...failedTests(suite.output)];
  const before = failed.length
    ? await onCommit({ worktree, branch, commit: base }, async () => failedTests((await test({ worktree, run: 'suite' })).output))
    : new Set();
  const fresh = failed.filter((name) => !before.has(name));
  if (!failed.length || fresh.length) {
    return { pass: false, summary: `tests failed (\`node --test scripts/*.test.mjs\`):${fresh.join('; ') || 'the suite did not run'}`, output: suite.output.slice(-4000) };
  }
  return { pass: true, summary: `lint:framework passed, and ${SUITE_SCOPE} passed except ${failed.length} test(s) that already fail on the start commit: ${failed.join('; ')}`, output: '' };
}

// The red proof. A behaviour change must change a seam test that fails on the
// start commit and passes on the candidate; otherwise its tests prove nothing.
// A refactor must leave its seam tests untouched and green on both commits.
// Returns a reason the proof failed, or null.
export async function redProof({ worktree, branch, base, sha, seams, test }) {
  const passes = async (files) => (await test({ worktree, run: 'files', files })).status === 0;
  const atSeam = (paths) => paths.filter((path) => seams.tests.some((seam) => path.endsWith(seam)));
  const changedTests = atSeam(git(worktree, 'diff', '--name-only', '--diff-filter=AM', `${base}...${sha}`).split('\n').filter(Boolean));
  if (seams.kind === 'refactor') {
    const edited = atSeam(git(worktree, 'diff', '--name-only', `${base}...${sha}`).split('\n').filter(Boolean));
    if (edited.length) return `red proof: a refactor must leave its seam tests unchanged, but it edits ${edited.join(', ')}`;
    const existing = atSeam(git(worktree, 'ls-tree', '-r', '--name-only', base).split('\n'));
    if (!existing.length) return `red proof: the seam tests (${seams.tests.join(', ')}) do not exist on the start commit`;
    if (!(await passes(existing))) return 'red proof: the seam tests fail on the candidate';
    if (!(await onCommit({ worktree, branch, commit: base }, () => passes(existing)))) return 'red proof: the seam tests already fail on the start commit';
    return null;
  }
  if (!changedTests.length) return `red proof: the change adds or changes none of the seam tests (${seams.tests.join(', ')})`;
  if (!(await passes(changedTests))) return 'red proof: the seam tests fail on the candidate';
  const greenOnBase = await onCommit({ worktree, branch, commit: base, carry: changedTests, sha }, () => passes(changedTests));
  if (greenOnBase) return `red proof: ${changedTests.join(', ')} already pass on the start commit, so they do not test the change`;
  return null;
}
