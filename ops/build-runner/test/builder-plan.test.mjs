import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureBuilderPlan } from '../builder-boundary.mjs'

test('the first Sol turn writes and retains a short plan before implementation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'builder-plan-'))
  const worktree = join(root, 'worktree')
  const builderHome = join(worktree, '.builder-home')
  const jobDir = join(root, 'job')
  const calls = []
  const events = []
  try {
    await mkdir(join(builderHome, 'pstack'), { recursive: true })
    await mkdir(jobDir)
    const runner = {
      run: async options => {
        calls.push(options)
        return { result: { status: 'completed', text: 'Files\n- PRACTICE.txt\n\nSteps\n1. Write the exact requested bytes.\n2. Verify the file and diff.' }, threadId: 'plan-thread', account: { costNano: 1 } }
      },
    }
    const receipt = await captureBuilderPlan({
      runner,
      builderHome,
      jobDir,
      card: { identifier: 'JUL-256', description: 'Create PRACTICE.txt with exact bytes.' },
      events,
      status: async () => '',
    })
    assert.equal(calls.length, 1)
    assert.match(calls[0].prompt, /files.*steps/is)
    assert.doesNotMatch(calls[0].prompt, /implement|edit the repository/i)
    assert.equal(calls[0].maxTurns, 2)
    assert.equal(receipt.threadId, 'plan-thread')
    assert.equal(await readFile(join(jobDir, 'pstack-plan.md'), 'utf8'), await readFile(join(builderHome, 'pstack', 'plan.md'), 'utf8'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('planning rejects any exposed tool before the plan', async () => {
  const root = await mkdtemp(join(tmpdir(), 'builder-plan-tools-'))
  const builderHome = join(root, 'worktree', '.builder-home')
  const jobDir = join(root, 'job')
  const events = []
  try {
    await mkdir(jobDir, { recursive: true })
    const runner = {
      run: async () => {
        events.push({ type: 'tool_start', toolName: 'mastra_workspace_read_file', args: { path: 'README.md' } })
        return { result: { status: 'completed', text: 'Files\n- PRACTICE.txt\n\nSteps\n1. Write it.' }, threadId: 'research-thread' }
      },
    }
    await assert.rejects(captureBuilderPlan({ runner, builderHome, jobDir, card: { identifier: 'JUL-256' }, events, status: async () => '' }), /exposed a tool/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('planning fails if Sol changes repository files or writes an oversized plan', async () => {
  const root = await mkdtemp(join(tmpdir(), 'builder-plan-invalid-'))
  const worktree = join(root, 'worktree')
  const builderHome = join(worktree, '.builder-home')
  const jobDir = join(root, 'job')
  const events = []
  try {
    await mkdir(join(builderHome, 'pstack'), { recursive: true })
    await mkdir(jobDir)
    const runner = {
      run: async () => {
        return { result: { status: 'completed', text: `Files\n${'x'.repeat(2000)}\nSteps\n1. Work.` }, threadId: 'bad-plan' }
      },
    }
    await assert.rejects(captureBuilderPlan({ runner, builderHome, jobDir, card: { identifier: 'JUL-256', description: 'one line' }, events, status: async () => ' M source.mjs\n' }), /planning turn changed|plan.*short/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
