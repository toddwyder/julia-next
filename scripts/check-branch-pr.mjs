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

// A card's scorecard is how a card's cost reaches Todd, and a scorecard that could not read
// the session's trace file prints `Cost: **unknown**` while looking finished. So a pull
// request that names a card has to carry that card's scorecard, and the card's cost has to be
// a number somebody could check.
export function scorecardGaps({ pulls, headRef, readFile = path => readFileSync(path, 'utf8') }) {
  const gaps = [];
  for (const pull of pulls.filter(candidate => candidate.head?.ref === headRef)) {
    const cards = [...new Set(`${pull.title ?? ''}\n${pull.body ?? ''}`.match(/\bJUL-\d+\b/g) ?? [])];
    if (!cards.length) {
      gaps.push(`PR #${pull.number} names no JUL card, so there is no scorecard to check: put the card in the title, as (JUL-123)`);
      continue;
    }
    for (const card of cards) {
      const path = `docs/scorecards/${card}.md`;
      let cost;
      try {
        cost = /^- Cost: \*\*(.+?)\*\*/m.exec(readFile(path))?.[1] ?? 'no Cost line';
      } catch {
        gaps.push(`PR #${pull.number} names ${card} but ${path} is not on the branch: run node scripts/scorecard.mjs ${card} --write and commit what it writes`);
        continue;
      }
      if (!/^\$\d+(\.\d+)?$/.test(cost) || Number(cost.slice(1)) <= 0) {
        gaps.push(`PR #${pull.number} carries ${path} with cost "${cost}" and a pull request needs a measured cost: the scorecard prices a card from its session's trace file, so read node scripts/trace-store.mjs status and re-run node scripts/scorecard.mjs ${card} --write`);
      }
    }
  }
  return gaps;
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { branches, scorecards } = await checkBranchPullRequests();
    if (branches.length) console.error(`Branches without an open pull request to main:\n${branches.join('\n')}`);
    if (scorecards.length) console.error(`Pull requests without a scorecard that shows a cost:\n${scorecards.join('\n')}`);
    if (branches.length || scorecards.length) process.exitCode = 1;
    else console.log('Every non-main branch has an open pull request to main, and the one being pushed carries a scorecard with a cost.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
