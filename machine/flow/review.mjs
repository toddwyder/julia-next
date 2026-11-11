// The parts of a Shipping review that are fixed rules, not a model's choice:
// how the card's pull request is found, what is checked out, what the reviewer
// is told, how its answer is read, and the comment that goes on the pull request.
// The reviewer itself is the plain agent in agents.mjs.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { getIssue, postComment as postCardComment } from '../../scripts/linear-cli.mjs';

export const PLAYBOOK = '.agents/skills/poteto-mode/playbooks/shipping.md';
export const REVIEW_TIME_LIMIT_MS = 20 * 60_000;
export const SHIPPING_MAX_STEPS = 300;

const VERDICT = /(PASS\+NOTES|PASS|FAIL)/i;

export function criteriaFromCard(description) {
  const text = String(description ?? '');
  const heading = /^#{1,6}[ \t]*(?:acceptance[ \t]+)?criteria[ \t]*$/im.exec(text);
  if (!heading) return [];
  const after = text.slice(heading.index + heading[0].length);
  const next = /^#{1,6}[ \t]+\S/m.exec(after);
  const section = next ? after.slice(0, next.index) : after;
  return section
    .split(/\r?\n/)
    .map(line => line.match(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?(.+)$/))
    .filter(Boolean)
    .map(match => match[1].trim())
    .filter(line => line.length > 0);
}

// The reviewer's last text must open with its verdict line. Anything else is no verdict.
export function parseVerdict(answer) {
  const raw = String(answer ?? '').trim();
  const line = raw.split(/\r?\n/).map(text => text.match(/^[ \t>*#-]*verdict[ \t]*:[ \t>*]*([a-z+]+)/i)).find(Boolean);
  const found = line ? VERDICT.exec(line[1].toUpperCase()) : null;
  const verdict = found && found[1].toUpperCase() === line[1].toUpperCase() ? found[1].toUpperCase() : null;
  return { verdict, raw };
}

// Exactly one open pull request must name the card in its branch, title or description.
export function chooseCardPr(card, pulls) {
  const word = new RegExp(`(?:^|[^A-Za-z0-9])${card.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9])`, 'i');
  const named = pulls.filter(pull => [pull.headRefName, pull.title, pull.body].some(text => word.test(String(text ?? ''))));
  if (named.length === 1) return { pr: named[0].number };
  if (named.length === 0) return { reason: `no open pull request names ${card} in its branch, title or description` };
  return { reason: `${named.length} open pull requests name ${card} (${named.map(pull => `#${pull.number}`).join(', ')}), so the pull request to review is not known` };
}

const run = (file, args, cwd) => execFileSync(file, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function findCardPr(repo, card) {
  const pulls = JSON.parse(run('gh', ['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number,headRefName,title,body'], repo));
  return chooseCardPr(card, pulls);
}

// The pull request's head goes into a detached worktree beside the run's files, and the
// dependency trees are cloned from the main checkout when its lockfile matches.
export function prepareCheckout(repo, pr, checkout) {
  run('git', ['fetch', '--no-tags', '--quiet', 'origin', `pull/${pr}/head`], repo);
  const sha = run('git', ['rev-parse', 'FETCH_HEAD^{commit}'], repo);
  try {
    run('git', ['worktree', 'remove', '--force', checkout], repo);
  } catch {
    // Nothing checked out there yet.
  }
  rmSync(checkout, { recursive: true, force: true });
  run('git', ['worktree', 'prune'], repo);
  mkdirSync(join(checkout, '..'), { recursive: true });
  run('git', ['worktree', 'add', '--detach', '--quiet', checkout, sha], repo);
  for (const tree of ['', 'dashboard']) {
    const lock = join(tree, 'package-lock.json');
    const modules = join(repo, tree, 'node_modules');
    const sameLock = existsSync(join(repo, lock)) && existsSync(join(checkout, lock)) &&
      readFileSync(join(repo, lock)).equals(readFileSync(join(checkout, lock)));
    if (sameLock && existsSync(join(modules, '.package-lock.json'))) {
      rmSync(join(checkout, tree, 'node_modules'), { recursive: true, force: true });
      execFileSync('cp', ['-al', modules, join(checkout, tree, 'node_modules')]);
    }
  }
  return sha;
}

export function removeCheckout(repo, checkout) {
  try {
    run('git', ['worktree', 'remove', '--force', checkout], repo);
  } catch {
    rmSync(checkout, { recursive: true, force: true });
  }
}

export function reviewTask({ pr, sha, checkout, card, criteria }) {
  return [
    `You are the Shipping agent for pull request #${pr} in this checkout.`,
    '',
    `Read ${PLAYBOOK} first and follow it. You are reviewing code you did not write, and only a verdict from an agent that runs the change itself counts. A green pipeline is not a verdict.`,
    '',
    `The code under review is already checked out here: ${checkout}`,
    `Commit under review: ${sha}`,
    '',
    `The card is ${card.identifier}, quoted between the fences. Its criteria are the only things you judge.`,
    '',
    '--- card ---',
    `# ${card.title}`,
    '',
    card.description ?? '',
    '--- end card ---',
    '',
    'For each criterion, run the command it names, exactly as written, inside this checkout. Decide from what the command printed and the exit code it gave. You may also run read-only commands to look around (cat, ls, git show, git diff, git log). Do not run npm ci, npm install, or any installer, and do not edit, commit, push, or otherwise change the checkout.',
    '',
    `The card lists ${criteria.length} ${criteria.length === 1 ? 'criterion' : 'criteria'}. Judge every one of them.`,
    '',
    'Answer in exactly this shape, with nothing before it and nothing after it:',
    '',
    'VERDICT: PASS | PASS+NOTES | FAIL',
    'CRITERION 1: PASS | FAIL — one sentence naming the command you ran and what it returned',
    'NOTES: one short paragraph on anything a reader should know',
  ].join('\n');
}

export const verdictComment = ({ verdict, answer, sha }) =>
  [`Shipping agent: ${verdict}`, '', `Commit reviewed: ${sha}`, '', answer].join('\n');

export function postPrComment(repo, pr, body) {
  return run('gh', ['pr', 'comment', String(pr), '--body', body], repo);
}

export const realReview = {
  findPr: findCardPr,
  readCard: identifier => getIssue(identifier),
  prepareCheckout,
  removeCheckout,
  postPrComment,
  postCardComment,
};
