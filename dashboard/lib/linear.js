const endpoint = 'https://api.linear.app/graphql';
const readyQuery = `query DashboardReady($after: String) {
  issues(first: 100, after: $after, orderBy: createdAt,
    filter: { team: { name: { eq: "Julia-next" } }, state: { name: { eq: "Ready" } } }) {
    nodes { id identifier title createdAt state { name } team { name } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const isTimeout = error => error?.name === 'TimeoutError' || error?.name === 'AbortError';

const unreachable = () => new Error('Linear connection failure. The dashboard could not reach Linear.');
const unreachableSlow = () => new Error('Linear connection failure. The dashboard could not reach Linear within 10 seconds.');
const replyIncomplete = () => new Error('Linear connection failure. Linear ended its reply before it was complete.');
const replySlow = () => new Error('Linear connection failure. Linear did not finish its reply within 10 seconds.');

async function readReply(response) {
  try { return await response.text(); }
  catch (error) { throw isTimeout(error) ? replySlow() : replyIncomplete(); }
}

function providerReason(body, apiKey) {
  if (!Array.isArray(body?.errors) || !body.errors.length) return '';
  const reason = body.errors.map(x => typeof x?.message === 'string' ? x.message : 'Unknown provider error').join('; ');
  return ` ${reason.split(apiKey).join('[redacted]').slice(0, 400)}`;
}

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
    } catch (error) {
      throw isTimeout(error) ? unreachableSlow() : unreachable();
    }
    const text = await readReply(response);
    let body;
    try { body = JSON.parse(text); }
    catch { body = undefined; }
    if (!response.ok) throw new Error(`Linear request failed. HTTP ${response.status}.${providerReason(body, apiKey)}`);
    if (body === undefined) throw new Error('Linear returned a malformed response. Expected JSON.');
    if (Array.isArray(body?.errors) && body.errors.length) {
      throw new Error(`Linear request failed.${providerReason(body, apiKey)}`);
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
