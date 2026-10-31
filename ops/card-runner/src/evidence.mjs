// The build's evidence is whatever it posted on the card after the run began.
// Nothing is typed by hand between the build and Shipping: the runner reads the
// new comments back from Linear and hands them straight to the judge.
export function selectEvidence(comments, sinceISO) {
  const since = Date.parse(sinceISO)
  if (Number.isNaN(since)) throw new Error(`evidence start is not a date: ${sinceISO}`)
  return (comments ?? [])
    .filter((comment) => Date.parse(comment.createdAt) >= since)
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .map((comment) => ({
      id: comment.id,
      author: comment.user?.name ?? 'unknown',
      body: String(comment.body ?? '').trim(),
      createdAt: comment.createdAt,
    }))
}

export function evidenceBlock(evidence) {
  if (!evidence?.length) return 'The build posted no evidence comment on the card.'
  return evidence
    .map((item) => `### Evidence from ${item.author} at ${item.createdAt} (Linear comment ${item.id})\n\n${item.body}`)
    .join('\n\n')
}
