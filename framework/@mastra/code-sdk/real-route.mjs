// @mastra/code-sdk@1.14.0 learning-test plumbing, not a production adapter.
// Interfaces: installed public declarations; dist/index.d.ts:28-130,293;
// dist/headless/types.d.ts:44-113; dist/onboarding/settings.d.ts:19-26,189-245.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
export const owner = resolve(process.env.FRAMEWORK_RUNNER_ROOT ?? 'ops/build-runner')
export const ownerRequire = createRequire(join(owner, 'package.json'))
export const sdkDirectory = resolve(ownerRequire.resolve('@mastra/code-sdk/package.json'), '..')
const pkg = JSON.parse(await readFile(join(sdkDirectory, 'package.json'), 'utf8'))
const lock = JSON.parse(await readFile(process.env.FRAMEWORK_LOCKFILE ?? join(owner, 'package-lock.json'), 'utf8'))
assert.equal(pkg.version, '1.14.0')
assert.equal(lock.packages['node_modules/@mastra/code-sdk'].version, '1.14.0')
export const sdk = subpath => {
  const key = subpath === 'index.js' ? '.' : `./${subpath.replace(/\.js$/, '')}`
  const entry = pkg.exports[key] ?? pkg.exports['./*']
  assert.ok(entry?.import?.default, `public SDK export missing: ${key}`)
  return import(pathToFileURL(join(sdkDirectory, entry.import.default.replace('*', key.slice(2)))))
}
export const freeModels = ['ornith/ornith-1.5-122b']
export const upstream = 'https://api.commandcode.ai/provider/v1'
export const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
export async function forwardFreeRequest(originalFetch, input, init, payload, requests) {
  const url = String(input instanceof Request ? input.url : input)
  const record = { requestSha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex'), at: new Date().toISOString(), bytes: Buffer.byteLength(JSON.stringify(payload)), url, model: payload.model, messages: payload.messages.map(m => ({ role: m.role, content: m.role === 'tool' ? m.content : typeof m.content, ...(m.tool_calls ? { toolCalls: m.tool_calls.map(c => ({ name: c.function?.name, arguments: c.function?.arguments })) } : {}) })) }
  Object.defineProperty(record, 'includesText', { value: text => JSON.stringify(payload.messages).includes(text) })
  requests.push(record)
  const attempt = { at: new Date().toISOString() }
  record.attempts = [attempt]
  try {
    const response = await originalFetch(input, init)
    record.status = attempt.status = response.status
    return response
  } catch (error) {
    const detail = String(error?.message ?? error)
    attempt.error = process.env.COMMANDCODE_API_KEY ? detail.replaceAll(process.env.COMMANDCODE_API_KEY, '[REDACTED]') : detail
    throw error
  } finally {
    console.log(JSON.stringify({ fact: 'free-provider-attempt', url, ...attempt, requestSha256: record.requestSha256, bytes: record.bytes, model: payload.model }))
  }
}
export async function withProbe(model, setup, body, bootOptions = {}) {
  assert.ok(freeModels.includes(model), 'only the authorized machinery model may run')
  assert.ok(process.env.COMMANDCODE_API_KEY, 'provider unavailable: COMMANDCODE_API_KEY required')
  const directory = await mkdtemp(join(tmpdir(), 'framework-runner-learning-'))
  const previous = process.env.MASTRA_APP_DATA_DIR
  process.env.MASTRA_APP_DATA_DIR = directory
  const originalFetch = globalThis.fetch
  const requests = []
  let onProviderResponse=()=>{}
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    if (!/chat\/completions|\/responses|\/messages/.test(url)) return originalFetch(input, init)
    assert.equal(url, `${upstream}/chat/completions`, 'alternate inference refused')
    const payload = JSON.parse(init?.body ?? await input.clone().text())
    assert.equal(payload.model, model, 'paid or different inference refused')
    const response=await forwardFreeRequest(originalFetch, input, init, payload, requests)
    onProviderResponse(requests.at(-1))
    return response
  }
  let runtime
  const {setCustomProvidersSource}=await sdk('agents/custom-provider-source.js')
  try {
    const { loadSettings, saveSettings } = await sdk('onboarding/settings.js')
    const { upsertCustomProviderInSettings } = await sdk('onboarding/custom-providers.js')
    const settings = loadSettings()
    upsertCustomProviderInSettings(settings, { name: 'CommandCode Free', url: upstream, models: freeModels })
    setCustomProvidersSource(()=>[{name:'CommandCode Free',url:upstream,apiKey:process.env.COMMANDCODE_API_KEY,models:freeModels}])
    settings.models.activeOmPackId = null
    settings.models.omModelOverride = `commandcode-free/${model}`
    saveSettings(settings)
    await setup(directory)
    const { bootLocalAgentController, runMC } = await sdk('index.js')
    runtime = await bootLocalAgentController({ cwd: directory, homeDir: directory, ...bootOptions })
    await body({ directory, runtime, runMC, model, savedModel: `commandcode-free/${model}`, requests, onProviderResponse: callback=>{onProviderResponse=callback} })
  } finally {
    if (runtime) { await runtime.controller.destroy(); await runtime.observability.shutdown() }
    setCustomProvidersSource(undefined)
    globalThis.fetch = originalFetch
    if (previous === undefined) delete process.env.MASTRA_APP_DATA_DIR
    else process.env.MASTRA_APP_DATA_DIR = previous
    await rm(directory, { recursive: true, force: true })
  }
}
export async function prompt(ctx, text, { stopAfterTool = false, stopAfterToolResult = null, onEvent = () => {}, returnErrors = false } = {}) {
  const { runtime, runMC, savedModel } = ctx
  const thread = await runtime.session.thread.create({ title: 'Runner learning' })
  await runtime.session.model.switch(savedModel)
  const stop = new AbortController()
  const events = []
  ctx.onProviderResponse(record=>{
    if(stopAfterToolResult && record.status===200 && record.messages.some(m=>m.role==='tool' && (JSON.stringify(m.content)??'').includes(stopAfterToolResult)))stop.abort()
  })
  const unsubscribe = runtime.session.subscribe(event => {
    events.push(event)
    onEvent(event)
    if (stopAfterTool && event.type === 'tool_end') stop.abort()
  })
  try {
    const result = await runMC({ controller: runtime.controller, session: runtime.session, thread: { id: thread.id }, prompt: text, signal: stop.signal, timeoutMs: 150000, maxTurns: 6 }).result
    console.log(JSON.stringify({ model: ctx.model, prompt: text, result, requests: ctx.requests }).replaceAll(process.env.COMMANDCODE_API_KEY,'[REDACTED:COMMANDCODE_API_KEY]'))
    if (result.status === 'error' && !returnErrors) throw new Error(result.error?.message ?? 'provider unavailable or SDK error')
    return { result, events, thread }
  } finally { unsubscribe() }
}
