import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const SESSION_INACTIVITY_MS = 1000

const log = entry => appendFileSync(process.env.FAKE_LOG, JSON.stringify(entry) + '\n')
const script = JSON.parse(readFileSync(process.env.FAKE_SCRIPT, 'utf8'))
let turn = 0

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init)
  const body = await request.json()
  log({ kind: 'linear', query: body.query, variables: body.variables })
  const json = body.query.includes('team')
    ? { data: { issue: { id: 'issue-1', team: { states: { nodes: [{ id: 's-review', name: 'Evidence review' }, { id: 's-remediation', name: 'Remediation' }] } } } } }
    : body.query.includes('issueUpdate')
      ? { data: { issueUpdate: { success: true } } }
      : body.query.includes('commentCreate')
        ? { data: { commentCreate: { success: true } } }
        : { data: { issue: { id: 'issue-1' } } }
  return new Response(JSON.stringify(json), { headers: { 'content-type': 'application/json' } })
}

export async function openRunner({ cwd, settingsPath, role, hostInstructions, subagents }) {
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
  log({ kind: 'open', role, model: settings.roles[role], cwd, subagents: (subagents ?? []).map(s => s.defaultModelId), instructions: hostInstructions.slice(0, 40) })
  return {
    runtime: { session: { subscribe: () => () => {}, state: { get: () => ({}) } } },
    snapshot: () => ({ spentNano: 0 }),
    async run({ prompt }) {
      const step = script[turn++] ?? {}
      log({ kind: 'run', role, prompt: prompt.slice(0, 80) })
      for (const [path, text] of Object.entries(step.files ?? {})) {
        mkdirSync(dirname(join(cwd, path)), { recursive: true })
        writeFileSync(join(cwd, path), text)
      }
      return { threadId: `thread-${turn}`, result: { status: 'completed' }, account: { spentNano: 0 } }
    },
    async close() {},
  }
}
