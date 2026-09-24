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

import { git, redProof, runChecks } from './julia-minimal-runner-checks.mjs';

export const MAX_ATTEMPTS = 2;

// One machine-readable line per step, at the end of a readable comment. A
// later run finds its own earlier results by these lines.
const markerLine = (step, fields) => `runner: ${step} ${Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ')}`;

// A fresh run starts only from a clean checkout and from exactly origin/main,
// so the base is a commit everyone can see. A resumed run keeps the base it
// started from, even if main has moved on since. Returns a refusal reason or null.
function pinWorktree({ repoRoot, worktree, branch, base }) {
  if (existsSync(worktree)) {
    // Resuming: put the branch back as committed. An interrupted Gemini turn's
    // uncommitted edits are discarded (and reported), never counted as a
    // finished turn.
    const discarded = git(worktree, 'status', '--porcelain').split('\n').filter(Boolean);
    git(worktree, 'checkout', '-q', '-f', branch);
    git(worktree, 'clean', '-fdq');
    const growsFromBase = spawnSync('git', ['merge-base', '--is-ancestor', base, 'HEAD'], { cwd: worktree }).status === 0;
    return { refusal: growsFromBase ? null : `the runner's branch does not grow from ${base}; pass the start commit this card began from`, discarded };
  }
  if (git(repoRoot, 'status', '--porcelain', '--untracked-files=no')) {
    return { refusal: `the checkout at ${repoRoot} has uncommitted changes to tracked files`, discarded: [] };
  }
  git(repoRoot, 'fetch', '-q', 'origin', 'main');
  const main = git(repoRoot, 'rev-parse', 'origin/main');
  if (git(repoRoot, 'rev-parse', '--verify', `${base}^{commit}`) !== main) {
    return { refusal: `start commit ${base} is not origin/main (${main})`, discarded: [] };
  }
  git(repoRoot, 'worktree', 'add', '-q', '-b', branch, worktree, main);
  return { refusal: null, discarded: [] };
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
  '- Do not run any shell command. Read, search and edit files with your file tools only; any command is refused and ends your turn as a failure. Write the failing test at the seam first, then the code that makes it pass: the runner\'s test worker runs the tests after your turn (the red proof, the lint and the suite) and sends back any failure. Tests that already fail before your change are not yours to fix. There is no typecheck command.',
].join('\n');

const cardText = (card) => [
  `# Card ${card.identifier}: ${card.title}`,
  card.description,
  ...card.comments.filter((comment) => !comment.body.includes('\nrunner: ')).map((comment) => `## Comment on the card\n\n${comment.body}`),
].join('\n\n');

function implementPrompt(card, skills, findings) {
  const correction = findings ? ['# Correction round', 'Your previous change was not accepted. Fix this before anything else:', findings] : [];
  return ['# Skills', skills, RUN_NOTES, cardText(card), ...correction].join('\n\n');
}

// One review is one prompt; above this size it is refused, never cut short.
export const MAX_REVIEW_CHARS = 400_000;
// The repo's documented standards: the three it has, plus the two files the
// code-review skill names, whenever the start commit has them.
const STANDARDS_FILES = ['CLAUDE.md', 'AGENTS.md', 'eslint.config.mjs'];
const OPTIONAL_STANDARDS_FILES = ['CODING_STANDARDS.md', 'CONTRIBUTING.md'];
const existsAt = (repoRoot, base, path) => spawnSync('git', ['cat-file', '-e', `${base}:${path}`], { cwd: repoRoot }).status === 0;
const AXIS_NAMES = { spec: 'Spec', standards: 'Standards' };

// The code-review skill's own method, with its step 4 sub-agent brief for one
// axis, and the material that brief needs pasted in full: the reviewer runs
// on another machine and can open nothing itself.
export function reviewPrompt(axis, { card, skill, standards, commits, diff }) {
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
  const { linear, gemini, deepseek, publish, tests } = adapters;
  // The runner never runs a candidate's tests itself (they are code Gemini
  // wrote): without a test worker there is no safe way to check a change.
  if (typeof tests !== 'function') throw new Error('runIssue needs a test worker (adapters.tests); the runner does not run candidate tests itself');
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
  const { refusal, discarded } = pinWorktree({ repoRoot, worktree, branch, base });
  if (refusal) return blocked(refusal);
  // Long calls report as they go: each phase is announced when it starts, and
  // a worker's own progress is passed on with its name.
  const progress = adapters.progress ?? (() => {});
  const relay = (worker) => (line) => progress(`${worker}: ${line}`);
  // A fresh worktree has no dependencies. They come from the start commit's own
  // lockfile (trusted code on main), installed once, before Gemini's turn.
  if (existsSync(join(worktree, 'package-lock.json')) && !existsSync(join(worktree, 'node_modules'))) {
    progress('Installing dependencies (npm ci) from the start commit');
    const install = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: worktree, encoding: 'utf8', shell: process.platform === 'win32' });
    if (install.status !== 0) return blocked(`npm ci failed in the new worktree (exit ${install.status}): ${String(install.stderr).trim().split('\n').at(-1)}`);
  }

  const head = () => git(worktree, 'rev-parse', 'HEAD');
  const commitCount = () => Number(git(worktree, 'rev-list', '--count', `${base}..HEAD`));
  const foreign = git(worktree, 'log', '--format=%h %s', `${base}..HEAD`).split('\n').filter(Boolean)
    .filter((line) => !new RegExp(`^\\S+ runner: ${issueId} attempt \\d+$`).test(line));
  if (foreign.length) return blocked(`the runner's branch holds commits the runner did not make (${foreign.join('; ')})`);

  // The candidate under check, review and PR must be exactly the commit the
  // runner made: HEAD unchanged and nothing uncommitted. Results are keyed by
  // that commit, so a different commit never inherits them.
  const candidateDrift = (sha) => {
    const now = head();
    if (now !== sha) return `the candidate changed: expected ${sha.slice(0, 12)}, but HEAD is ${now.slice(0, 12)}`;
    const dirty = git(worktree, 'status', '--porcelain');
    return dirty ? `the worktree has uncommitted changes on top of ${sha.slice(0, 12)} (${dirty.split('\n').length} file(s))` : null;
  };

  // One Gemini turn. The runner, not Gemini, commits the result. The card
  // records that the turn started, so a restart can say it was interrupted.
  const implement = async (attempt, findings) => {
    const started = markerLine('implement-started', { base, attempt });
    if (posted.some((body) => body.includes(started))) {
      await linear.comment(issueId, `Gemini's turn ${attempt} was interrupted before the runner committed it. The runner discarded ${discarded.length} uncommitted file(s) it left and is starting that turn again.\n\n${markerLine('implement-restarted', { base, attempt })}`);
    }
    await sayOnce(`Gemini's turn ${attempt} started.`, started);
    progress(`Gemini turn ${attempt} started`);
    const before = head();
    const turn = await gemini(implementPrompt(card, pinnedText(repoRoot, base, SKILL_FILES), findings), { cwd: worktree, onProgress: relay('Gemini') });
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
      standards: pinnedText(repoRoot, base, [...STANDARDS_FILES, ...OPTIONAL_STANDARDS_FILES.filter((path) => existsAt(repoRoot, base, path))]),
      commits: git(worktree, 'log', '--oneline', `${base}..${sha}`),
      diff: git(worktree, 'diff', `${base}...${sha}`),
    };
    const prompts = { spec: reviewPrompt('spec', material), standards: reviewPrompt('standards', material) };
    const longest = Math.max(prompts.spec.length, prompts.standards.length);
    if (longest > MAX_REVIEW_CHARS) return { failure: `the review would be ${longest} characters, over the ${MAX_REVIEW_CHARS} limit for one review; split the card` };
    const verdicts = {};
    const reports = [];
    // The two axes run one after the other, each in its own DeepSeek session:
    // the skill asks for parallel sub-agents, but a laptop run of two at once
    // was stopped for low memory (24 Sep). The axes stay separate.
    for (const axis of ['spec', 'standards']) {
      const drift = candidateDrift(sha);
      if (drift) return { failure: drift };
      await sayOnce(`DeepSeek's ${AXIS_NAMES[axis]} review of \`${sha.slice(0, 12)}\` started.`, markerLine('review-started', { sha, axis }));
      progress(`DeepSeek ${AXIS_NAMES[axis]} review of ${sha.slice(0, 12)} started`);
      const reply = await deepseek(prompts[axis], { axis, onProgress: relay(`DeepSeek ${AXIS_NAMES[axis]}`) });
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
  const stop = async (reason) => ({ result: await blocked(reason) });

  // One attempt: a Gemini turn (unless git already holds it), checks, review,
  // PR. Returns { result } when the run is over, or { findings } for the
  // correction round.
  const attemptRound = async (attempt, findings) => {
    if (commitCount() < attempt) {
      const failure = await implement(attempt, findings);
      if (failure) return stop(failure);
    }
    const sha = head();
    await sayOnce(`Gemini's turn ${attempt} is committed as \`${sha.slice(0, 12)}\`.`, markerLine('implement', { sha, attempt }));

    const beforeChecks = candidateDrift(sha);
    if (beforeChecks) return stop(beforeChecks);
    // Checks that already passed for this exact commit are not run again.
    const passedEarlier = recorded('checks', sha)?.includes(`${markerLine('checks', { sha })} result=pass`);
    let checks = { pass: true, summary: 'passed earlier for this commit (recorded on the card)', output: '' };
    if (!passedEarlier) {
      progress(`Red proof and checks on ${sha.slice(0, 12)} started`);
      const proofFailure = await redProof({ worktree, branch, base, sha, seams, test: tests });
      checks = proofFailure ? { pass: false, summary: proofFailure, output: '' } : await runChecks({ worktree, branch, base, test: tests });
    }
    await sayOnce(`Checks on \`${sha.slice(0, 12)}\`: ${checks.summary}.`, markerLine('checks', { sha, result: checks.pass ? 'pass' : 'fail' }));
    if (!checks.pass) return { findings: `The checks failed: ${checks.summary}\n\n${checks.output}`.trim() };

    const verdict = await review(sha);
    if (verdict.failure) return stop(verdict.failure);
    if (!verdict.clean) return { findings: verdict.text };

    // The card says a publish is starting before it starts. A restart that
    // finds that line but no PR line cannot know whether the PR opened (the
    // publisher cannot list PRs), so it stops rather than open a second one.
    let url = /url=(\S+)/.exec(recorded('pr', sha) ?? '')?.[1];
    if (!url) {
      const publishing = markerLine('publishing', { sha });
      if (posted.some((body) => body.includes(publishing))) {
        return stop(`a PR for ${sha.slice(0, 12)} may already be open: the runner stopped while publishing it. Look for branch ${branch} on GitHub; to go on, post \`${markerLine('pr', { sha, url: '<the PR link>' })}\` on this card`);
      }
      const beforePublish = candidateDrift(sha);
      if (beforePublish) return stop(beforePublish);
      await sayOnce(`Publishing \`${sha.slice(0, 12)}\` as a PR.`, publishing);
      progress(`Publishing ${sha.slice(0, 12)} started`);
      ({ url } = await publish({ branch, sha, worktree, title: card.title, body: `${cardText(card)}\n\n---\n\n${verdict.text}`, onProgress: relay('Publisher') }));
      await sayOnce(`PR opened for \`${sha.slice(0, 12)}\`: ${url}`, markerLine('pr', { sha, url }));
    }
    await linear.moveToUat(issueId);
    return { result: { outcome: 'pr', sha, prUrl: url, reason: null } };
  };

  // The first attempt, then at most one correction round: two explicit calls,
  // not a loop. A resume whose branch already holds the second turn goes
  // straight to the correction round.
  const first = commitCount() < MAX_ATTEMPTS ? await attemptRound(1, null) : { findings: null };
  if (first.result) return first.result;
  const second = await attemptRound(MAX_ATTEMPTS, first.findings);
  if (second.result) return second.result;
  return blocked(`still not passing after the correction round: ${second.findings.split('\n')[0]}`);
}

// ---------------------------------------------------------------- Command line

// On the server (ops/julia-runner/README.md): run as orchestrator-svc by
// systemd-run, which loads the Linear app credential; the card's working copy
// lives where the Gemini and test workers are allowed to reach it.
const SERVER_REPO = '/srv/julia-runner/repo';
const SERVER_WORKTREES = '/srv/julia-runner/worktrees';

async function main([issueId, flag, base]) {
  if (!/^[A-Z]+-\d+$/.test(issueId ?? '') || flag !== '--base' || !base) {
    console.error('usage: node scripts/julia-minimal-runner.mjs JUL-NN --base <origin/main commit>');
    return 2;
  }
  // Files the runner checks out stay writable by the worktree group, so the
  // Gemini worker can edit them and the runner can switch commits afterwards.
  process.umask(0o002);
  const { deepseekAdapter, geminiAdapter, linearAdapter, publishAdapter, readAppCredential, testerAdapter } = await import('./julia-minimal-runner-adapters.mjs');
  // Fail before anything else if the credential is not there.
  readAppCredential();
  const linear = linearAdapter();
  const comment = linear.comment;
  // The terminal shows the same progress lines as the card.
  linear.comment = (id, body) => { console.log(body.split('\n')[0]); return comment(id, body); };
  const progress = (line) => console.log(`${new Date().toISOString().slice(11, 19)}Z  ${line}`);
  const result = await runIssue(issueId, {
    base,
    repoRoot: SERVER_REPO,
    worktreeRoot: SERVER_WORKTREES,
    adapters: { linear, progress, gemini: geminiAdapter(), tests: testerAdapter(), deepseek: deepseekAdapter(), publish: publishAdapter() },
  });
  console.log(JSON.stringify(result, null, 2));
  return result.outcome === 'pr' ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => { console.error(error.stack ?? error); process.exitCode = 1; });
}
