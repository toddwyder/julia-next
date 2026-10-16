import { ReadyCardSchema } from './contracts.ts'
import type { LinearQueryClient } from './initialization-observability.ts'

export type LinearIssue = { identifier: string; title?: string; description: string; state: { name: string } }
export type LinearReadTrace = {
  operation: 'linear-read'
  issueId: string
  ok: boolean
  status: number
  durationMs: number
  errorCategory?: 'http' | 'graphql' | 'invalid-response'
}

export type LinearReadyListTrace = {
  operation: 'linear-ready-list'
  ok: boolean
  status: number
  durationMs: number
  cardCount?: number
  errorCategory?: 'http' | 'graphql' | 'invalid-response'
}

export async function listReadyLinearCards(
  client: LinearQueryClient,
  recordTrace: (trace: LinearReadyListTrace) => void | Promise<void> = () => {},
) {
  const started = performance.now()
  let status = 0
  try {
    const issues: LinearIssue[] = []
    let after: string | null = null
    do {
      const response = await client.query(
        'query ReadyCards($after:String) { issues(first: 50, after: $after, filter: { state: { name: { eq: "Ready" } } }) { nodes { identifier title description state { name } } pageInfo { hasNextPage endCursor } } }',
        { after },
      )
      status = response.status
      const body = await response.json() as {
        data?: { issues?: { nodes?: LinearIssue[]; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } } }
        errors?: unknown
      }
      const connection = body.data?.issues
      const errorCategory = !response.ok
        ? 'http'
        : body.errors
          ? 'graphql'
          : !Array.isArray(connection?.nodes) || typeof connection.pageInfo?.hasNextPage !== 'boolean'
            ? 'invalid-response'
            : undefined
      if (errorCategory) {
        await recordTrace({ operation: 'linear-ready-list', ok: false, status, errorCategory, durationMs: performance.now() - started })
        throw new Error(`Linear Ready-card list failed with HTTP ${status} (${errorCategory})`)
      }
      issues.push(...connection!.nodes!)
      if (!connection!.pageInfo!.hasNextPage) {
        after = null
      } else if (typeof connection!.pageInfo!.endCursor === 'string' && connection!.pageInfo!.endCursor.length > 0) {
        after = connection!.pageInfo!.endCursor
      } else {
        await recordTrace({ operation: 'linear-ready-list', ok: false, status, errorCategory: 'invalid-response', durationMs: performance.now() - started })
        throw new Error(`Linear Ready-card list failed with HTTP ${status} (invalid-response)`)
      }
    } while (after !== null)
    const cards = ReadyCardSchema.array().parse(issues.map(issue => ({
      identifier: issue.identifier, title: issue.title, description: issue.description, state: issue.state.name,
    })))
    await recordTrace({ operation: 'linear-ready-list', ok: true, status, cardCount: cards.length, durationMs: performance.now() - started })
    return cards
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Linear Ready-card list failed')) throw error
    await recordTrace({ operation: 'linear-ready-list', ok: false, status, errorCategory: 'invalid-response', durationMs: performance.now() - started })
    throw new Error(`Linear Ready-card list failed with HTTP ${status} (invalid-response)`, { cause: error })
  }
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
