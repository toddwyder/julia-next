import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { agyArgs, allowListProblem, worktreeProblem } from '../ops/julia-runner/run-gemini.mjs';
import { answer } from '../ops/julia-runner/run-tests.mjs';
import { sudoCommand, WORKER_ACCOUNTS } from './julia-minimal-runner-adapters.mjs';

// The server side of julia-minimal-runner (JUL-122): the worker wrappers and
// the sudo rules that start them. The rules are the security boundary between
// the runner (which holds the Linear credential) and its workers.

const SUDOERS = readFileSync(fileURLToPath(new URL('../ops/julia-runner/sudoers', import.meta.url)), 'utf8');
const rules = SUDOERS.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'));

test('the sudo rules are exactly the three worker commands the runner uses, and nothing wider', () => {
  assert.equal(rules.length, 3);
  const expected = Object.keys(WORKER_ACCOUNTS).map((worker) => {
    const [, , account, , ...command] = sudoCommand(worker);
    return `orchestrator-svc ALL=(${account}) NOPASSWD: ${command.join(' ')}`;
  });
  assert.deepEqual(rules.sort(), expected.sort());
  for (const rule of rules) {
    assert.doesNotMatch(rule, /[*?[\]\\]|ALL\s*$|\(ALL|\(root\)/, `no wildcards, no ALL, no root: ${rule}`);
    for (const path of rule.match(/\/\S+/g)) assert.match(path, /^\/usr\/bin\/node$|^\/opt\/julia-runner\//, `every path is root-owned: ${path}`);
  }
  assert.ok(!rules.some((rule) => rule.includes('orchestrator-svc)')), 'nobody becomes the runner\'s own account');
});

test('the Gemini and test workers accept only a card worktree under /srv/julia-runner/worktrees', () => {
  const same = (path) => path;
  assert.equal(worktreeProblem('/srv/julia-runner/worktrees/card-123', { realpath: same }), null);
  for (const bad of ['/srv/julia-runner/worktrees/card-1/../../repo', '/srv/julia-runner/repo', '/home/orchestrator-svc', 'card-1', '/srv/julia-runner/worktrees/card-x', undefined]) {
    assert.match(worktreeProblem(bad, { realpath: same }), /^refused/, String(bad));
  }
  assert.match(worktreeProblem('/srv/julia-runner/worktrees/card-5', { realpath: () => '/etc' }), /resolves to \/etc/, 'a symlink out is refused');
});

test('Gemini\'s own agy allow list must be empty: it runs no command at all', () => {
  assert.equal(allowListProblem(null), null);
  assert.equal(allowListProblem(JSON.stringify({ permissions: { allow: [] } })), null);
  assert.match(allowListProblem(JSON.stringify({ permissions: { allow: ['command(npm test)'] } })), /must be empty.*npm test/);
  assert.match(allowListProblem('{ unreadable'), /could not be read/);
});

test('agy runs headless in the worktree, never with permissions skipped', () => {
  const args = agyArgs('the brief', '/srv/julia-runner/worktrees/card-9');
  for (const flag of ['--dangerously-skip-permissions', '--sandbox', '--project']) assert.ok(!args.includes(flag), flag);
  assert.deepEqual(args.slice(0, 4), ['--add-dir', '/srv/julia-runner/worktrees/card-9', '--mode', 'accept-edits'], 'edits allowed in the worktree only; commands stay refused');
  assert.equal(args[args.indexOf('--print-timeout') + 1], '0', 'no five-minute cut-off on a turn');
  assert.equal(args.at(-2), '--print');
  assert.equal(args.at(-1), 'Your working folder is /srv/julia-runner/worktrees/card-9.\n\nthe brief');
});

test('the test worker refuses anything but an approved run in a card worktree', async () => {
  const fine = () => null;
  const ran = [];
  const tester = async (request, { env }) => { ran.push({ request, env }); return { status: 0, output: 'ok' }; };
  assert.deepEqual(await answer({ worktree: '/srv/julia-runner/worktrees/card-1', run: 'suite' }, { tester, problem: fine }), { status: 0, output: 'ok' });
  assert.deepEqual(Object.keys(ran[0].env).sort(), ['HOME', 'LANG', 'PATH'], 'tests run with HOME, PATH and LANG only');
  assert.match((await answer({ worktree: '/elsewhere', run: 'suite' }, { tester })).output, /^refused/);
  const real = await answer({ worktree: '/srv/julia-runner/worktrees/card-1', run: 'rm -rf /' }, { problem: fine });
  assert.equal(real.status, 2);
  assert.match(real.output, /runs only lint, suite, files/);
  const escape = await answer({ worktree: '/srv/julia-runner/worktrees/card-1', run: 'files', files: ['../../etc/x.test.mjs'] }, { problem: fine });
  assert.match(escape.output, /only test files inside the worktree/);
});

test('every test run asks for the spec reporter, whose failure lines the checks read', async () => {
  // Measured 24 Sep: Node 22 on the server prints TAP when not on a terminal,
  // so the "✖ name" lines the regression comparison reads would be missing.
  const { testCommand } = await import('./julia-minimal-runner-checks.mjs');
  assert.deepEqual(testCommand({ run: 'files', files: ['scripts/a.test.mjs'] }).args, ['--test', '--test-reporter=spec', 'scripts/a.test.mjs']);
  // The suite is run directly, not through package.json: the start commit a
  // card branches from need not have a `test` script (origin/main has none).
  assert.deepEqual(testCommand({ run: 'suite' }), { command: 'node', args: ['--test', '--test-reporter=spec', 'scripts/*.test.mjs'] });
});
