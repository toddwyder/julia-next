export async function fetchLinearCard({ card, apiKey = process.env.LINEAR_API_KEY, fetchImpl = fetch } = {}) {
  if (!card) throw new Error('card is required')
  if (!apiKey) return null
  const headers = { 'content-type': 'application/json', authorization: apiKey }
  try {
    const response = await fetchImpl('https://api.linear.app/graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: 'query Card($id: String!) { issue(id: $id) { identifier title description state { name } labels { nodes { name } } } }', variables: { id: card } }),
      redirect: 'error',
    })
    if (!response.ok) return null
    const body = await response.json()
    const issue = body?.data?.issue
    if (!issue?.identifier) return null
    return {
      identifier: issue.identifier,
      title: issue.title ?? '',
      description: issue.description ?? '',
      state: issue.state?.name ?? '',
      labels: (issue.labels?.nodes ?? []).map(label => label.name),
    }
  } catch {
    return null
  }
}

export async function moveLinearCard({ card, stateName, apiKey = process.env.LINEAR_API_KEY, fetchImpl = fetch } = {}) {
  if (!card || !stateName) return { moved: false, reason: 'card and state name are required' }
  if (!apiKey) return { moved: false, reason: 'LINEAR_API_KEY is not present in the runner environment' }
  const headers = { 'content-type': 'application/json', authorization: apiKey }
  try {
    const lookup = await fetchImpl('https://api.linear.app/graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: 'query Issue($id: String!) { issue(id: $id) { id team { states { nodes { id name } } } } }', variables: { id: card } }),
      redirect: 'error',
    })
    if (!lookup.ok) return { moved: false, reason: `Linear lookup failed with HTTP ${lookup.status}` }
    const found = await lookup.json()
    const issue = found?.data?.issue
    if (!issue?.id) return { moved: false, reason: `Linear lookup found no issue for ${card}` }
    const states = issue.team?.states?.nodes ?? []
    const wanted = stateName.toLowerCase()
    const state = states.find(node => String(node?.name ?? '').toLowerCase() === wanted)
    if (!state?.id) return { moved: false, reason: `Linear has no state named ${stateName}` }
    const updated = await fetchImpl('https://api.linear.app/graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: 'mutation IssueUpdate($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }', variables: { id: card, stateId: state.id } }),
      redirect: 'error',
    })
    if (!updated.ok) return { moved: false, reason: `Linear state update failed with HTTP ${updated.status}` }
    const body = await updated.json()
    if (!body?.data?.issueUpdate?.success) return { moved: false, reason: 'Linear did not accept the state update' }
    return { moved: true }
  } catch (error) {
    return { moved: false, reason: `Linear state update failed: ${error.message}` }
  }
}

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
