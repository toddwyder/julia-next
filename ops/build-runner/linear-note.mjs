export async function postLinearComment({ card, message, apiKey = process.env.LINEAR_API_KEY, fetchImpl = fetch } = {}) {
  if (!card || !message) throw new Error('card and message are required')
  if (!apiKey) return { posted: false, reason: 'LINEAR_API_KEY is not present in the runner environment' }
  const headers = { 'content-type': 'application/json', authorization: apiKey }
  try {
    const lookup = await fetchImpl('https://api.linear.app/graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: 'query Issue($id: String!) { issue(id: $id) { id } }', variables: { id: card } }),
      redirect: 'error',
    })
    if (!lookup.ok) return { posted: false, reason: `Linear lookup failed with HTTP ${lookup.status}` }
    const found = await lookup.json()
    const issueId = found?.data?.issue?.id
    if (!issueId) return { posted: false, reason: `Linear lookup found no issue for ${card}` }
    const created = await fetchImpl('https://api.linear.app/graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: 'mutation Comment($input: CommentCreateInput!) { commentCreate(input: $input) { success } }', variables: { input: { issueId, body: message } } }),
      redirect: 'error',
    })
    if (!created.ok) return { posted: false, reason: `Linear comment failed with HTTP ${created.status}` }
    const body = await created.json()
    if (!body?.data?.commentCreate?.success) return { posted: false, reason: 'Linear did not accept the comment' }
    return { posted: true }
  } catch (error) {
    return { posted: false, reason: `Linear comment failed: ${error.message}` }
  }
}
