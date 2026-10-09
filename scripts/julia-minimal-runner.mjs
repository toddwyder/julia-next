// julia-minimal-runner.mjs -- the fixed-route stopgap (JUL-122): one card goes
// Gemini implement -> checks -> DeepSeek two-axis review -> at most one
// correction round -> acceptance check -> PR -> UAT. It is not the LangGraph controller
// (JUL-116/JUL-118) and it keeps no state file: git holds the candidate
// commits, and the card's own comments hold the review and PR results.
//
// runIssue is the seam. The four outside services come in as adapters
// (linear, gemini, deepseek, publish); git and the checks are run for real.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkCardForUat, checkEvidence, evidenceCommentBody, parseAcceptanceCriteria, parseUatPlan, tickCriteria } from './acceptance-check.mjs';
import { AXIS_NAMES, cardText, handInOf, implementPrompt, reviewPrompt, verdictOf } from './julia-minimal-runner-brief.mjs';
import { git, redProof, runChecks } from './julia-minimal-runner-checks.mjs';

export { reviewPrompt, verdictOf };

export const MAX_ATTEMPTS = 2;

// One machine-readable line per step, at the end of a readable comment. A
// later run finds its own earlier results by these lines.
const markerLine = (step, fields) => `runner: ${step} ${Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ')}`;

// A fresh run starts only from a clean checkout and from exactly origin/main,
// so the base is a commit everyone can see. A resumed run keeps the base it
// started from, even if main has moved on since. Returns a refusal reason or null.
export function pinWorktree({ repoRoot, worktree, branch, base, fetch = true }) {
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
  if (fetch) git(repoRoot, 'fetch', '-q', 'origin', 'main');
  const main = git(repoRoot, 'rev-parse', 'origin/main');
  if (git(repoRoot, 'rev-parse', '--verify', `${base}^{commit}`) !== main) {
    return { refusal: `start commit ${base} is not origin/main (${main})`, discarded: [] };
  }
  git(repoRoot, 'worktree', 'add', '-q', '-b', branch, worktree, main);
  return { refusal: null, discarded: [] };
}

// Shared fresh-worktree setup, from the checked revision's own lockfile.
export function installDependencies(worktree, progress = () => {}) {
  if (!existsSync(join(worktree, 'package-lock.json')) || existsSync(join(worktree, 'node_modules'))) return { status: 0, output: '', skipped: true };
  progress('Installing dependencies (npm ci) from the start commit');
  const result = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: worktree, encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true, timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`, error: result.error?.message ?? null, skipped: false };
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
const SKILL_FILES = ['.claude/skills/implement/SKILL.md', '.claude/skills/tdd/SKILL.md', '.claude/skills/tdd/tests.md', '.claude/skills/tdd/mocking.md'];
const pinnedText = (repoRoot, base, paths) => paths.map((path) => `<file path="${path}">\n${git(repoRoot, 'show', `${base}:${path}`)}\n</file>`).join('\n\n');

// One review is one prompt; above this size it is refused, never cut short.
// The reviewer seat (run-pi-seat.mjs) hands the prompt to Pi as one command
// argument, and Linux caps one argument at 128 KiB (E2BIG, measured 24 Sep),
// so the limit is in bytes and just under that.
export const MAX_REVIEW_BYTES = 130_000;
// The repo's documented standards: the three it has, plus the two files the
// code-review skill names, whenever the start commit has them.
const STANDARDS_FILES = ['CLAUDE.md', 'AGENTS.md', 'eslint.config.mjs'];
const OPTIONAL_STANDARDS_FILES = ['CODING_STANDARDS.md', 'CONTRIBUTING.md'];
const existsAt = (repoRoot, base, path) => spawnSync('git', ['cat-file', '-e', `${base}:${path}`], { cwd: repoRoot }).status === 0;

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
  if (!parseAcceptanceCriteria(card.description).length) return blocked('the card lists no acceptance criteria (checkboxes under an "Acceptance criteria" heading), so there is nothing to accept against');
  if (!parseUatPlan(card.description).length) return blocked('the card\'s UAT plan lists no numbered items (under "## UAT plan"), so there is nothing to hand Todd');
  const { refusal, discarded } = pinWorktree({ repoRoot, worktree, branch, base });
  if (refusal) return blocked(refusal);
  // Long calls report as they go: each phase is announced when it starts, and
  // a worker's own progress is passed on with its name.
  const progress = adapters.progress ?? (() => {});
  const relay = (worker) => (line) => progress(`${worker}: ${line}`);
  // A fresh worktree has no dependencies. They come from the start commit's own
  // lockfile (trusted code on main), installed once, before Gemini's turn.
  const install = installDependencies(worktree, progress);
  if (install.status !== 0) return blocked(`npm ci failed in the new worktree (exit ${install.status}): ${String(install.output).trim().split('\n').at(-1)}`);

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
    const handIn = handInOf(turn.text);
    if (handIn?.outcome === 'blocked') return `Gemini stopped as blocked: ${handIn.summary ?? '(no reason given)'}`;
    if (!git(worktree, 'status', '--porcelain')) return `Gemini's turn changed nothing${findings ? `; the last problem was: ${findings.split('\n')[0]}` : ''}`;
    git(worktree, 'add', '-A');
    // The hand-in rides in the commit message, so git keeps it with the change
    // and a restart never loses it.
    git(worktree, 'commit', '-q', '-m', `runner: ${issueId} attempt ${attempt}${handIn ? `\n\n${JSON.stringify(handIn)}` : ''}`);
    return null;
  };

  // Both review axes for one candidate. Each axis's report goes on the card as
  // soon as it returns, so a restart reuses it and never runs that axis again.
  const review = async (sha, { builder, checks }) => {
    const material = {
      card,
      builder,
      checks,
      skill: pinnedText(repoRoot, base, ['.claude/skills/code-review/SKILL.md']),
      standards: pinnedText(repoRoot, base, [...STANDARDS_FILES, ...OPTIONAL_STANDARDS_FILES.filter((path) => existsAt(repoRoot, base, path))]),
      commits: git(worktree, 'log', '--oneline', `${base}..${sha}`),
      diff: git(worktree, 'diff', `${base}...${sha}`),
    };
    const prompts = { spec: reviewPrompt('spec', material), standards: reviewPrompt('standards', material) };
    const longest = Math.max(Buffer.byteLength(prompts.spec), Buffer.byteLength(prompts.standards));
    if (longest > MAX_REVIEW_BYTES) return { failure: `the review would be ${longest} bytes, over the ${MAX_REVIEW_BYTES}-byte limit for one review; split the card` };
    const verdicts = {};
    const reports = {};
    // The two axes run one after the other, each in its own DeepSeek session:
    // the skill asks for parallel sub-agents, but a laptop run of two at once
    // was stopped for low memory (24 Sep). The axes stay separate.
    for (const axis of ['spec', 'standards']) {
      const done = markerLine('review-axis', { sha, axis });
      const earlier = posted.find((body) => body.includes(done));
      if (earlier) {
        verdicts[axis] = /verdict=(CLEAN|FINDINGS)/.exec(earlier.slice(earlier.indexOf(done)))[1];
        reports[axis] = earlier.slice(0, earlier.indexOf(done)).trim();
        continue;
      }
      const drift = candidateDrift(sha);
      if (drift) return { failure: drift };
      await sayOnce(`DeepSeek's ${AXIS_NAMES[axis]} review of \`${sha.slice(0, 12)}\` started.`, markerLine('review-started', { sha, axis }));
      progress(`DeepSeek ${AXIS_NAMES[axis]} review of ${sha.slice(0, 12)} started`);
      const reply = await deepseek(prompts[axis], { axis, onProgress: relay(`DeepSeek ${AXIS_NAMES[axis]}`) });
      if (!reply.ok) return { failure: `DeepSeek's ${AXIS_NAMES[axis]} review failed: ${reply.reason}` };
      verdicts[axis] = verdictOf(reply.text);
      if (!verdicts[axis]) return { failure: `DeepSeek's ${AXIS_NAMES[axis]} review gave no VERDICT line` };
      const report = `### ${AXIS_NAMES[axis]} review of \`${sha.slice(0, 12)}\`: ${verdicts[axis]}\n\n${reply.text.trim()}`;
      await sayOnce(report, markerLine('review-axis', { sha, axis, verdict: verdicts[axis] }));
      reports[axis] = report;
    }
    await sayOnce(`DeepSeek review of \`${sha.slice(0, 12)}\`: Spec ${verdicts.spec}, Standards ${verdicts.standards} (each report is in its own comment above).`, markerLine('review', { sha, ...verdicts }));
    return { clean: verdicts.spec === 'CLEAN' && verdicts.standards === 'CLEAN', text: `${reports.spec}\n\n${reports.standards}`, reports };
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
      const proof = seams.kind === 'refactor' ? 'the seam tests are unchanged and pass on the start commit and on this one' : 'the changed seam tests fail on the start commit and pass on this one';
      checks = proofFailure ? { pass: false, summary: proofFailure, output: '' } : await runChecks({ worktree, branch, base, test: tests });
      if (!proofFailure) checks.summary = `red proof passed (${proof}); ${checks.summary}`;
    }
    await sayOnce(`Checks on \`${sha.slice(0, 12)}\`: ${checks.summary}.`, markerLine('checks', { sha, result: checks.pass ? 'pass' : 'fail' }));
    if (!checks.pass) return { findings: `The checks failed: ${checks.summary}\n\n${checks.output}`.trim() };
    const checksReport = recorded('checks', sha).split('\n\nrunner: ')[0];

    const builder = handInOf(git(worktree, 'log', '-1', '--format=%b', sha));
    const verdict = await review(sha, { builder, checks: checksReport });
    if (verdict.failure) return stop(verdict.failure);
    if (!verdict.clean) return { findings: verdict.text };

    // The acceptance check (scripts/acceptance-check.mjs, no AI): every
    // criterion has the builder's evidence and the Spec reviewer's "met", and
    // every UAT item an answer. A refusal is unfinished work, like a finding.
    const reviewer = { criteria: handInOf(verdict.reports.spec)?.criteria ?? [] };
    const check = checkEvidence({ description: card.description, builder: builder ?? {}, reviewer });
    await sayOnce(`Acceptance check on \`${sha.slice(0, 12)}\`: ${check.ok ? 'every criterion has evidence and "met", and every UAT item an answer' : check.missing.join('; ')}.`, markerLine('acceptance', { sha, result: check.ok ? 'pass' : 'fail' }));
    if (!check.ok) return { findings: `The acceptance check refused the change (scripts/acceptance-check.mjs):\n- ${check.missing.join('\n- ')}` };

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
    // Evidence first, then the ticks: a box is never ticked before its
    // evidence is on the card (CLAUDE.md, "Tick as you go").
    await sayOnce(evidenceCommentBody({ card, check, builder, reviewer }), markerLine('evidence', { sha }));
    const live = await linear.getCard(issueId);
    const ticked = tickCriteria(live.description);
    if (ticked !== live.description) await linear.setDescription(issueId, ticked);
    const now = await linear.getCard(issueId);
    const guard = checkCardForUat({ description: now.description, comments: now.comments });
    if (!guard.ok) return stop(`the card is not ready for UAT: ${guard.missing.join('; ')}`);
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

// The historical runIssue seam remains for fixture tests; it is not a card launcher.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.error('Graph runner retired; start work through Factory.');
  process.exitCode = 1;
}
