type LinearNoteClient = {
  query: (document: string, variables: Record<string, unknown>) => Promise<Response>
  mutate: (document: string, variables: Record<string, unknown>) => Promise<Response>
}

type PausedBuild = {
  runId: string
  state?: string
  error?: { message?: string } | null
  pause?: { at?: string } | null
  linearNote?: { posted?: boolean } | null
  snapshot?: { card?: { identifier?: string } }
}

export async function notePausedBuild({ job, client, posted = new Set<string>() }: { job: PausedBuild; client: LinearNoteClient; posted?: Set<string> }) {
  if (!job || job.state !== 'paused') return false
  const key = `${job.runId}:${job.pause?.at ?? job.error?.message ?? ''}`
  if (job.linearNote?.posted || posted.has(key)) return false
  posted.add(key)
  const identifier = job.snapshot?.card?.identifier
  if (!identifier) return false
  try {
    const lookup = await client.query('query Issue($id:String!){issue(id:$id){id}}', { id: identifier })
    const found = await lookup.json() as { data?: { issue?: { id?: string } } }
    const issueId = found.data?.issue?.id
    if (!issueId) return false
    const created = await client.mutate(
      'mutation Comment($input:CommentCreateInput!){commentCreate(input:$input){success}}',
      { input: { issueId, body: job.error?.message ?? 'Build paused with its work kept.' } },
    )
    const body = await created.json() as { data?: { commentCreate?: { success?: boolean } } }
    return body.data?.commentCreate?.success === true
  } catch {
    return false
  }
}
