import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureBuilderPlan } from '../builder-boundary.mjs'
import { openRunner } from '../adapter.mjs'

const beamSettings = {
  models: {
    'commandcode/reflection/beam:free': {
      endpoint: 'https://api.commandcode.ai/provider/v1/chat/completions',
      wireModel: 'reflection/beam:free',
      protocol: 'chat',
      maxInputTokens: 1048576,
      maxOutputTokens: 8192,
      price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      source: 'https://commandcode.ai/pricing',
      boundsSource: 'https://commandcode.ai/docs/resources/pricing-limits',
      inputTokenEstimate: { method: 'utf8', multiplier: 2, framingTokens: 4096 },
      inputTokenEstimateSource: 'https://developers.openai.com/api/docs/guides/token-counting',
      route: 'commandcode',
      service: 'CommandCode',
      company: 'reflection',
      wire: 'chat',
    },
  },
  roles: { orchestrator: 'commandcode/reflection/beam:free' },
  providers: [{ name: 'CommandCode', url: 'https://api.commandcode.ai/provider/v1', models: ['reflection/beam:free'], credentialEnv: 'COMMANDCODE_API_KEY' }],
  memory: false,
}

test('the real plan workspace runs on Beam and may write only the plan file', {
  skip: process.env.COMMANDCODE_API_KEY ? false : 'requires the CommandCode credential',
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'builder-plan-live-'))
  const worktree = join(root, 'worktree')
  const builderHome = join(worktree, '.builder-home')
  const jobDir = join(root, 'job')
  try {
    await mkdir(join(builderHome, 'pstack'), { recursive: true })
    await mkdir(jobDir)
    const settingsPath = join(root, 'settings.json')
    await writeFile(settingsPath, JSON.stringify({ ...beamSettings, ledgerPath: join(root, 'ledger.sqlite'), authPath: join(root, 'auth.json') }))
    const runner = await openRunner({
      card: 'JUL-999',
      settingsPath,
      cwd: worktree,
      stateDir: join(root, 'state'),
      role: 'orchestrator',
      planOnly: true,
    })
    try {
      const receipt = await captureBuilderPlan({
        runner,
        builderHome,
        jobDir,
        card: { identifier: 'JUL-999', description: 'Create PRACTICE.txt with one exact line.' },
        events: [],
        status: async () => '',
      })
      assert.equal(receipt.result.status, 'completed')
      const plan = await readFile(join(jobDir, 'pstack-plan.md'), 'utf8')
      assert.match(plan, /^Files\b/im)
      assert.match(plan, /^Steps\b/im)
      const filesystem = runner.workspace.filesystem
      await assert.rejects(() => filesystem.writeFile('pstack/other.txt', 'nope'), /may write only pstack\/plan\.md/)
      await filesystem.writeFile('pstack/plan.md', 'Files\n- PRACTICE.txt\n\nSteps\n1. Write it.\n')
      assert.equal(await readFile(join(builderHome, 'pstack', 'plan.md'), 'utf8'), 'Files\n- PRACTICE.txt\n\nSteps\n1. Write it.\n')
    } finally {
      await runner.close()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('planning accepts markdown section headings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'builder-plan-headings-'))
  const worktree = join(root, 'worktree')
  const builderHome = join(worktree, '.builder-home')
  const jobDir = join(root, 'job')
  try {
    await mkdir(join(builderHome, 'pstack'), { recursive: true })
    await mkdir(jobDir)
    const runner = {
      run: async () => ({
        result: { status: 'completed', text: '## Files\n\n- `marker.txt`\n\n## Steps\n\n1. Write the exact line.\n' },
        threadId: 'plan-headings',
      }),
    }
    await captureBuilderPlan({
      runner,
      builderHome,
      jobDir,
      card: { identifier: 'JUL-262', description: 'Create marker.txt with one exact line.' },
      events: [],
      status: async () => '',
    })
    assert.match(await readFile(join(jobDir, 'pstack-plan.md'), 'utf8'), /^## Files/m)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('planning accepts a plan within the short-plan bound', async () => {
  const root = await mkdtemp(join(tmpdir(), 'builder-plan-size-'))
  const worktree = join(root, 'worktree')
  const builderHome = join(worktree, '.builder-home')
  const jobDir = join(root, 'job')
  try {
    await mkdir(join(builderHome, 'pstack'), { recursive: true })
    await mkdir(jobDir)
    const body = `${'Files\n' + '- `marker.txt`: exact content and one newline.\n'.repeat(34)}\nSteps\n1. Write the exact line.\n`
    assert.ok(Buffer.byteLength(body) > 1500 && Buffer.byteLength(body) <= 4000)
    const runner = { run: async () => ({ result: { status: 'completed', text: body }, threadId: 'plan-size' }) }
    await captureBuilderPlan({
      runner,
      builderHome,
      jobDir,
      card: { identifier: 'JUL-262', description: 'Create marker.txt with one exact line.' },
      events: [],
      status: async () => '',
    })
    assert.equal(await readFile(join(jobDir, 'pstack-plan.md'), 'utf8'), `${body.trim()}\n`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an oversized plan is rejected and retained for diagnosis', async () => {
  const root = await mkdtemp(join(tmpdir(), 'builder-plan-oversized-'))
  const worktree = join(root, 'worktree')
  const builderHome = join(worktree, '.builder-home')
  const jobDir = join(root, 'job')
  try {
    await mkdir(join(builderHome, 'pstack'), { recursive: true })
    await mkdir(jobDir)
    const body = `Files\n${'x'.repeat(4200)}\nSteps\n1. Work.`
    const runner = { run: async () => ({ result: { status: 'completed', text: body }, threadId: 'plan-big' }) }
    await assert.rejects(captureBuilderPlan({ runner, builderHome, jobDir, card: { identifier: 'JUL-262', description: 'one line' }, events: [], status: async () => '' }), /plan.*short/i)
    assert.match(await readFile(join(jobDir, 'pstack-plan-rejected.md'), 'utf8'), /^Files/m)
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

test('planning accepts a tool the runtime refused before it ran', async () => {
  const root = await mkdtemp(join(tmpdir(), 'builder-plan-refused-'))
  const builderHome = join(root, 'worktree', '.builder-home')
  const jobDir = join(root, 'job')
  const events = []
  try {
    await mkdir(jobDir, { recursive: true })
    const runner = {
      run: async () => {
        events.push({ type: 'tool_start', toolCallId: 'call-1', toolName: 'mastra_workspace_list_files', args: { path: '.' } })
        events.push({ type: 'tool_end', toolCallId: 'call-1', isError: true, result: 'Tool "mastra_workspace_list_files" not found. Available tools: none' })
        return { result: { status: 'completed', text: 'Files\n- PRACTICE.txt\n\nSteps\n1. Write it.' }, threadId: 'refused-thread' }
      },
    }
    await captureBuilderPlan({ runner, builderHome, jobDir, card: { identifier: 'JUL-263' }, events, status: async () => '' })
    assert.match(await readFile(join(jobDir, 'pstack-plan.md'), 'utf8'), /^Files/m)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('planning rejects a tool call that actually ran', async () => {
  const root = await mkdtemp(join(tmpdir(), 'builder-plan-ran-'))
  const builderHome = join(root, 'worktree', '.builder-home')
  const jobDir = join(root, 'job')
  const events = []
  try {
    await mkdir(jobDir, { recursive: true })
    const runner = {
      run: async () => {
        events.push({ type: 'tool_start', toolCallId: 'call-2', toolName: 'mastra_workspace_read_file', args: { path: 'README.md' } })
        events.push({ type: 'tool_end', toolCallId: 'call-2', isError: false, result: 'hello' })
        return { result: { status: 'completed', text: 'Files\n- PRACTICE.txt\n\nSteps\n1. Write it.' }, threadId: 'ran-thread' }
      },
    }
    await assert.rejects(captureBuilderPlan({ runner, builderHome, jobDir, card: { identifier: 'JUL-263' }, events, status: async () => '' }), /exposed a tool/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('planning rejects a subagent even when no tool ran', async () => {
  const root = await mkdtemp(join(tmpdir(), 'builder-plan-subagent-'))
  const builderHome = join(root, 'worktree', '.builder-home')
  const jobDir = join(root, 'job')
  const events = []
  try {
    await mkdir(jobDir, { recursive: true })
    const runner = {
      run: async () => {
        events.push({ type: 'subagent_start', toolCallId: 'call-3', modelId: 'reflection/beam:free', task: 'read files' })
        return { result: { status: 'completed', text: 'Files\n- PRACTICE.txt\n\nSteps\n1. Write it.' }, threadId: 'subagent-thread' }
      },
    }
    await assert.rejects(captureBuilderPlan({ runner, builderHome, jobDir, card: { identifier: 'JUL-263' }, events, status: async () => '' }), /exposed a tool/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('planning retries a malformed plan once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'builder-plan-retry-'))
  const builderHome = join(root, 'worktree', '.builder-home')
  const jobDir = join(root, 'job')
  try {
    await mkdir(jobDir, { recursive: true })
    let calls = 0
    const runner = {
      run: async () => {
        calls += 1
        if (calls === 1) return { result: { status: 'completed', text: 'I will create the marker.' }, threadId: 'bad-shape' }
        return { result: { status: 'completed', text: 'Files\n- PRACTICE.txt\n\nSteps\n1. Write it.' }, threadId: 'good-shape' }
      },
    }
    await captureBuilderPlan({ runner, builderHome, jobDir, card: { identifier: 'JUL-263' }, events: [], status: async () => '' })
    assert.equal(calls, 2)
    assert.match(await readFile(join(jobDir, 'pstack-plan.md'), 'utf8'), /^Files/m)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('planning fails if the model changes repository files or writes an oversized plan', async () => {
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
