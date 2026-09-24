// julia-minimal-runner.mjs -- the fixed-route stopgap (JUL-122): one card goes
// Gemini implement -> checks -> DeepSeek two-axis review -> at most one
// correction round -> PR -> UAT. It is not the LangGraph controller
// (JUL-116/JUL-118) and it keeps no state file: git holds the candidate
// commits, and the card's own comments hold the review and PR results.
//
// runIssue is the seam. The four outside services come in as adapters
// (linear, gemini, deepseek, publish); git and the checks are run for real.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_ATTEMPTS = 2;

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
  return result.stdout.trim();
}

// One machine-readable line per step, at the end of a readable comment. A
// later run finds its own earlier results by these lines.
const markerLine = (step, fields) => `runner: ${step} ${Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ')}`;

// A fresh run starts only from a clean checkout and from exactly origin/main,
// so the base is a commit everyone can see. A resumed run keeps the base it
// started from, even if main has moved on since. Returns a refusal reason or null.
function pinWorktree({ repoRoot, worktree, branch, base }) {
  if (existsSync(worktree)) {
    // Resuming: put the branch back as committed. An interrupted Gemini turn's
    // uncommitted edits are discarded, never counted as a finished turn.
    git(worktree, 'checkout', '-q', '-f', branch);
    git(worktree, 'clean', '-fdq');
    const growsFromBase = spawnSync('git', ['merge-base', '--is-ancestor', base, 'HEAD'], { cwd: worktree }).status === 0;
    return growsFromBase ? null : `the runner's branch does not grow from ${base}; pass the start commit this card began from`;
  }
  if (git(repoRoot, 'status', '--porcelain', '--untracked-files=no')) {
    return `the checkout at ${repoRoot} has uncommitted changes to tracked files`;
  }
  git(repoRoot, 'fetch', '-q', 'origin', 'main');
  const main = git(repoRoot, 'rev-parse', 'origin/main');
  if (git(repoRoot, 'rev-parse', '--verify', `${base}^{commit}`) !== main) {
    return `start commit ${base} is not origin/main (${main})`;
  }
  git(repoRoot, 'worktree', 'add', '-q', '-b', branch, worktree, main);
  return null;
}

// A `node --test` started from inside another test run inherits
// NODE_TEST_CONTEXT and then exits 0 even when its tests fail (measured
// 24 Sep, Node 24). The checks must never inherit it.
const { NODE_TEST_CONTEXT: _inherited, ...TEST_ENV } = process.env;

const SUITE = 'node --test "scripts/*.test.mjs"';
const sh = (command, cwd) => spawnSync(command, { cwd, encoding: 'utf8', shell: true, env: TEST_ENV });
const failedTests = (output) => new Set([...String(output).matchAll(/^✖ (.+?) \([\d.]+m?s\)\s*$/gm)].map((match) => match[1]));

// The lint must pass. The suite may fail only in tests that already failed on
// the start commit: on the Windows laptop two tests fail for path reasons
// before any change (24 Sep), and a change is judged on what it breaks.
function runChecks(cwd, onStartCommit) {
  const lint = sh('npm run lint:framework', cwd);
  if (lint.status !== 0) return { pass: false, summary: 'lint failed (`npm run lint:framework`)', output: `${lint.stdout}${lint.stderr}`.slice(-4000) };
  const suite = sh(SUITE, cwd);
  if (suite.status === 0) return { pass: true, summary: 'lint:framework and the full suite passed', output: '' };
  const failed = [...failedTests(suite.stdout)];
  const before = failed.length ? onStartCommit(() => failedTests(sh(SUITE, cwd).stdout)) : new Set();
  const fresh = failed.filter((name) => !before.has(name));
  if (!failed.length || fresh.length) {
    return { pass: false, summary: `tests failed (\`${SUITE}\`): ${fresh.join('; ') || 'the suite did not run'}`, output: `${suite.stdout}${suite.stderr}`.slice(-4000) };
  }
  return { pass: true, summary: `lint:framework passed, and the suite passed except ${failed.length} test(s) that already fail on the start commit: ${failed.join('; ')}`, output: '' };
}

// The pre-agreed seams (tdd skill: "Test only at pre-agreed seams"): the
// card's `## Seams` section must name at least one test file. `Kind:
// refactor` means the seam's tests must stay unchanged; anything else is a
// behaviour change.
export function seamsOf(description) {
  const section = /^##\s+Seams\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(description ?? '')?.[1];
  const tests = [...(section ?? '').matchAll(/`([^`\s]+\.test\.mjs)`/g)].map((match) => match[1]);
  if (!tests.length) return null;
  return { tests, kind: /Kind:\s*refactor/i.test(section) ? 'refactor' : 'behavior' };
}

// Everything the workers read comes from the start commit, never from a
// working copy or a personal path, so every run of a card reads the same text.
const SKILL_FILES = ['.agents/skills/implement/SKILL.md', '.agents/skills/tdd/SKILL.md', '.agents/skills/tdd/tests.md', '.agents/skills/tdd/mocking.md'];
const pinnedText = (repoRoot, base, paths) => paths.map((path) => `<file path="${path}">\n${git(repoRoot, 'show', `${base}:${path}`)}\n</file>`).join('\n\n');

const RUN_NOTES = [
  '# How this run differs from the skills',
  '- The seams are pre-agreed in the card\'s Seams section below. Test only there.',
  '- Do not run /code-review: the runner has your change reviewed separately.',
  '- Do not run git and do not commit: the runner commits your change and reads its id from git.',
  '- Read, search and edit files with your file tools, not the shell. The only shell command you may run is `npm test`, exactly as written: it runs the whole suite (about 80 seconds). Use it for each red and green step. Tests that already fail before your change are not yours to fix. There is no typecheck command. Any other shell command is refused and ends your turn as a failure.',
].join('\n');

const cardText = (card) => [
  `# Card ${card.identifier}: ${card.title}`,
  card.description,
  ...card.comments.filter((comment) => !comment.body.includes('\nrunner: ')).map((comment) => `## Comment on the card\n\n${comment.body}`),
].join('\n\n');

const testsPass = (cwd, files) => spawnSync('node', ['--test', ...files], { cwd, encoding: 'utf8', env: TEST_ENV }).status === 0;

// Run `check` with the worktree switched to `commit`, optionally carrying some
// of the candidate's files along, then put the branch back exactly.
function onCommit({ worktree, branch, commit, carry = [], sha }, check) {
  git(worktree, 'checkout', '-q', '--detach', commit);
  try {
    if (carry.length) git(worktree, 'checkout', '-q', sha, '--', ...carry);
    return check();
  } finally {
    git(worktree, 'checkout', '-q', '-f', branch);
  }
}

// The red proof. A behaviour change must change a seam test that fails on the
// start commit and passes on the candidate; otherwise its tests prove nothing.
// A refactor must leave its seam tests untouched and green on both commits.
// Returns a reason the proof failed, or null.
function redProof({ worktree, branch, base, sha, seams }) {
  const atSeam = (paths) => paths.filter((path) => seams.tests.some((seam) => path.endsWith(seam)));
  const changedTests = atSeam(git(worktree, 'diff', '--name-only', '--diff-filter=AM', `${base}...${sha}`).split('\n').filter(Boolean));
  if (seams.kind === 'refactor') {
    const edited = atSeam(git(worktree, 'diff', '--name-only', `${base}...${sha}`).split('\n').filter(Boolean));
    if (edited.length) return `red proof: a refactor must leave its seam tests unchanged, but it edits ${edited.join(', ')}`;
    const existing = atSeam(git(worktree, 'ls-tree', '-r', '--name-only', base).split('\n'));
    if (!existing.length) return `red proof: the seam tests (${seams.tests.join(', ')}) do not exist on the start commit`;
    if (!testsPass(worktree, existing)) return `red proof: the seam tests fail on the candidate`;
    if (!onCommit({ worktree, branch, commit: base }, () => testsPass(worktree, existing))) return 'red proof: the seam tests already fail on the start commit';
    return null;
  }
  if (!changedTests.length) return `red proof: the change adds or changes none of the seam tests (${seams.tests.join(', ')})`;
  if (!testsPass(worktree, changedTests)) return `red proof: the seam tests fail on the candidate`;
  const greenOnBase = onCommit({ worktree, branch, commit: base, carry: changedTests, sha }, () => testsPass(worktree, changedTests));
  if (greenOnBase) return `red proof: ${changedTests.join(', ')} already pass on the start commit, so they do not test the change`;
  return null;
}

function implementPrompt(card, skills, findings) {
  const correction = findings ? ['# Correction round', 'Your previous change was not accepted. Fix this before anything else:', findings] : [];
  return ['# Skills', skills, RUN_NOTES, cardText(card), ...correction].join('\n\n');
}

// One review is one prompt; above this size it is refused, never cut short.
export const MAX_REVIEW_CHARS = 400_000;
const STANDARDS_FILES = ['CLAUDE.md', 'AGENTS.md', 'eslint.config.mjs'];
const AXIS_NAMES = { spec: 'Spec', standards: 'Standards' };

// The code-review skill's own method, with its step 4 sub-agent brief for one
// axis, and the material that brief needs pasted in full: the reviewer runs
// on another machine and can open nothing itself.
function reviewPrompt(axis, { card, skill, standards, commits, diff }) {
  const source = axis === 'spec'
    ? ['## The spec: the card and its comments', cardText(card)]
    : ['## The standards sources (from the start commit)', standards];
  return [
    `# Review axis: ${AXIS_NAMES[axis]}`,
    `You are the ${AXIS_NAMES[axis]} sub-agent in the code-review skill below. Follow that skill's step 4 brief for the ${AXIS_NAMES[axis]} axis, and only that axis.`,
    skill,
    ...source,
    '## Commits under review', commits,
    '## The complete diff', diff,
    'End your report with exactly one line: `VERDICT: CLEAN` if there are no actionable findings, or `VERDICT: FINDINGS` if there are.',
  ].join('\n\n');
}

const verdictOf = (text) => /VERDICT:\s*(CLEAN|FINDINGS)\s*$/m.exec(text)?.[1] ?? null;

export async function runIssue(issueId, { base, repoRoot, worktreeRoot, adapters }) {
  const { linear, gemini, deepseek, publish } = adapters;
  // No card id in the branch name: Linear's GitHub link would move the card
  // on its own when a branch named after it opens or merges.
  const slug = `card-${issueId.split('-').at(-1)}`;
  const branch = `runner/${slug}`;
  const worktree = join(worktreeRoot, slug);
  const card = await linear.getCard(issueId);
  const posted = card.comments.map((comment) => comment.body);
  const recorded = (step, sha) => posted.find((body) => body.includes(markerLine(step, { sha })));
  // Post a step's comment once: a resumed run that finds the same line
  // already on the card does not post it again.
  const sayOnce = async (text, line) => {
    if (posted.some((body) => body.includes(line))) return;
    const body = `${text}\n\n${line}`;
    await linear.comment(issueId, body);
    posted.push(body);
  };

  const blocked = async (reason) => {
    await linear.comment(issueId, `The runner stopped: ${reason}.\n\n${markerLine('blocked', { attempt: 0 })}`);
    return { outcome: 'blocked', sha: null, prUrl: null, reason };
  };

  const seams = seamsOf(card.description);
  if (!seams) return blocked('the card has no `## Seams` section naming a test file, so there is no agreed place for the tests');
  const refusal = pinWorktree({ repoRoot, worktree, branch, base });
  if (refusal) return blocked(refusal);

  const head = () => git(worktree, 'rev-parse', 'HEAD');
  const commitCount = () => Number(git(worktree, 'rev-list', '--count', `${base}..HEAD`));

  // One Gemini turn. The runner, not Gemini, commits the result.
  const implement = async (attempt, findings) => {
    const before = head();
    const turn = await gemini(implementPrompt(card, pinnedText(repoRoot, base, SKILL_FILES), findings), { cwd: worktree });
    if (!turn.ok) return `Gemini's turn failed: ${turn.reason}`;
    if (head() !== before) return 'Gemini made its own commit, which this route does not allow';
    if (!git(worktree, 'status', '--porcelain')) return `Gemini's turn changed nothing${findings ? `; the last problem was: ${findings.split('\n')[0]}` : ''}`;
    git(worktree, 'add', '-A');
    git(worktree, 'commit', '-q', '-m', `runner: ${issueId} attempt ${attempt}`);
    return null;
  };

  // Both review axes for one candidate, or the result already on the card.
  const review = async (sha) => {
    const earlier = recorded('review', sha);
    if (earlier) return { clean: earlier.includes('spec=CLEAN standards=CLEAN'), text: earlier };
    const material = {
      card,
      skill: pinnedText(repoRoot, base, ['.agents/skills/code-review/SKILL.md']),
      standards: pinnedText(repoRoot, base, STANDARDS_FILES),
      commits: git(worktree, 'log', '--oneline', `${base}..${sha}`),
      diff: git(worktree, 'diff', `${base}...${sha}`),
    };
    const prompts = { spec: reviewPrompt('spec', material), standards: reviewPrompt('standards', material) };
    const longest = Math.max(prompts.spec.length, prompts.standards.length);
    if (longest > MAX_REVIEW_CHARS) return { failure: `the review would be ${longest} characters, over the ${MAX_REVIEW_CHARS} limit for one review; split the card` };
    const verdicts = {};
    const reports = [];
    for (const axis of ['spec', 'standards']) {
      const reply = await deepseek(prompts[axis], { axis });
      if (!reply.ok) return { failure: `DeepSeek's ${AXIS_NAMES[axis]} review failed: ${reply.reason}` };
      verdicts[axis] = verdictOf(reply.text);
      if (!verdicts[axis]) return { failure: `DeepSeek's ${AXIS_NAMES[axis]} review gave no VERDICT line` };
      reports.push(`### ${AXIS_NAMES[axis]}\n\n${reply.text.trim()}`);
    }
    const text = `DeepSeek review of \`${sha.slice(0, 12)}\`: Spec ${verdicts.spec}, Standards ${verdicts.standards}.\n\n${reports.join('\n\n')}`;
    await sayOnce(text, markerLine('review', { sha, ...verdicts }));
    return { clean: verdicts.spec === 'CLEAN' && verdicts.standards === 'CLEAN', text };
  };

  // Git is the record of Gemini's work: each runner commit past the base is a
  // finished turn, never run again. The card's comments record the rest.
  if (commitCount() > MAX_ATTEMPTS) return blocked(`the runner's branch has more than ${MAX_ATTEMPTS} commits past the start commit`);
  let findings = null;
  for (let attempt = Math.max(1, commitCount()); attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (commitCount() < attempt) {
      const failure = await implement(attempt, findings);
      if (failure) return blocked(failure);
    }
    const sha = head();
    await sayOnce(`Gemini's turn ${attempt} is committed as \`${sha.slice(0, 12)}\`.`, markerLine('implement', { sha, attempt }));

    const proofFailure = redProof({ worktree, branch, base, sha, seams });
    const checks = proofFailure ? { pass: false, summary: proofFailure, output: '' } : runChecks(worktree, (check) => onCommit({ worktree, branch, commit: base }, check));
    await sayOnce(`Checks on \`${sha.slice(0, 12)}\`: ${checks.summary}.`, markerLine('checks', { sha, result: checks.pass ? 'pass' : 'fail' }));
    if (!checks.pass) {
      findings = `The checks failed: ${checks.summary}\n\n${checks.output}`.trim();
      continue;
    }

    const verdict = await review(sha);
    if (verdict.failure) return blocked(verdict.failure);
    if (!verdict.clean) {
      findings = verdict.text;
      continue;
    }

    let url = /url=(\S+)/.exec(recorded('pr', sha) ?? '')?.[1];
    if (!url) {
      ({ url } = await publish({ branch, sha, worktree, title: card.title, body: `${cardText(card)}\n\n---\n\n${verdict.text}` }));
      await sayOnce(`PR opened for \`${sha.slice(0, 12)}\`: ${url}`, markerLine('pr', { sha, url }));
    }
    await linear.moveToUat(issueId);
    return { outcome: 'pr', sha, prUrl: url, reason: null };
  }
  return blocked(`still not passing after the correction round: ${findings.split('\n')[0]}`);
}

// ---------------------------------------------------------------- Command line

async function main([issueId, flag, base]) {
  if (!/^[A-Z]+-\d+$/.test(issueId ?? '') || flag !== '--base' || !base) {
    console.error('usage: node scripts/julia-minimal-runner.mjs JUL-NN --base <origin/main commit>');
    return 2;
  }
  if (!process.env.LINEAR_API_KEY) {
    console.error('LINEAR_API_KEY is not set: the runner reads the card and posts its progress with a Linear personal API key.');
    return 2;
  }
  const { deepseekAdapter, geminiAdapter, linearAdapter, publishAdapter } = await import('./julia-minimal-runner-adapters.mjs');
  const linear = linearAdapter();
  const comment = linear.comment;
  // The terminal shows the same progress lines as the card.
  linear.comment = (id, body) => { console.log(body.split('\n')[0]); return comment(id, body); };
  const repoRoot = git(process.cwd(), 'rev-parse', '--show-toplevel');
  const result = await runIssue(issueId, {
    base,
    repoRoot,
    worktreeRoot: join(repoRoot, '.julia-runner-state', 'worktrees'),
    adapters: { linear, gemini: geminiAdapter(), deepseek: deepseekAdapter(), publish: publishAdapter() },
  });
  console.log(JSON.stringify(result, null, 2));
  return result.outcome === 'pr' ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => { console.error(error.stack ?? error); process.exitCode = 1; });
}
