import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function branchesWithoutOpenPullRequests({ branches, pulls, repository }) {
  const covered = new Set(pulls
    .filter(pull => pull.state === 'open' && pull.base?.ref === 'main' && pull.head?.repo?.full_name === repository)
    .map(pull => pull.head.ref));
  return branches.map(branch => branch.name).filter(name => name !== 'main' && !covered.has(name)).sort();
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
} = {}) {
  if (!repository || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  const [branches, pulls] = await Promise.all([
    githubPages('branches', { apiUrl, repository, token }),
    githubPages('pulls?state=open&base=main', { apiUrl, repository, token }),
  ]);
  return branchesWithoutOpenPullRequests({ branches, pulls, repository });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const failures = await checkBranchPullRequests();
    if (failures.length) {
      console.error(`Branches without an open pull request to main:\n${failures.join('\n')}`);
      process.exitCode = 1;
    } else console.log('Every non-main branch has an open pull request to main.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
