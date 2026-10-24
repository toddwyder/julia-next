import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_PLAN_BYTES = 1500

export async function captureBuilderPlan({ runner, builderHome, jobDir, card, status, events }) {
  const planPath = join(builderHome, 'pstack', 'plan.md')
  await mkdir(join(builderHome, 'pstack'), { recursive: true })
  const eventOffset = events.length
  const receipt = await runner.run({
    prompt: `Use the write_file tool once to write a short plan for this saved card to .builder-home/pstack/plan.md. Name the files and the ordered steps. Do not change repository files.\n\nSaved card:\n${JSON.stringify(card, null, 2)}`,
    maxTurns: 6,
    timeoutMs: 300_000,
  })
  if (receipt?.result?.status !== 'completed') throw new Error('planning session not completed')
  const starts = events.slice(eventOffset).filter(event => ['subagent_start', 'subagent_tool_start', 'tool_start'].includes(event.type))
  const write = starts[0]
  const writePath = write?.args?.path ?? write?.subToolArgs?.path
  const writeName = write?.toolName ?? write?.subToolName
  if (starts.length !== 1 || write?.type !== 'tool_start' || !/write_file$/.test(writeName ?? '') || writePath !== '.builder-home/pstack/plan.md') {
    throw new Error('planning turn may only write .builder-home/pstack/plan.md')
  }
  const plan = await readFile(planPath, 'utf8')
  await copyFile(planPath, join(jobDir, 'pstack-plan.md'))
  const after = await status()
  if (after.trim()) throw new Error('planning turn changed repository files')
  if (Buffer.byteLength(plan) > MAX_PLAN_BYTES || !/^Files\b/im.test(plan) || !/^Steps\b/im.test(plan)) {
    throw new Error('builder plan must be short and name files and steps')
  }
  return receipt
}
