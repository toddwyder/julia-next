import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A push run checks the pushed branch before its pull request can exist, so that branch
// is left to its own pull-request run. Every other branch is still audited.
export function branchUnderTest({ GITHUB_EVENT_NAME, GITHUB_REF_NAME } = {}) {
  return GITHUB_EVENT_NAME === 'push' && GITHUB_REF_NAME && GITHUB_REF_NAME !== 'main' ? { pushed: GITHUB_REF_NAME } : {};
}

export function branchesWithoutOpenPullRequests({ branches, pulls, repository, pushed }) {
  const covered = new Set(pulls
    .filter(pull => pull.state === 'open' && pull.base?.ref === 'main' && pull.head?.repo?.full_name === repository)
    .map(pull => pull.head.ref));
  return branches.map(branch => branch.name).filter(name => name !== 'main' && name !== pushed && !covered.has(name)).sort();
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
  env = process.env,
} = {}) {
  if (!repository || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  const [branches, pulls] = await Promise.all([
    githubPages('branches', { apiUrl, repository, token }),
    githubPages('pulls?state=open&base=main', { apiUrl, repository, token }),
  ]);
  return branchesWithoutOpenPullRequests({ branches, pulls, repository, ...branchUnderTest(env) });
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
