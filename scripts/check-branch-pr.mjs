// Requires an open pull request for every branch, and a scorecard that shows a measured cost
// on the pull request of the branch being pushed. Both are asked in CI, where the branch and
// the checkout are the same thing.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function branchesWithoutOpenPullRequests({ branches, pulls, repository }) {
  const covered = new Set(pulls
    .filter(pull => pull.state === 'open' && pull.base?.ref === 'main' && pull.head?.repo?.full_name === repository)
    .map(pull => pull.head.ref));
  return branches.map(branch => branch.name).filter(name => name !== 'main' && !covered.has(name)).sort();
}

// A card's scorecard is how a card's cost reaches Todd, and a scorecard that could not read a
// session's trace file prints `Cost: **unknown**` while looking finished, or prints a number
// smaller than the bill and says so on a `Cost incomplete` line. So a pull request that names
// a card has to carry that card's scorecard, and the card's cost has to be a number somebody
// could check.
//
// Work that is not a card, such as a correction Todd asks for as its own pull request, says so
// on a lone `No card:` line of the body, the same place a pull request names its card. A line
// with no reason does not count, because the reason is the thing a reader checks.
const NO_CARD = /^[ \t]*no card[ \t]*:[ \t]*(\S.*)$/im;

export function declaresNoCard(body) {
  return NO_CARD.test(String(body ?? ''));
}

export function scorecardGaps({ pulls, headRef, readFile = path => readFileSync(path, 'utf8') }) {
  const gaps = [];
  for (const pull of pulls.filter(candidate => candidate.head?.ref === headRef)) {
    const where = pull.label ?? `PR #${pull.number}`;
    const cards = [...new Set(`${pull.title ?? ''}\n${pull.body ?? ''}`.match(/\bJUL-\d+\b/g) ?? [])];
    if (!cards.length) {
      if (declaresNoCard(pull.body)) continue;
      gaps.push(`${where} names no JUL card, so there is no scorecard to check: put the card in the title, as (JUL-123), or say "No card: <reason>" in the body when the work is not a card`);
      continue;
    }
    for (const card of cards) {
      const path = `docs/scorecards/${card}.md`;
      let written;
      try {
        written = readFile(path);
      } catch {
        gaps.push(`${where} names ${card} but ${path} is not on the branch: run node scripts/scorecard.mjs ${card} --write and commit what it writes`);
        continue;
      }
      const cost = /^- Cost: \*\*(.+?)\*\*/m.exec(written)?.[1] ?? 'no Cost line';
      if (!/^\$\d+(\.\d+)?$/.test(cost) || Number(cost.slice(1)) <= 0) {
        gaps.push(`${where} carries ${path} with cost "${cost}" and a pull request needs a measured cost: the scorecard prices a card from its session's trace file, so read node scripts/trace-store.mjs status and re-run node scripts/scorecard.mjs ${card} --write`);
        continue;
      }
      const incomplete = /^- Cost incomplete: (.*)$/m.exec(written)?.[1];
      if (incomplete) gaps.push(`${where} carries ${path} with a cost that is known to be short: ${incomplete}`);
    }
  }
  return gaps;
}

// A body is a draft before it is published, and every card key in it is a scorecard CI will
// demand. Writing a body that names the umbrella card and a throwaway card beside the slice it
// actually ships costs a whole CI cycle, because the token cannot restart a run and a body edit
// does not start one. So the same rule answers offline: `--body <path>` reads the draft the way
// CI will read the published pull request, and names every card it would ask a scorecard for.
export function bodyGaps({ title = '', body, readFile } = {}) {
  const headRef = 'preflight';
  return scorecardGaps({
    pulls: [{ label: 'This pull request', title, body, head: { ref: headRef } }],
    headRef,
    ...(readFile ? { readFile } : {}),
  });
}

async function githubPages(path, { apiUrl, repository, token }) {
  const values = [];
  for (let page = 1; ; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const response = await fetch(`${apiUrl}/repos/${repository}/${path}${separator}per_page=100&page=${page}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) throw new Error(`GitHub ${path} request failed with ${response.status}`);
    const pageValues = await response.json();
    values.push(...pageValues);
    if (pageValues.length < 100) return values;
  }
}

export async function checkBranchPullRequests({
  apiUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com',
  repository = process.env.GITHUB_REPOSITORY,
  token = process.env.GITHUB_TOKEN,
  headRef = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || '',
  readFile,
} = {}) {
  if (!repository || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  const [branches, pulls] = await Promise.all([
    githubPages('branches', { apiUrl, repository, token }),
    githubPages('pulls?state=open&base=main', { apiUrl, repository, token }),
  ]);
  return {
    branches: branchesWithoutOpenPullRequests({ branches, pulls, repository }),
    scorecards: scorecardGaps({ pulls, headRef, readFile }),
  };
}

function preflightBody(file, title) {
  if (!file || file.startsWith('--')) {
    console.error('usage: node scripts/check-branch-pr.mjs --body <path> [--title <title>]');
    return 1;
  }
  const gaps = bodyGaps({ title, body: readFileSync(file, 'utf8') });
  if (!gaps.length) {
    console.log('This body names only cards this branch carries a priced scorecard for.');
    return 0;
  }
  console.error(`This body would fail the branch audit:\n${gaps.join('\n')}`);
  return 1;
}

async function auditBranches() {
  const { branches, scorecards } = await checkBranchPullRequests();
  if (branches.length) console.error(`Branches without an open pull request to main:\n${branches.join('\n')}`);
  if (scorecards.length) console.error(`Pull requests without a scorecard that shows a cost:\n${scorecards.join('\n')}`);
  if (branches.length || scorecards.length) return 1;
  console.log('Every non-main branch has an open pull request to main, and the one being pushed carries a scorecard with a cost.');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const after = flag => {
    const at = args.indexOf(flag);
    return at === -1 ? undefined : args[at + 1];
  };
  try {
    process.exitCode = args.includes('--body')
      ? preflightBody(after('--body') ?? '', after('--title') ?? '')
      : await auditBranches();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
