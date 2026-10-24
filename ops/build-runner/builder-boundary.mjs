import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_PLAN_BYTES = 1500

export async function captureBuilderPlan({ runner, builderHome, jobDir, card, status, events }) {
  await mkdir(join(builderHome, 'pstack'), { recursive: true })
  const eventOffset = events.length
  const receipt = await runner.run({
    prompt: `Return only a short plan for this saved card. Start one section with "Files" and one with "Steps". Name every file and the ordered steps.\n\nSaved card:\n${JSON.stringify(card, null, 2)}`,
    maxTurns: 2,
    timeoutMs: 300_000,
  })
  if (receipt?.result?.status !== 'completed') throw new Error('planning session not completed')
  const starts = events.slice(eventOffset).filter(event => ['subagent_start', 'subagent_tool_start', 'tool_start'].includes(event.type))
  if (starts.length) throw new Error('planning turn exposed a tool')
  const plan = `${receipt.result.text?.trim() ?? ''}\n`
  const after = await status()
  if (after.trim()) throw new Error('planning turn changed repository files')
  if (Buffer.byteLength(plan) > MAX_PLAN_BYTES || !/^Files\b/im.test(plan) || !/^Steps\b/im.test(plan)) {
    throw new Error('builder plan must be short and name files and steps')
  }
  await writeFile(join(builderHome, 'pstack', 'plan.md'), plan)
  await writeFile(join(jobDir, 'pstack-plan.md'), plan)
  return receipt
}
