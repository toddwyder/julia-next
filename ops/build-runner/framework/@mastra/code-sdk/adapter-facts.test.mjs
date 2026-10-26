// @mastra/code-sdk@1.14.0 / @mastra/core@1.78.0 adapter learning tests.
// Citations: code-sdk/dist/index.d.ts:37-38,61 (subagents, disableBuiltinTools);
// code-sdk/dist/onboarding/settings.d.ts:218,264,275,277 (subagentModels,
// thinkingLevel); code-sdk/dist/schema.d.ts:30-31,100,164-166 (state keys);
// @mastra/core/dist/agent-controller/types.d.ts:117-140,179 (subagent definition,
// builtin tool ids); tools.d.ts:62-71 (subagent tool input);
// session.d.ts:1112-1149 (session subagent model, no effort surface);
// code-sdk/dist/agents/prompts/agent-instructions.js:11-22,150-156,188-201,213-216
// (one project file loads: root AGENTS.md before .mastracode/AGENTS.md).
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { owner, sdk } from './framework-runtime.mjs'
import { withNative } from './native-facts.mjs'

const repoRoot = resolve(import.meta.dirname, '../../../../..')

test('a subagent model is set per agent type and wins over the global default', async () => {
  await withNative(async ({ runtime }) => {
    const session = runtime.session
    const perType = 'commandcode/deepseek/deepseek-v4.1-flash'
    const global = 'anthropic/claude-opus-5-5'
    await session.subagents.model.set({ agentType: 'explore', modelId: perType })
    assert.equal(session.subagents.model.get({ agentType: 'explore' }), perType)
    assert.equal(session.subagents.model.get(), null)
    await session.subagents.model.set({ modelId: global })
    assert.equal(session.subagents.model.get({ agentType: 'explore' }), perType)
    assert.equal(session.subagents.model.get({ agentType: 'plan' }), global)
    assert.equal(session.subagents.model.get(), global)
    const settings = (await sdk('onboarding/settings.js')).loadSettings()
    assert.deepEqual(settings.models.subagentModels, {})
    console.log(JSON.stringify({ fact: 'model-per-subagent', perType, global }))
  })
})

test('reasoning effort has no per-subagent surface; it is session-scoped only', async () => {
  await withNative(async ({ runtime }) => {
    const session = runtime.session
    assert.deepEqual(Object.keys(session.subagents), ['model'])
    assert.equal(typeof session.model.switch, 'function')
    const { stateSchema } = await sdk('schema.js')
    assert.equal(stateSchema.parse({ thinkingLevel: 'high' }).thinkingLevel, 'high')
    assert.equal(runtime.controller.getToolCategory({ toolName: 'subagent' }), 'edit')
    const tools = readFileSync(join(owner, 'node_modules/@mastra/core/dist/agent-controller/tools.d.ts'), 'utf8')
    const subagentTool = tools.slice(tools.indexOf('export declare function createSubagentTool'), tools.indexOf('export declare function parseSubagentMeta'))
    for (const field of ['agentType', 'task', 'modelId', 'forked']) assert.match(subagentTool, new RegExp(`\\b${field}\\b`))
    assert.doesNotMatch(subagentTool, /thinkingLevel|\beffort\b|reasoning/)
    console.log(JSON.stringify({ fact: 'reasoning-effort-per-subagent', supported: false, sessionScoped: true }))
  })
})

test('Mastra Code loads the first project instruction file, so the root AGENTS.md carries the adapter', async () => {
  const { loadSessionInstructions } = await sdk('agents/prompts/agent-instructions.js')
  const directory = await mkdtemp(join(tmpdir(), 'adapter-instructions-'))
  try {
    await mkdir(join(directory, '.mastracode'), { recursive: true })
    await writeFile(join(directory, 'AGENTS.md'), '# root rules\n')
    await writeFile(join(directory, '.mastracode/AGENTS.md'), '# shadowed rules\n')
    const sources = loadSessionInstructions({ workingDir: directory, configDir: '.mastracode', skipGlobal: true })
    assert.deepEqual(sources.map(source => source.scope), ['project'])
    assert.deepEqual(sources.map(source => source.path), [join(directory, 'AGENTS.md')])
    await rm(join(directory, 'AGENTS.md'))
    const nested = loadSessionInstructions({ workingDir: directory, configDir: '.mastracode', skipGlobal: true })
    assert.deepEqual(nested.map(source => source.path), [join(directory, '.mastracode/AGENTS.md')])
  } finally { await rm(directory, { recursive: true, force: true }) }

  const loaded = loadSessionInstructions({ workingDir: repoRoot, configDir: '.mastracode', skipGlobal: true })
  assert.deepEqual(loaded.map(entry => entry.path), [join(repoRoot, 'AGENTS.md')])
  assert.match(loaded[0].content, /docs\/harness\/mastra-code\.md/)
  assert.match(loaded[0].content, /pstack models file/)
  assert.match(readFileSync(join(repoRoot, 'docs/harness/mastra-code.md'), 'utf8'), /# pstack in Mastra Code/)
  console.log(JSON.stringify({ fact: 'settings-file-loading', instruction: 'AGENTS.md', sources: loaded.map(entry => entry.path) }))
})
