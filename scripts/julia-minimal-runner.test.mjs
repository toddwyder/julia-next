import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { runIssue, verdictOf } from './julia-minimal-runner.mjs';
import { localTester } from './julia-minimal-runner-checks.mjs';
import { linearAdapter, readAppCredential } from './julia-minimal-runner-adapters.mjs';

// The seam: runIssue(issueId, { base, repoRoot, worktreeRoot, adapters }).
// Git, the checks and the red proof are real (a fixture repo with a bare
// origin); only the four outside services -- Linear, Gemini, DeepSeek and
// the publisher -- are fakes, and each records its calls so a test can say
// an external effect happened exactly once.

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function write(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

const BASE_FILES = {
  'package.json': '{ "type": "module", "scripts": { "lint:framework": "node -e \\"\\"", "test": "node --test \\"scripts/*.test.mjs\\"" } }\n',
  'scripts/add.mjs': 'export const add = () => 0;\n',
  'CLAUDE.md': '# Rules\n\nSTANDARD-MARKER-CLAUDE: name things plainly.\n',
  'AGENTS.md': '# Agents\n\nSTANDARD-MARKER-AGENTS\n',
  'eslint.config.mjs': '// STANDARD-MARKER-ESLINT\nexport default [];\n',
  '.agents/skills/implement/SKILL.md': 'IMPLEMENT-SKILL-MARKER\n',
  '.agents/skills/tdd/SKILL.md': 'TDD-SKILL-MARKER\n',
  '.agents/skills/tdd/tests.md': 'TDD-TESTS-MARKER\n',
  '.agents/skills/tdd/mocking.md': 'TDD-MOCKING-MARKER\n',
  '.agents/skills/code-review/SKILL.md': 'CODE-REVIEW-SKILL-MARKER\n',
};

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'runner-fixture-'));
  const origin = join(root, 'origin.git');
  const repoRoot = join(root, 'repo');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', repoRoot]);
  git(repoRoot, 'config', 'user.email', 'fixture@example.com');
  git(repoRoot, 'config', 'user.name', 'Fixture');
  git(repoRoot, 'config', 'core.autocrlf', 'false');
  for (const [path, text] of Object.entries(BASE_FILES)) write(repoRoot, path, text);
  git(repoRoot, 'add', '.');
  git(repoRoot, 'commit', '-q', '-m', 'base');
  git(repoRoot, 'remote', 'add', 'origin', origin);
  git(repoRoot, 'push', '-q', 'origin', 'main');
  const base = git(repoRoot, 'rev-parse', 'HEAD');
  return { root, repoRoot, worktreeRoot: join(root, 'worktrees'), base };
}

const SEAMED_CARD = {
  identifier: 'JUL-900',
  title: 'add() adds',
  description: '## What\n\nadd(a, b) returns the sum.\n\n## Seams\n\n* Interface: `add(a, b)` in `scripts/add.mjs`\n* Tests: `scripts/add.test.mjs`\n* Kind: behavior\n',
};

// What a good Gemini turn leaves behind: a real fix plus a test at the seam.
function goodFix(cwd) {
  write(cwd, 'scripts/add.mjs', 'export const add = (a, b) => a + b;\n');
  write(cwd, 'scripts/add.test.mjs', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from './add.mjs';\ntest('add sums', () => assert.equal(add(2, 3), 5));\n");
}

function fakes({ card = SEAMED_CARD, geminiTurn = goodFix, verdicts = [{ spec: 'CLEAN', standards: 'CLEAN' }] } = {}) {
  const calls = { gemini: [], deepseek: [], publish: [], tests: [], uat: 0 };
  const comments = [];
  const adapters = {
    linear: {
      getCard: async () => ({ ...card, comments: comments.map((body) => ({ body })) }),
      comment: async (_id, body) => { comments.push(body); },
      moveToUat: async () => { calls.uat += 1; },
    },
    gemini: async (prompt, { cwd }) => {
      calls.gemini.push(prompt);
      geminiTurn(cwd, calls.gemini.length);
      return { ok: true };
    },
    deepseek: async (prompt, { axis }) => {
      calls.deepseek.push({ axis, prompt });
      const round = verdicts[Math.min(Math.floor((calls.deepseek.length - 1) / 2), verdicts.length - 1)];
      return { ok: true, text: `Review of ${axis}.\nVERDICT: ${round[axis]}\n` };
    },
    publish: async (request) => {
      calls.publish.push(request);
      return { url: 'https://example.test/pull/1' };
    },
    // The test worker: every lint, suite and seam-test run goes through here.
    // The fake runs them locally, the way the real worker runs them in its
    // own account on the server.
    tests: async (request) => {
      calls.tests.push(request);
      return localTester(request);
    },
  };
  return { adapters, calls, comments };
}

function run(fx, adapters, issueId = 'JUL-900') {
  return runIssue(issueId, { base: fx.base, repoRoot: fx.repoRoot, worktreeRoot: fx.worktreeRoot, adapters });
}

test('happy path: one Gemini turn, one review per axis, one PR, card to UAT', async () => {
  const fx = makeRepo();
  const { adapters, calls, comments } = fakes();
  const result = await run(fx, adapters);
  assert.equal(result.outcome, 'pr', result.reason);
  assert.equal(result.prUrl, 'https://example.test/pull/1');
  assert.equal(calls.gemini.length, 1);
  assert.deepEqual(calls.deepseek.map((c) => c.axis), ['spec', 'standards']);
  assert.equal(calls.publish.length, 1);
  assert.equal(calls.publish[0].sha, result.sha);
  assert.equal(calls.uat, 1);
  assert.ok(comments.length >= 4, 'one progress comment per step (implement, checks, review, PR)');
  rmSync(fx.root, { recursive: true, force: true });
});

// Crash once at a named point, then resume with the same command. Whatever
// had already happened before the crash must not happen a second time.
function crashOnce(adapters, where) {
  let armed = true;
  const trip = () => { if (armed) { armed = false; throw new Error(`crash at ${where}`); } };
  const { linear } = adapters;
  if (where === 'after-commit') {
    const comment = linear.comment;
    linear.comment = async (id, body) => { if (body.includes('runner: implement')) trip(); return comment(id, body); };
  }
  if (where === 'between-reviews') {
    // The Spec review is done; the Standards review is about to start.
    const comment = linear.comment;
    linear.comment = async (id, body) => { if (body.includes('runner: review-started') && body.includes('axis=standards')) trip(); return comment(id, body); };
  }
  if (where === 'after-review') {
    // After the review is on the card, before the runner says it is publishing.
    const comment = linear.comment;
    linear.comment = async (id, body) => { if (body.includes('runner: publishing')) trip(); return comment(id, body); };
  }
  if (where === 'after-pr') {
    const moveToUat = linear.moveToUat;
    linear.moveToUat = async (id) => { trip(); return moveToUat(id); };
  }
}

for (const where of ['after-commit', 'between-reviews', 'after-review', 'after-pr']) {
  test(`resume after a crash ${where} repeats no Gemini turn, review or PR`, async () => {
    const fx = makeRepo();
    const { adapters, calls } = fakes();
    crashOnce(adapters, where);
    await assert.rejects(run(fx, adapters), /crash at/);
    const result = await run(fx, adapters);
    assert.equal(result.outcome, 'pr', result.reason);
    assert.equal(calls.gemini.length, 1, 'Gemini ran once');
    assert.equal(calls.deepseek.length, 2, 'one review per axis, never repeated');
    assert.equal(calls.publish.length, 1, 'one PR');
    assert.equal(calls.uat, 1);
    rmSync(fx.root, { recursive: true, force: true });
  });
}

test('a tracked change in the checkout is refused before anything runs', async () => {
  const fx = makeRepo();
  write(fx.repoRoot, 'scripts/add.mjs', 'export const add = () => 1;\n');
  const { adapters, calls, comments } = fakes();
  const result = await run(fx, adapters);
  assert.equal(result.outcome, 'blocked');
  assert.match(result.reason, /uncommitted/);
  assert.equal(calls.gemini.length + calls.deepseek.length + calls.publish.length, 0);
  assert.match(comments.at(-1), /uncommitted/, 'the reason is on the card');
  rmSync(fx.root, { recursive: true, force: true });
});

test('a start commit that is not origin/main is refused before anything runs', async () => {
  const fx = makeRepo();
  write(fx.repoRoot, 'README.md', 'later\n');
  git(fx.repoRoot, 'add', '.');
  git(fx.repoRoot, 'commit', '-q', '-m', 'local only, never pushed');
  const { adapters, calls } = fakes();
  const result = await runIssue('JUL-900', { base: git(fx.repoRoot, 'rev-parse', 'HEAD'), repoRoot: fx.repoRoot, worktreeRoot: fx.worktreeRoot, adapters });
  assert.equal(result.outcome, 'blocked');
  assert.match(result.reason, /origin\/main/);
  assert.equal(calls.gemini.length, 0);
  rmSync(fx.root, { recursive: true, force: true });
});

test('a card with no Seams section, or one naming no test file, blocks before Gemini', async () => {
  for (const description of ['## What\n\nadd(a, b) returns the sum.\n', '## Seams\n\n* Interface: `add(a, b)`\n']) {
    const fx = makeRepo();
    const { adapters, calls } = fakes({ card: { ...SEAMED_CARD, description } });
    const result = await run(fx, adapters);
    assert.equal(result.outcome, 'blocked');
    assert.match(result.reason, /Seams/);
    assert.equal(calls.gemini.length, 0);
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("Gemini's brief carries the implement and tdd skills word for word, from the start commit", async () => {
  const fx = makeRepo();
  const { adapters, calls } = fakes();
  await run(fx, adapters);
  for (const marker of ['IMPLEMENT-SKILL-MARKER', 'TDD-SKILL-MARKER', 'TDD-TESTS-MARKER', 'TDD-MOCKING-MARKER', 'add(a, b) returns the sum.']) {
    assert.ok(calls.gemini[0].includes(marker), `brief is missing ${marker}`);
  }
  rmSync(fx.root, { recursive: true, force: true });
});

const TAUTOLOGICAL_TEST = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from './add.mjs';\ntest('add exists', () => assert.equal(typeof add, 'function'));\n";

test('red proof: a seam test that already passes on the start commit blocks the run before review', async () => {
  const fx = makeRepo();
  const { adapters, calls } = fakes({
    geminiTurn: (cwd) => { goodFix(cwd); write(cwd, 'scripts/add.test.mjs', TAUTOLOGICAL_TEST); },
  });
  const result = await run(fx, adapters);
  assert.equal(result.outcome, 'blocked');
  assert.match(result.reason, /red proof/);
  assert.equal(calls.deepseek.length, 0, 'no review of a change whose tests prove nothing');
  assert.equal(calls.publish.length, 0);
  rmSync(fx.root, { recursive: true, force: true });
});

test('red proof: a behaviour change that touches no seam test blocks the run', async () => {
  const fx = makeRepo();
  const { adapters, calls } = fakes({ geminiTurn: (cwd) => write(cwd, 'scripts/add.mjs', 'export const add = (a, b) => a + b;\n') });
  const result = await run(fx, adapters);
  assert.equal(result.outcome, 'blocked');
  assert.match(result.reason, /red proof/);
  assert.equal(calls.publish.length, 0);
  rmSync(fx.root, { recursive: true, force: true });
});

test('red proof: a refactor that edits its seam test blocks the run', async () => {
  const fx = makeRepo();
  write(fx.repoRoot, 'scripts/add.test.mjs', TAUTOLOGICAL_TEST);
  git(fx.repoRoot, 'add', '.');
  git(fx.repoRoot, 'commit', '-q', '-m', 'seam test');
  git(fx.repoRoot, 'push', '-q', 'origin', 'main');
  fx.base = git(fx.repoRoot, 'rev-parse', 'HEAD');
  const card = { ...SEAMED_CARD, description: SEAMED_CARD.description.replace('Kind: behavior', 'Kind: refactor') };
  const { adapters, calls } = fakes({ card, geminiTurn: goodFix });
  const result = await run(fx, adapters);
  assert.equal(result.outcome, 'blocked');
  assert.match(result.reason, /red proof/);
  assert.equal(calls.publish.length, 0);
  rmSync(fx.root, { recursive: true, force: true });
});

test('DeepSeek gets the whole diff, the card, the code-review skill and the pinned standards, word for word', async () => {
  const fx = makeRepo();
  const bigLine = 'x'.repeat(100);
  const big = `${Array.from({ length: 1500 }, (_, i) => `// ${i} ${bigLine}`).join('\n')}\n// END-OF-BIG-FILE\n`;
  const { adapters, calls } = fakes({ geminiTurn: (cwd) => { goodFix(cwd); write(cwd, 'scripts/big.mjs', big); } });
  const result = await run(fx, adapters);
  assert.equal(result.outcome, 'pr', result.reason);
  const [spec, standards] = calls.deepseek;
  for (const { prompt } of calls.deepseek) {
    assert.ok(prompt.includes('// END-OF-BIG-FILE'), 'the diff is not cut off');
    assert.ok(prompt.includes('// 1499 '), 'every line of the diff is there');
    assert.ok(prompt.includes('CODE-REVIEW-SKILL-MARKER'));
  }
  assert.ok(spec.prompt.includes('add(a, b) returns the sum.'), 'the Spec axis sees the card');
  for (const marker of ['STANDARD-MARKER-CLAUDE: name things plainly.', 'STANDARD-MARKER-AGENTS', 'STANDARD-MARKER-ESLINT']) {
    assert.ok(standards.prompt.includes(marker), `the Standards axis is missing ${marker}`);
  }
  rmSync(fx.root, { recursive: true, force: true });
});

// Two limits, one refusal: a review prompt over MAX_REVIEW_CHARS, and a diff
// over the 1 MB that Node's default git buffer would have crashed on.
for (const [limit, huge] of [['over the review size limit', `${'y'.repeat(120)}\n`.repeat(5000)], ['over a megabyte', `${'z'.repeat(200)}\n`.repeat(6000)]]) {
  test(`a diff ${limit} is refused with "split the card", on the card, and never reaches a review`, async () => {
    const fx = makeRepo();
    const { adapters, calls, comments } = fakes({ geminiTurn: (cwd) => { goodFix(cwd); write(cwd, 'scripts/huge.mjs', huge); } });
    const result = await run(fx, adapters);
    assert.equal(result.outcome, 'blocked');
    assert.match(result.reason, /split the card/);
    assert.equal(calls.deepseek.length, 0);
    assert.match(comments.at(-1), /split the card/);
    rmSync(fx.root, { recursive: true, force: true });
  });
}

test('review findings get exactly one correction round, with the findings in the second brief', async () => {
  const fx = makeRepo();
  const { adapters, calls } = fakes({ verdicts: [{ spec: 'FINDINGS', standards: 'CLEAN' }, { spec: 'CLEAN', standards: 'CLEAN' }] });
  adapters.gemini = async (prompt, { cwd }) => {
    calls.gemini.push(prompt);
    goodFix(cwd);
    if (calls.gemini.length === 2) write(cwd, 'scripts/add.mjs', 'export const add = (a, b) => a + b; // corrected\n');
    return { ok: true };
  };
  const result = await run(fx, adapters);
  assert.equal(result.outcome, 'pr', result.reason);
  assert.equal(calls.gemini.length, 2);
  assert.match(calls.gemini[1], /Review of spec\.\nVERDICT: FINDINGS/, 'the second brief carries the review');
  assert.equal(calls.deepseek.length, 4);
  assert.equal(calls.publish[0].sha, result.sha);
  assert.equal(git(fx.repoRoot, 'rev-list', '--count', `${fx.base}..${result.sha}`), '2');
  rmSync(fx.root, { recursive: true, force: true });
});

test('failing checks get the same one correction round, with the failure in the second brief', async () => {
  const fx = makeRepo();
  const { adapters, calls } = fakes({
    geminiTurn: (cwd, turn) => {
      goodFix(cwd);
      if (turn === 1) write(cwd, 'scripts/other.test.mjs', "import { test } from 'node:test';\ntest('broken', () => { throw new Error('boom'); });\n");
      else rmSync(join(cwd, 'scripts/other.test.mjs'));
    },
  });
  const result = await run(fx, adapters);
  assert.equal(result.outcome, 'pr', result.reason);
  assert.equal(calls.gemini.length, 2);
  assert.match(calls.gemini[1], /tests failed/);
  rmSync(fx.root, { recursive: true, force: true });
});

test('findings after the correction round block the run, with no PR', async () => {
  const fx = makeRepo();
  const { adapters, calls } = fakes({
    verdicts: [{ spec: 'CLEAN', standards: 'FINDINGS' }],
    geminiTurn: (cwd, turn) => { goodFix(cwd); write(cwd, 'scripts/add.mjs', `export const add = (a, b) => a + b; // turn ${turn}\n`); },
  });
  const result = await run(fx, adapters);
  assert.equal(result.outcome, 'blocked');
  assert.match(result.reason, /after the correction round/);
  assert.equal(calls.gemini.length, 2);
  assert.equal(calls.publish.length, 0);
  rmSync(fx.root, { recursive: true, force: true });
});

test('a Gemini turn that fails, or a review with no verdict, blocks with the reason', async () => {
  const fx = makeRepo();
  const { adapters, calls } = fakes();
  adapters.gemini = async () => ({ ok: false, reason: 'agy denied `git status`' });
  const denied = await run(fx, adapters);
  assert.equal(denied.outcome, 'blocked');
  assert.match(denied.reason, /agy denied `git status`/);
  rmSync(fx.root, { recursive: true, force: true });

  const fx2 = makeRepo();
  const second = fakes();
  second.adapters.deepseek = async () => ({ ok: true, text: 'Looks fine to me.' });
  const silent = await run(fx2, second.adapters);
  assert.equal(silent.outcome, 'blocked');
  assert.match(silent.reason, /no VERDICT line/);
  assert.equal(second.calls.publish.length, 0);
  assert.equal(calls.publish.length, 0);
  rmSync(fx2.root, { recursive: true, force: true });
});

test("Gemini's brief says it runs no shell commands: the test worker runs the tests", async () => {
  const fx = makeRepo();
  const { adapters, calls } = fakes();
  await run(fx, adapters);
  assert.match(calls.gemini[0], /Do not run any shell command/);
  // Live JUL-123 run, 24 Sep: Gemini read the worktree's `.git` pointer and
  // agy refused the read outside its folder, failing the turn.
  assert.match(calls.gemini[0], /Read only files inside your working folder, and never git's own data/);
  assert.match(calls.gemini[0], /the runner's test worker runs the tests after your turn/);
  assert.doesNotMatch(calls.gemini[0], /you may run is `npm test`/);
  rmSync(fx.root, { recursive: true, force: true });
});

test('every lint, suite and seam-test run goes through the test worker', async () => {
  const fx = makeRepo();
  const { adapters, calls } = fakes();
  const result = await run(fx, adapters);
  assert.equal(result.outcome, 'pr', result.reason);
  const kinds = calls.tests.map((request) => request.run);
  assert.deepEqual(kinds, ['files', 'files', 'lint', 'suite'], 'red proof on the candidate and on the start commit, then lint, then the suite');
  assert.deepEqual(calls.tests[0].files, ['scripts/add.test.mjs']);
  for (const request of calls.tests) assert.equal(request.worktree, worktreeOf(fx));
  rmSync(fx.root, { recursive: true, force: true });
});

test('a run without a test worker is refused before Gemini', async () => {
  const fx = makeRepo();
  const { adapters, calls } = fakes();
  delete adapters.tests;
  await assert.rejects(run(fx, adapters), /test worker/);
  assert.equal(calls.gemini.length, 0);
  rmSync(fx.root, { recursive: true, force: true });
});

test('a test that already fails on the start commit does not block the run; a new failure still does', async () => {
  const fx = makeRepo();
  write(fx.repoRoot, 'scripts/windows-only.test.mjs', "import { test } from 'node:test';\ntest('already broken here', () => { throw new Error('platform'); });\n");
  git(fx.repoRoot, 'add', '.');
  git(fx.repoRoot, 'commit', '-q', '-m', 'a test that fails on this machine');
  git(fx.repoRoot, 'push', '-q', 'origin', 'main');
  fx.base = git(fx.repoRoot, 'rev-parse', 'HEAD');
  const { adapters, calls, comments } = fakes();
  const result = await run(fx, adapters);
  assert.equal(result.outcome, 'pr', result.reason);
  assert.equal(calls.gemini.length, 1);
  assert.ok(comments.some((body) => body.includes('already broken here')), 'the card names the failure that was already there');
  rmSync(fx.root, { recursive: true, force: true });
});

// -- Commit integrity: the candidate under check, review and PR is exactly
// the commit the runner made, and nothing else is in the worktree.

const worktreeOf = (fx) => join(fx.worktreeRoot, 'card-900');

test('a worktree change during a review stops the run before the next review and the PR', async () => {
  const fx = makeRepo();
  const { adapters, calls } = fakes();
  const review = adapters.deepseek;
  adapters.deepseek = async (prompt, opts) => { write(worktreeOf(fx), 'stray.txt', 'x\n'); return review(prompt, opts); };
  const result = await run(fx, adapters);
  assert.equal(result.outcome, 'blocked');
  assert.match(result.reason, /uncommitted/);
  assert.equal(calls.deepseek.length, 1, 'the Standards review does not run on a changed candidate');
  assert.equal(calls.publish.length, 0);
  rmSync(fx.root, { recursive: true, force: true });
});

test('a new commit during a review stops the run: that review no longer describes HEAD', async () => {
  const fx = makeRepo();
  const { adapters, calls } = fakes();
  const review = adapters.deepseek;
  adapters.deepseek = async (prompt, opts) => {
    write(worktreeOf(fx), 'late.txt', 'x\n');
    git(worktreeOf(fx), 'add', '.');
    git(worktreeOf(fx), 'commit', '-q', '-m', 'late change');
    return review(prompt, opts);
  };
  const result = await run(fx, adapters);
  assert.equal(result.outcome, 'blocked');
  assert.match(result.reason, /HEAD is/);
  assert.equal(calls.publish.length, 0);
  rmSync(fx.root, { recursive: true, force: true });
});

test('a commit the runner did not make on its branch blocks a resume before any check or review', async () => {
  const fx = makeRepo();
  const { adapters, calls } = fakes();
  const comment = adapters.linear.comment;
  let armed = true;
  adapters.linear.comment = async (id, body) => { if (armed && body.includes('runner: checks')) { armed = false; throw new Error('crash at checks'); } return comment(id, body); };
  await assert.rejects(run(fx, adapters), /crash at/);
  write(worktreeOf(fx), 'foreign.txt', 'x\n');
  git(worktreeOf(fx), 'add', '.');
  git(worktreeOf(fx), 'commit', '-q', '-m', 'someone else');
  const result = await run(fx, adapters);
  assert.equal(result.outcome, 'blocked');
  assert.match(result.reason, /the runner did not make/);
  assert.equal(calls.deepseek.length, 0);
  rmSync(fx.root, { recursive: true, force: true });
});

// -- Progress and restart.

test('each phase is announced as it starts, and a worker\'s own progress is passed on', async () => {
  const fx = makeRepo();
  const { adapters } = fakes();
  const lines = [];
  adapters.progress = (line) => lines.push(line);
  const turn = adapters.gemini;
  adapters.gemini = async (prompt, opts) => { opts.onProgress('run_command npm test'); return turn(prompt, opts); };
  await run(fx, adapters);
  const order = ['Gemini turn 1', 'Gemini: run_command npm test', 'Red proof and checks', 'DeepSeek Spec review', 'DeepSeek Standards review', 'Publishing'];
  let at = -1;
  for (const phase of order) {
    const found = lines.findIndex((line, i) => i > at && line.includes(phase));
    assert.ok(found > at, `"${phase}" should be announced after "${lines[at] ?? 'start'}"; got:\n${lines.join('\n')}`);
    at = found;
  }
  rmSync(fx.root, { recursive: true, force: true });
});

test('an interrupted Gemini turn is announced on the card before it runs again, never repeated silently', async () => {
  const fx = makeRepo();
  const { adapters, calls, comments } = fakes();
  const turn = adapters.gemini;
  adapters.gemini = async (prompt, opts) => {
    if (calls.gemini.length === 0) { calls.gemini.push(prompt); write(opts.cwd, 'scripts/add.mjs', 'half done\n'); throw new Error('crash mid-turn'); }
    return turn(prompt, opts);
  };
  await assert.rejects(run(fx, adapters), /crash mid-turn/);
  const result = await run(fx, adapters);
  assert.equal(result.outcome, 'pr', result.reason);
  assert.equal(calls.gemini.length, 2);
  assert.ok(comments.some((body) => /turn 1 was interrupted/.test(body) && /1 uncommitted file/.test(body)), `comments:\n${comments.join('\n---\n')}`);
  assert.equal(git(fx.repoRoot, 'rev-list', '--count', `${fx.base}..${result.sha}`), '1', 'one commit, not two');
  rmSync(fx.root, { recursive: true, force: true });
});

test('a crash while publishing stops a resume instead of risking a second PR', async () => {
  const fx = makeRepo();
  const { adapters, calls } = fakes();
  const publish = adapters.publish;
  let armed = true;
  adapters.publish = async (request) => { const pr = await publish(request); if (armed) { armed = false; throw new Error('crash after the PR opened'); } return pr; };
  await assert.rejects(run(fx, adapters), /crash after the PR opened/);
  const result = await run(fx, adapters);
  assert.equal(result.outcome, 'blocked');
  assert.match(result.reason, /may already be open/);
  assert.equal(calls.publish.length, 1, 'no second PR');
  rmSync(fx.root, { recursive: true, force: true });
});


// -- From DeepSeek's round-1 review of c8a9fd6.

test('the Standards axis also gets CONTRIBUTING.md and CODING_STANDARDS.md when the start commit has them', async () => {
  const fx = makeRepo();
  write(fx.repoRoot, 'CONTRIBUTING.md', 'STANDARD-MARKER-CONTRIBUTING\n');
  git(fx.repoRoot, 'add', '.');
  git(fx.repoRoot, 'commit', '-q', '-m', 'contributing guide');
  git(fx.repoRoot, 'push', '-q', 'origin', 'main');
  fx.base = git(fx.repoRoot, 'rev-parse', 'HEAD');
  const { adapters, calls } = fakes();
  const result = await run(fx, adapters);
  assert.equal(result.outcome, 'pr', result.reason);
  assert.ok(calls.deepseek[1].prompt.includes('STANDARD-MARKER-CONTRIBUTING'));
  assert.ok(!calls.deepseek[1].prompt.includes('CODING_STANDARDS.md'), 'a file that does not exist is not named');
  rmSync(fx.root, { recursive: true, force: true });
});

test('each review axis says on the card that it has started', async () => {
  const fx = makeRepo();
  const { adapters, comments } = fakes();
  await run(fx, adapters);
  assert.ok(comments.some((body) => /DeepSeek's Spec review of `[0-9a-f]{12}` started/.test(body)));
  assert.ok(comments.some((body) => /DeepSeek's Standards review of `[0-9a-f]{12}` started/.test(body)));
  rmSync(fx.root, { recursive: true, force: true });
});

test('a resume does not run checks again that already passed for this commit', async () => {
  const fx = makeRepo();
  const { adapters } = fakes();
  const lines = [];
  adapters.progress = (line) => lines.push(line);
  const comment = adapters.linear.comment;
  let armed = true;
  adapters.linear.comment = async (id, body) => { if (armed && body.includes('runner: publishing')) { armed = false; throw new Error('crash before publishing'); } return comment(id, body); };
  await assert.rejects(run(fx, adapters), /crash before publishing/);
  const result = await run(fx, adapters);
  assert.equal(result.outcome, 'pr', result.reason);
  assert.equal(lines.filter((line) => line.includes('Red proof and checks')).length, 1, `checks ran more than once:\n${lines.join('\n')}`);
  rmSync(fx.root, { recursive: true, force: true });
});

test('the checks report names the suite scope that actually ran', async () => {
  const fx = makeRepo();
  const { adapters, comments } = fakes();
  await run(fx, adapters);
  assert.ok(comments.some((body) => body.includes('the `scripts/*.test.mjs` suite (the scope CI runs) passed')), comments.filter((b) => b.includes('Checks')).join('\n'));
  rmSync(fx.root, { recursive: true, force: true });
});

// -- The Linear app credential (Todd, 24 Sep): only the runner holds it,
// read at run time from systemd's credentials directory; nothing it produces
// may carry it. These run the REAL Linear adapter against a stand-in Linear.

const CLIENT_ID = 'client-id-XYZ789';
const CLIENT_SECRET = 'SECRET-abc123-do-not-leak';
const ACCESS_TOKEN = 'TOKEN-def456-do-not-leak';

function fakeLinear(card) {
  const requests = [];
  const comments = [];
  const answer = (data) => ({ ok: true, status: 200, json: async () => ({ data }) });
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    if (url === 'https://api.linear.app/oauth/token') return { ok: true, status: 200, json: async () => ({ access_token: ACCESS_TOKEN, expires_in: 2592000 }) };
    const { query, variables } = JSON.parse(init.body);
    if (query.includes('query Card')) {
      return answer({ issue: { id: 'uuid-900', identifier: card.identifier, title: card.title, description: card.description, team: { states: { nodes: [{ id: 'state-uat', name: 'UAT' }] } }, comments: { nodes: comments.map((body, i) => ({ body, createdAt: `2026-09-24T00:00:0${i}Z` })) } } });
    }
    if (query.includes('IssueIdByIdentifier')) return answer({ issue: { id: 'uuid-900' } });
    if (query.includes('CommentCreate')) { comments.push(variables.body); return answer({ commentCreate: { success: true, comment: { id: `c${comments.length}`, url: 'https://linear.test/c' } } }); }
    if (query.includes('mutation Move')) return answer({ issueUpdate: { success: true } });
    throw new Error(`unexpected Linear call: ${query.slice(0, 40)}`);
  };
  return { fetchImpl, requests, comments };
}

test('without the Linear app credential the run stops before any work, saying why', async () => {
  const fx = makeRepo();
  const { adapters, calls } = fakes();
  const { fetchImpl } = fakeLinear(SEAMED_CARD);
  adapters.linear = linearAdapter({ fetchImpl, readCredential: () => readAppCredential({ dir: undefined }) });
  await assert.rejects(run(fx, adapters), /Linear app credential is not available/);
  assert.equal(calls.gemini.length + calls.deepseek.length + calls.publish.length + calls.tests.length, 0);
  rmSync(fx.root, { recursive: true, force: true });
});

test('a whole run carries the Linear credential into nothing it produces', async () => {
  const fx = makeRepo();
  const credentials = mkdtempSync(join(tmpdir(), 'creds-'));
  writeFileSync(join(credentials, 'linear-app-id'), `${CLIENT_ID}\n`);
  writeFileSync(join(credentials, 'linear-app-secret'), `${CLIENT_SECRET}\n`);
  const { adapters, calls } = fakes();
  const linear = fakeLinear(SEAMED_CARD);
  adapters.linear = linearAdapter({ fetchImpl: linear.fetchImpl, readCredential: () => readAppCredential({ dir: credentials }) });
  const progress = [];
  adapters.progress = (line) => progress.push(line);
  const result = await run(fx, adapters);
  assert.equal(result.outcome, 'pr', result.reason);

  const [tokenRequest, ...linearCalls] = linear.requests;
  assert.equal(tokenRequest.url, 'https://api.linear.app/oauth/token', 'the credential goes to Linear\'s token endpoint and nowhere else');
  assert.ok(tokenRequest.init.body.includes(CLIENT_SECRET));
  for (const call of linearCalls) {
    assert.equal(call.url, 'https://api.linear.app/graphql');
    assert.equal(call.init.headers.Authorization, `Bearer ${ACCESS_TOKEN}`, 'the token travels only in the Authorization header');
  }
  const produced = {
    'Gemini briefs': calls.gemini.join('\n'),
    'DeepSeek prompts': calls.deepseek.map((c) => c.prompt).join('\n'),
    'test worker requests': JSON.stringify(calls.tests),
    'the PR (title, body, branch)': JSON.stringify(calls.publish),
    'Linear comments': linear.comments.join('\n'),
    'Linear request bodies': linearCalls.map((c) => c.init.body).join('\n'),
    'progress lines': progress.join('\n'),
    'the run result': JSON.stringify(result),
    'git history and diff': git(fx.repoRoot, 'log', '-p', '--all'),
    'files in the worktree': spawnSync('git', ['grep', '-I', '-e', CLIENT_SECRET, '-e', ACCESS_TOKEN, '-e', CLIENT_ID], { cwd: worktreeOf(fx), encoding: 'utf8' }).stdout,
  };
  for (const [where, text] of Object.entries(produced)) {
    for (const value of [CLIENT_ID, CLIENT_SECRET, ACCESS_TOKEN]) assert.ok(!text.includes(value), `${where} must not contain a credential`);
  }
  rmSync(credentials, { recursive: true, force: true });
  rmSync(fx.root, { recursive: true, force: true });
});

test('a fresh worktree gets its dependencies installed from the start commit\'s lockfile', async () => {
  const fx = makeRepo();
  write(fx.repoRoot, 'package-lock.json', '{ "name": "fixture", "lockfileVersion": 3, "requires": true, "packages": { "": { "name": "fixture" } } }\n');
  git(fx.repoRoot, 'add', '.');
  git(fx.repoRoot, 'commit', '-q', '-m', 'lockfile');
  git(fx.repoRoot, 'push', '-q', 'origin', 'main');
  fx.base = git(fx.repoRoot, 'rev-parse', 'HEAD');
  const { adapters } = fakes();
  const lines = [];
  adapters.progress = (line) => lines.push(line);
  const result = await run(fx, adapters);
  assert.equal(result.outcome, 'pr', result.reason);
  assert.ok(lines.some((line) => /npm ci/.test(line)), lines.join('\n'));
  rmSync(fx.root, { recursive: true, force: true });
});

test('the verdict line is read even when DeepSeek formats it as code or bold', () => {
  // Round 2 on e23b298 (24 Sep): DeepSeek ended its report with `VERDICT: CLEAN`
  // in backticks, which the runner read as no verdict at all.
  for (const line of ['VERDICT: CLEAN', '`VERDICT: CLEAN`', '**VERDICT: CLEAN**', '  VERDICT:  CLEAN  ']) {
    assert.equal(verdictOf(`Report.\n\n${line}\n`), 'CLEAN', line);
  }
  assert.equal(verdictOf('Report.\n`VERDICT: FINDINGS`'), 'FINDINGS');
  assert.equal(verdictOf('The verdict: CLEAN, I think.'), null, 'prose is not a verdict line');
  assert.equal(verdictOf('VERDICT: CLEAN-ish'), null);
});
