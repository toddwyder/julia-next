export type LinearIssue = { identifier: string; title?: string; description: string; state: { name: string } }
export type LinearReadTrace = {
  operation: 'linear-read'
  issueId: string
  ok: boolean
  status: number
  durationMs: number
  errorCategory?: 'http' | 'graphql' | 'invalid-response'
}

export async function fetchLinearIssue(
  issueId: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  recordTrace: (trace: LinearReadTrace) => void | Promise<void> = () => {},
) {
  const started = performance.now()
  let status = 0
  try {
    const response = await fetchImpl('https://api.linear.app/graphql', {
      method: 'POST', headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'query Card($id:String!){issue(id:$id){identifier title description state{name}}}', variables: { id: issueId } }),
    })
    status = response.status
    const body = await response.json() as { data?: { issue?: LinearIssue }; errors?: unknown }
    const errorCategory = !response.ok ? 'http' : body.errors ? 'graphql' : !body.data?.issue ? 'invalid-response' : undefined
    if (errorCategory) {
      await recordTrace({ operation: 'linear-read', issueId, ok: false, status, errorCategory, durationMs: performance.now() - started })
      throw new Error(`Linear ${issueId} read failed with HTTP ${status} (${errorCategory})`)
    }
    await recordTrace({ operation: 'linear-read', issueId, ok: true, status, durationMs: performance.now() - started })
    return body.data!.issue!
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`Linear ${issueId} read failed`)) throw error
    await recordTrace({ operation: 'linear-read', issueId, ok: false, status, errorCategory: 'invalid-response', durationMs: performance.now() - started })
    throw new Error(`Linear ${issueId} read failed with HTTP ${status} (invalid-response)`, { cause: error })
  }
}
