// monday-note-adapters.mjs -- issue #140, blocker 1: the two production
// clients the Monday note uses to reach the outside world.
//
// 1. GitHub Discussions, over GitHub's GraphQL API at api.github.com. This is
//    the same injected-`fetch` shape scripts/linear-cli.mjs already uses for
//    Linear: the caller passes `fetchImpl`, so a test captures the exact
//    request and no test reaches GitHub. The note lands in a discussion
//    category ("Monday notes"), which Factory does not ingest, so it never
//    appears in Intake.
// 2. Todd's phone, through the installed Discord wait-alert route
//    (ops/factory/wait-alerts.py): one channel webhook, `?wait=true`, no
//    mentions, and a confirmed message id. No new paid service is introduced.
//
// Both clients fail loudly. A GraphQL error, an unknown category, a non-Discord
// webhook, or a Discord reply without a message id throws, so a failed send is
// never recorded as delivered.

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';

/** Bound on the discussion pages `find` reads; one page holds 100 discussions. */
const MAX_DISCUSSION_PAGES = 100;

const CATEGORY_QUERY = `
  query DiscussionCategories($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      id
      discussionCategories(first: 100) { nodes { id name } }
    }
  }
`;

const EXISTING_DISCUSSION_QUERY = `
  query ExistingDiscussion($owner: String!, $repo: String!, $after: String) {
    repository(owner: $owner, name: $repo) {
      discussions(first: 100, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes { id title url }
      }
    }
  }
`;

const CREATE_DISCUSSION_MUTATION = `
  mutation CreateDiscussion($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
    createDiscussion(input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }) {
      discussion { id url }
    }
  }
`;

/**
 * GitHub's GraphQL hub, with the token never on the command line and errors
 * surfaced rather than swallowed. Mirrors `linearGraphQL` in scripts/linear-cli.mjs.
 */
async function githubGraphQL(query, variables, { fetchImpl, token }) {
  if (!token) throw new Error('GitHub Discussions client requires a token');
  const res = await fetchImpl(GITHUB_GRAPHQL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) {
    throw new Error(`GitHub Discussions API error: ${res.status} ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.data;
}

/**
 * The GitHub Discussions publisher the note is posted through.
 *
 * `find` is the week's dedupe: it returns the existing Discussion for the exact
 * note title, or null. `post` creates one. The category is resolved to its
 * GraphQL id on every call (and must exist), so a missing "Monday notes"
 * category fails instead of silently dropping the note into General.
 */
export function createDiscussionsClient({ fetchImpl = fetch, token, owner, repo }) {
  if (!owner || !repo) throw new Error('GitHub Discussions client requires owner and repo');

  async function resolveCategory(name) {
    const data = await githubGraphQL(CATEGORY_QUERY, { owner, repo }, { fetchImpl, token });
    const repository = data?.repository;
    if (!repository?.id) throw new Error(`GitHub repository ${owner}/${repo} was not found`);
    const nodes = repository.discussionCategories?.nodes ?? [];
    const category = nodes.find((node) => node.name === name);
    if (!category) throw new Error(`GitHub discussion category "${name}" was not found in ${owner}/${repo}`);
    return { categoryId: category.id, repositoryId: repository.id };
  }

  return {
    async find({ category, title }) {
      await resolveCategory(category);
      // Page through every discussion so a note from any earlier week is still
      // found. The title is the dedupe cursor: if a page's `hasNextPage` is
      // true and the title is not on it, keep going; an unreadable page fails
      // closed rather than reporting "not published".
      let after = null;
      for (let page = 0; page < MAX_DISCUSSION_PAGES; page += 1) {
        const data = await githubGraphQL(EXISTING_DISCUSSION_QUERY, { owner, repo, after }, { fetchImpl, token });
        const discussions = data?.repository?.discussions;
        if (!discussions || !Array.isArray(discussions.nodes)) {
          throw new Error('GitHub Discussions listing did not include a nodes array');
        }
        const match = discussions.nodes.find((node) => node.title === title);
        if (match) return match;
        if (discussions.pageInfo?.hasNextPage !== true) return null;
        after = discussions.pageInfo.endCursor ?? null;
        if (!after) throw new Error('GitHub Discussions listing said more pages but returned no cursor');
      }
      throw new Error(`GitHub Discussions listing exceeded ${MAX_DISCUSSION_PAGES} pages`);
    },
    async post({ category, title, body }) {
      const { categoryId, repositoryId } = await resolveCategory(category);
      const data = await githubGraphQL(
        CREATE_DISCUSSION_MUTATION,
        { repositoryId, categoryId, title, body },
        { fetchImpl, token },
      );
      const discussion = data?.createDiscussion?.discussion;
      if (!discussion?.url) throw new Error('GitHub did not return the created discussion URL');
      return discussion;
    },
  };
}

const DISCORD_WEBHOOK = /^https:\/\/discord\.com\/api\/webhooks\/[0-9]{17,20}\/[A-Za-z0-9_-]{30,}$/;

/**
 * Todd's phone, through the same channel webhook the wait watcher uses.
 *
 * `notify` posts one message that carries the Discussion link and disables
 * mentions (`allowed_mentions.parse: []`), then requires Discord to confirm a
 * message id. A reply without one throws, because an unconfirmed send must
 * never read as delivered.
 */
export function createDiscordNotifier({ fetchImpl = fetch, webhookUrl }) {
  if (!DISCORD_WEBHOOK.test(webhookUrl ?? '')) {
    throw new Error('Discord webhook URL must be a discord.com webhook URL');
  }

  return {
    async notify({ title, body, url }) {
      const content = `${title}\n${body}\n${url}`;
      const response = await fetchImpl(`${webhookUrl}?wait=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'JuliaFactoryMondayNote/1.0' },
        body: JSON.stringify({ content, username: 'Factory', allowed_mentions: { parse: [] } }),
      });
      if (!response.ok) throw new Error(`Discord publish returned HTTP ${response.status}`);
      const message = await response.json();
      const messageId = String(message?.id ?? '');
      if (!/^[0-9]{17,20}$/.test(messageId)) throw new Error('Discord did not confirm a message ID');
      return { messageId };
    },
  };
}
