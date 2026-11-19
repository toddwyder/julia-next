import { githubApi } from './julia-runner-app.mjs';

const PLATFORM_RELEASE_NOTES_URL = 'https://platform.claude.com/docs/en/release-notes/overview.md';
const PLATFORM_RELEASE_HTML_BASE = 'https://platform.claude.com/docs/en/release-notes/overview';

const MONTHS = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

export function parsePlatformReleaseNotes(markdown, { limit = 5 } = {}) {
  const sections = [];
  const lines = String(markdown ?? '').split(/\r?\n/);
  let current = null;

  for (const line of lines) {
    const heading = line.match(/^###\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s*$/);
    if (heading) {
      if (current) sections.push(current);
      const month = MONTHS[heading[1].toLowerCase()];
      const day = heading[2].padStart(2, '0');
      const year = heading[3];
      const isoDate = month ? `${year}-${month}-${day}` : `${year}-${heading[1]}-${day}`;
      const label = `${heading[1]} ${heading[2]}, ${year}`;
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      current = {
        id: `platform:${isoDate}`,
        source: 'Anthropic Platform',
        name: 'Anthropic Platform & Models',
        version: isoDate,
        publishedAt: month ? `${isoDate}T00:00:00Z` : null,
        url: `${PLATFORM_RELEASE_HTML_BASE}#${slug}`,
        lines: [],
      };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);

  return sections.slice(0, limit).map(s => ({
    id: s.id,
    source: s.source,
    name: s.name,
    version: s.version,
    publishedAt: s.publishedAt,
    url: s.url,
    notes: s.lines.join('\n').trim().slice(0, 12_000),
  }));
}

export async function fetchAnthropicReleases({ fetchImpl = fetch, githubToken } = {}) {
  const items = [];

  try {
    const res = await fetchImpl(PLATFORM_RELEASE_NOTES_URL, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const md = await res.text();
      items.push(...parsePlatformReleaseNotes(md, { limit: 3 }));
    }
  } catch {
    // Continue to GitHub release sources if docs fetch fails.
  }

  const ghHeaders = { Accept: 'application/vnd.github+json', 'User-Agent': 'julia-runner' };
  if (githubToken) ghHeaders.Authorization = `Bearer ${githubToken}`;

  for (const repoSlug of ['anthropics/claude-code', 'anthropics/anthropic-sdk-typescript']) {
    try {
      const res = await fetchImpl(`https://api.github.com/repos/${repoSlug}/releases?per_page=3`, {
        headers: ghHeaders,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const releases = await res.json();
      for (const rel of releases) {
        if (rel.draft) continue;
        items.push({
          id: `${repoSlug}:${rel.tag_name}`,
          source: repoSlug,
          name: repoSlug,
          version: String(rel.tag_name),
          publishedAt: rel.published_at ?? rel.created_at ?? null,
          url: rel.html_url,
          notes: String(rel.body ?? rel.name ?? '').trim().slice(0, 12_000),
        });
      }
    } catch {
      // Ignore transient network errors for individual release feeds.
    }
  }

  return items;
}

export async function ensureAnthropicTrackingIssue({ owner, repo, token, fetchImpl = fetch }) {
  const issues = await githubApi(`/repos/${owner}/${repo}/issues?state=open&per_page=50`, { token, fetchImpl });
  const existing = issues.find(i => !i.pull_request && i.title === 'Anthropic Releases');
  if (existing) return existing;
  return githubApi(`/repos/${owner}/${repo}/issues`, {
    token,
    method: 'POST',
    body: {
      title: 'Anthropic Releases',
      body: 'Automated plain-English reports for new Anthropic models, Claude Code releases, and Anthropic SDK/API changes.',
    },
    fetchImpl,
  });
}
