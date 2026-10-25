import { ControlPageCardSchema, ReadyCardSchema } from './contracts.ts'
import type { LinearQueryClient } from './initialization-observability.ts'
import { isFrameworkMapRecord } from './framework-map.ts'

export type LinearIssue = { identifier: string; title?: string; description: string; state: { name: string }; labels?: { nodes: { name: string }[] }; comments?: { nodes: { body: string; createdAt?: string }[]; pageInfo: { hasNextPage: boolean; endCursor?: string } } }
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
  inadmissibleCount?: number
  errorCategory?: 'http' | 'graphql' | 'invalid-response'
}

export function cardAdmissionInput(issue: LinearIssue) {
  const comments = issue.comments
  const maps = comments?.nodes.filter(comment => isFrameworkMapRecord(comment.body)) ?? []
  // Undated records cannot establish supersession: retain all and fail closed.
  const dated = maps.every(comment => Number.isFinite(Date.parse(comment.createdAt ?? '')))
  const selected = dated
    ? [...maps].sort((left, right) => Date.parse(right.createdAt!) - Date.parse(left.createdAt!)).slice(0, 1)
    : maps
  return {
    identifier: issue.identifier, state: issue.state.name, description: issue.description,
    ...(issue.labels?.nodes ? { labels: issue.labels.nodes.map(label => label.name) } : {}),
    ...(comments ? { frameworkMaps: selected.map(comment => comment.body) } : {}),
  }
}

async function completeIssueComments(issue: LinearIssue, client: LinearQueryClient) {
  const seen = new Set<string>()
  while (issue.comments?.pageInfo.hasNextPage) {
    const after = issue.comments.pageInfo.endCursor
    if (!after || seen.has(after)) throw new Error('Linear comment pagination returned an invalid cursor')
    seen.add(after)
    const response = await client.query(
      'query CardComments($id:String!,$after:String!){issue(id:$id){comments(first:250,after:$after){nodes{body createdAt} pageInfo{hasNextPage endCursor}}}}',
      { id: issue.identifier, after },
    )
    const body = await response.json() as { data?: { issue?: Pick<LinearIssue, 'comments'> }; errors?: unknown }
    const next = body.data?.issue?.comments
    if (!response.ok || body.errors || !Array.isArray(next?.nodes) || typeof next?.pageInfo?.hasNextPage !== 'boolean') {
      throw new Error(`Linear ${issue.identifier} comment read failed with HTTP ${response.status}`)
    }
    issue.comments = { nodes: [...issue.comments.nodes, ...next.nodes], pageInfo: next.pageInfo }
  }
  return issue
}

function admissionReason(error: { issues: { message: string }[] }) {
  const parts = error.issues.map(issue => {
    const section = /^missing nonempty (.+) section$/.exec(issue.message)
    if (section) return `missing the ${section[1]} section`
    const emptySection = /^empty (.+) section$/.exec(issue.message)
    if (emptySection) return `the ${emptySection[1]} section is empty`
    const retiredSection = /^retired (.+) section$/.exec(issue.message)
    if (retiredSection) return `the ${retiredSection[1]} section is retired`
    if (issue.message === 'Acceptance criteria section lists no criteria') return 'the Acceptance criteria section lists no criteria'
    if (issue.message === 'more than 5 acceptance criteria') return 'more than five acceptance criteria'
    if (issue.message === 'unresolved decision marker') return 'an unresolved decision marker must be decided first'
    return issue.message
  })
  return `Cannot start: ${[...new Set(parts)].join('; ')}`
}

// Admission is per card. One Ready card that fails it is reported as not startable
// and the rest are admitted normally, rather than the whole list failing.
export function admitReadyCards(issues: LinearIssue[]) {
  return issues.map(issue => {
    const admitted = ReadyCardSchema.safeParse({
      ...cardAdmissionInput(issue), title: issue.title,
    })
    if (admitted.success) return ControlPageCardSchema.parse({ admitted: true, card: admitted.data })
    return ControlPageCardSchema.parse({
      admitted: false,
      card: {
        identifier: issue.identifier,
        title: issue.title?.trim() || issue.identifier,
        state: issue.state.name,
        reason: admissionReason(admitted.error),
      },
    })
  })
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
        'query ReadyCards($after:String) { issues(first: 50, after: $after, filter: { state: { name: { eq: "Ready" } } }) { nodes { identifier title description state { name } labels { nodes { name } } comments(first: 250) { nodes { body createdAt } pageInfo { hasNextPage endCursor } } } pageInfo { hasNextPage endCursor } } }',
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
    await Promise.all(issues.map(issue => completeIssueComments(issue, client)))
    const cards = admitReadyCards(issues)
    await recordTrace({
      operation: 'linear-ready-list', ok: true, status, cardCount: cards.length,
      inadmissibleCount: cards.filter(entry => !entry.admitted).length, durationMs: performance.now() - started,
    })
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
      body: JSON.stringify({ query: 'query Card($id:String!){issue(id:$id){identifier title description state{name} comments(first:250){nodes{body createdAt} pageInfo{hasNextPage endCursor}}}}', variables: { id: issueId } }),
    })
    status = response.status
    const body = await response.json() as { data?: { issue?: LinearIssue }; errors?: unknown }
    const errorCategory = !response.ok ? 'http' : body.errors ? 'graphql' : !body.data?.issue ? 'invalid-response' : undefined
    if (errorCategory) {
      await recordTrace({ operation: 'linear-read', issueId, ok: false, status, errorCategory, durationMs: performance.now() - started })
      throw new Error(`Linear ${issueId} read failed with HTTP ${status} (${errorCategory})`)
    }
    await completeIssueComments(body.data!.issue!, { query: (query, variables) => fetchImpl('https://api.linear.app/graphql', {
      method: 'POST', headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    }) })
    await recordTrace({ operation: 'linear-read', issueId, ok: true, status, durationMs: performance.now() - started })
    return body.data!.issue!
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`Linear ${issueId} read failed`)) throw error
    await recordTrace({ operation: 'linear-read', issueId, ok: false, status, errorCategory: 'invalid-response', durationMs: performance.now() - started })
    throw new Error(`Linear ${issueId} read failed with HTTP ${status} (invalid-response)`, { cause: error })
  }
}
