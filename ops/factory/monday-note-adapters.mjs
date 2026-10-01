// monday-note-adapters.mjs -- issue #180: the production client
// the Monday cost note uses to publish on GitHub.
//
// GitHub Issues (issue #180), over GitHub's REST API at api.github.com.
// Posts public cost notes with labels `factory:machine,cost-note` so Claude
// and Todd can view them without signing in, and Factory intake ignores them.

const GITHUB_REST_URL = 'https://api.github.com';
import { getPublisherInstallationToken, loadPublisherCredentialFile } from '../../scripts/publish-via-github-app.mjs';

/** Reuse the trusted publisher App; mint a fresh short-lived token each run. */
export async function createPublisherIssuesClient({ env = process.env, fetchImpl = fetch,
  loadCredential = loadPublisherCredentialFile, tokenImpl = getPublisherInstallationToken } = {}) {
  const owner = env.MONDAY_NOTE_GITHUB_OWNER;
  const repo = env.MONDAY_NOTE_GITHUB_REPO;
  if (`${owner}/${repo}` !== 'toddwyder/julia-next') throw new Error('Monday note publisher is restricted to toddwyder/julia-next');
  // Signing keys stay in this trusted object, never in process.env or psql.
  const credentials = {};
  loadCredential(undefined, credentials);
  const token = await tokenImpl({ ...credentials, JULIA_PUBLISHER_OWNER: owner, JULIA_PUBLISHER_REPO: repo });
  return createIssuesClient({ token, owner, repo, fetchImpl });
}

/** Default labels for cost note issues so Factory intake ignores them. */
export const COST_NOTE_LABELS = ['factory:machine', 'cost-note'];

/** Bound on the issue pages `find` reads; one page holds 100 items. */
const MAX_ISSUE_PAGES = 100;

/**
 * The GitHub Issues publisher the cost note is posted through (Issue #180).
 *
 * `find` checks whether an issue for this week already exists. `post` creates one.
 * Uses labels `factory:machine,cost-note` so Factory intake excludes it.
 */
export function createIssuesClient({ fetchImpl = fetch, token, owner, repo }) {
  if (!owner || !repo) throw new Error('GitHub Issues client requires owner and repo');
  if (!token) throw new Error('GitHub Issues client requires a token');

  return {
    async find({ title, labels = COST_NOTE_LABELS }) {
      const labelsQuery = encodeURIComponent(labels.join(','));
      for (let page = 1; page <= MAX_ISSUE_PAGES; page += 1) {
        const url = `${GITHUB_REST_URL}/repos/${owner}/${repo}/issues?state=all&labels=${labelsQuery}&per_page=100&page=${page}`;
        const res = await fetchImpl(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'JuliaFactoryMondayNote/1.0',
          },
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`GitHub Issues API error: ${res.status} ${body}`);
        }
        const issues = await res.json();
        if (!Array.isArray(issues)) {
          throw new Error('GitHub Issues listing did not return an array');
        }
        const match = issues.find((issue) => issue.title === title);
        if (match) {
          return {
            id: match.id,
            number: match.number,
            title: match.title,
            url: match.html_url ?? match.url,
          };
        }
        if (issues.length < 100) return null;
      }
      throw new Error(`GitHub Issues listing exceeded ${MAX_ISSUE_PAGES} pages`);
    },
    async post({ title, body, labels = COST_NOTE_LABELS }) {
      const url = `${GITHUB_REST_URL}/repos/${owner}/${repo}/issues`;
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'JuliaFactoryMondayNote/1.0',
        },
        body: JSON.stringify({ title, body, labels }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`GitHub Issues API error: ${res.status} ${errBody}`);
      }
      const issue = await res.json();
      return {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        url: issue.html_url ?? issue.url,
      };
    },
  };
}
