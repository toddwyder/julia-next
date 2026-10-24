import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_PLAN_BYTES = 4000
const sectionHeading = name => new RegExp(`^(?:#{1,6}[ \\t]*)?(?:\\*\\*)?${name}(?:\\*\\*)?[ \\t]*:?[ \\t]*$`, 'im')

function refusedBeforeRunning(event, turn) {
  if (event.type === 'subagent_start') return false
  const end = turn.find(candidate => candidate.toolCallId === event.toolCallId && ['tool_end', 'subagent_tool_end'].includes(candidate.type))
  return end?.isError === true && /^Tool "[^"]+" not found\./.test(String(end.result ?? ''))
}

export async function captureBuilderPlan({ runner, builderHome, jobDir, card, status, events }) {
  await mkdir(join(builderHome, 'pstack'), { recursive: true })
  let rejected = ''
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const eventOffset = events.length
    const receipt = await runner.run({
      prompt: `Return only a short plan for this saved card. Start one section with "Files" and one with "Steps". Name every file and the ordered steps.\n\nSaved card:\n${JSON.stringify(card, null, 2)}`,
      maxTurns: 2,
      timeoutMs: 300_000,
    })
    if (receipt?.result?.status !== 'completed') throw new Error('planning session not completed')
    const turn = events.slice(eventOffset)
    const starts = turn.filter(event => ['subagent_start', 'subagent_tool_start', 'tool_start'].includes(event.type))
    if (starts.some(event => !refusedBeforeRunning(event, turn))) throw new Error('planning turn exposed a tool')
    const plan = `${receipt.result.text?.trim() ?? ''}\n`
    const after = await status()
    if (after.trim()) throw new Error('planning turn changed repository files')
    if (Buffer.byteLength(plan) <= MAX_PLAN_BYTES && sectionHeading('Files').test(plan) && sectionHeading('Steps').test(plan)) {
      await writeFile(join(builderHome, 'pstack', 'plan.md'), plan)
      await writeFile(join(jobDir, 'pstack-plan.md'), plan)
      return receipt
    }
    rejected = plan
  }
  await writeFile(join(jobDir, 'pstack-plan-rejected.md'), rejected)
  throw new Error('builder plan must be short and name files and steps')
}
