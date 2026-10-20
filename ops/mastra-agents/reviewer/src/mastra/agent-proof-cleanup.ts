import { writeFile, readFile } from 'node:fs/promises'
import { agentError } from './agent-errors.ts'

/** Tasks must have rejection handlers attached when started, not at cleanup time. */
export async function cleanupProof({ path, tasks, cancel = [], flush = [], close = [], failure }: {
  path: string; tasks: Promise<unknown>[]; cancel?: (() => Promise<unknown>)[];
  flush?: (() => Promise<unknown>)[]; close?: (() => Promise<unknown>)[]; failure?: string
}) {
  const errors: unknown[] = []
  const completed: string[] = []
  const attempt = async (name: string, action: () => Promise<unknown>) => {
    try { await action(); completed.push(name) }
    catch (error) { errors.push(agentError(error, { provider: 'proof', runId: 'cleanup', eventKind: name })) }
  }
  try {
    if (failure) for (const [i, action] of cancel.entries()) await attempt(`cancel-${i}`, action)
    const outcomes = await Promise.allSettled(tasks)
    for (const [i, result] of outcomes.entries()) {
      if (result.status === 'rejected') errors.push(agentError(result.reason, { provider: 'proof', runId: 'cleanup', eventKind: `settle-${i}` }))
      else completed.push(`settle-${i}`)
    }
    for (const [i, action] of flush.entries()) await attempt(`flush-${i}`, action)
    for (const [i, action] of close.entries()) await attempt(`close-${i}`, action)
  } finally {
    const record = { ok: !failure && errors.length === 0, failure: failure ?? null, completed, errors, finishedAt: new Date().toISOString() }
    await writeFile(path, JSON.stringify(record, null, 2) + '\n')
  }
  return JSON.parse(await readFile(path, 'utf8')) as { ok: boolean; failure: string | null; completed: string[]; errors: unknown[] }
}
