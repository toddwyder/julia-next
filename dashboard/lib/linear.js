const endpoint = 'https://api.linear.app/graphql';
const readyQuery = `query DashboardReady($after: String) {
  issues(first: 100, after: $after, orderBy: createdAt,
    filter: { team: { name: { eq: "Julia-next" } }, state: { name: { eq: "Ready" } } }) {
    nodes { id identifier title createdAt state { name } team { name } }
    pageInfo { hasNextPage endCursor }
  }
}`;

export async function listReady({ apiKey = process.env.LINEAR_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('Linear configuration failure. LINEAR_API_KEY is missing.');
  const cards = new Map();
  const cursors = new Set();
  let after = null;
  do {
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(10000),
        headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: readyQuery, variables: { after } }),
      });
    } catch {
      throw new Error('Linear connection failure. The dashboard could not reach Linear within 10 seconds.');
    }
    if (!response.ok) throw new Error(`Linear request failed. HTTP ${response.status}.`);
    let body;
    try { body = await response.json(); }
    catch { throw new Error('Linear returned a malformed response. Expected JSON.'); }
    if (Array.isArray(body?.errors) && body.errors.length) {
      const reason = body.errors.map(x => typeof x?.message === 'string' ? x.message : 'Unknown provider error').join('; ');
      throw new Error(`Linear request failed. ${reason.split(apiKey).join('[redacted]').slice(0, 400)}`);
    }
    const connection = body?.data?.issues;
    if (!Array.isArray(connection?.nodes) || typeof connection?.pageInfo?.hasNextPage !== 'boolean') {
      throw new Error('Linear returned a malformed Ready list.');
    }
    for (const card of connection.nodes) {
      if (!card || typeof card.id !== 'string' || !card.id ||
          !/^JUL-\d+$/.test(card.identifier) || typeof card.title !== 'string' || !card.title.trim() ||
          typeof card.createdAt !== 'string' || !Number.isFinite(Date.parse(card.createdAt)) ||
          card.state?.name !== 'Ready' || card.team?.name !== 'Julia-next') {
        throw new Error('Linear returned an unexpected card in the Ready list.');
      }
      if (cards.has(card.id)) throw new Error('Linear returned a duplicate card. Reload the list.');
      cards.set(card.id, { id: card.id, identifier: card.identifier, title: card.title, createdAt: card.createdAt });
    }
    after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
    if (connection.pageInfo.hasNextPage && (typeof after !== 'string' || !after || cursors.has(after))) {
      throw new Error('Linear returned invalid pagination for the Ready list.');
    }
    cursors.add(after);
  } while (after);
  return [...cards.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.identifier.localeCompare(b.identifier));
}

export async function getReadyCard(identifier, options) {
  return (await listReady(options)).find(card => card.identifier === identifier) ?? null;
}
