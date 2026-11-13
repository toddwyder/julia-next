import { execFileSync } from 'node:child_process';

import { getIssue, postComment as postCardComment, setIssueState } from '../../scripts/linear-cli.mjs';

export const PLAYBOOK = '.agents/skills/poteto-mode/playbooks/shipping.md';
export const REVIEW_TIME_LIMIT_MS = 20 * 60_000;
export const SHIPPING_MAX_STEPS = 300;


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

// The reviewer's answer is a verdict only if its first non-empty line is `VERDICT: <one word>`, it has
// exactly one `CRITERION n: PASS|FAIL` line for each listed criterion, and the two agree: a PASS with a
// FAIL criterion is no verdict. Anything else comes back with a reason and no verdict.
export function parseVerdict(answer, criteriaCount) {
  const raw = String(answer ?? '').trim();
  const lines = raw.split(/\r?\n/).map(text => text.trim()).filter(Boolean);
  const first = (lines[0] ?? '').match(/^[>*#-]*[ \t]*verdict[ \t]*:[ \t>*]*(.*?)[ \t*]*$/i);
  if (!first) return { verdict: null, reason: 'the first line is not a verdict line', raw };
  const word = first[1].toUpperCase();
  if (!['PASS', 'PASS+NOTES', 'FAIL'].includes(word)) return { verdict: null, reason: 'the verdict line does not hold exactly one of PASS, PASS+NOTES, FAIL', raw };
  const seen = new Map();
  for (const line of lines.slice(1)) {
    const match = line.match(/^[>*#-]*[ \t]*criterion[ \t]+(\d+)[ \t]*:[ \t>*]*(PASS|FAIL)\b/i);
    if (match) seen.set(Number(match[1]), [...(seen.get(Number(match[1])) ?? []), match[2].toUpperCase()]);
  }
  const wrong = Array.from({ length: criteriaCount }, (_, i) => i + 1).find(n => (seen.get(n) ?? []).length !== 1);
  if (wrong) return { verdict: null, reason: `criterion ${wrong} does not have exactly one criterion line`, raw };
  if ([...seen.keys()].some(n => n < 1 || n > criteriaCount)) return { verdict: null, reason: 'a criterion line names a criterion the card does not list', raw };
  const failed = [...seen.values()].some(results => results[0] === 'FAIL');
  if (word !== 'FAIL' && failed) return { verdict: null, reason: `${word} with a FAIL criterion line`, raw };
  return { verdict: word, reason: null, raw };
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

export const headCommit = folder => run('git', ['rev-parse', 'HEAD'], folder);

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
  moveCard: setIssueState,
  headCommit,
  postPrComment,
  postCardComment,
};
