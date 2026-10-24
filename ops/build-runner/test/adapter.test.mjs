import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

test('stock adapter request works while direct and nested builder commands cannot read credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jul251-adapter-'))
  const cwd = join(directory, 'workspace')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(cwd)
  let arrivals = 0
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks))
    assert.equal(req.headers.authorization, 'Bearer synthetic-secret-marker')
    arrivals++
    if (arrivals === 1) {
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'fixture retry', type: 'server_error' } }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content: 'JUL251_OK' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 } })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/v1`
  const settingsPath = join(directory, 'settings.json')
  const secretFile = join(directory, 'private-auth.json')
  await writeFile(secretFile, 'synthetic-secret-marker')
  await writeFile(settingsPath, JSON.stringify({
    roles: { builder: 'local-fixture/fixture' }, memory: false,
    providers: [{ name: 'Local Fixture', url, models: ['fixture'], credentialEnv: 'PROOF_API_KEY' }],
    models: { 'local-fixture/fixture': { endpoint: url + '/chat/completions', wireModel: 'fixture', protocol: 'chat', maxInputTokens: 100000, maxOutputTokens: 128, price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } },
  }))
  const input = join(directory, 'input.json')
  await writeFile(input, JSON.stringify({ card: 'JUL-251', cwd, stateDir: join(directory, 'state'), settingsPath, secretFile, minimumAttempts: 2 }))
  try {
    const child = spawn(process.execPath, ['ops/build-runner/test/adapter-driver.mjs', input], { env: { ...process.env, PROOF_API_KEY: 'synthetic-secret-marker' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data })
    const code = await new Promise(resolve => child.on('close', resolve))
    assert.equal(code, 0, output)
    assert.equal(arrivals, 2, 'stock SDK retry must make a second guarded attempt')
    assert.match(output, /nested.*isolated/)
    console.log(output)
  } finally { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }) }
})

test('a second runner in one worker process still sees the provider credential', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jul262-sequential-'))
  const cwd = join(directory, 'workspace')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(cwd)
  const url = 'http://127.0.0.1:1/v1'
  const settingsPath = join(directory, 'settings.json')
  await writeFile(settingsPath, JSON.stringify({
    roles: { builder: 'local-fixture/fixture' }, memory: false,
    providers: [{ name: 'Local Fixture', url, models: ['fixture'], credentialEnv: 'PROOF_API_KEY' }],
    models: { 'local-fixture/fixture': { endpoint: url + '/chat/completions', wireModel: 'fixture', protocol: 'chat', maxInputTokens: 100000, maxOutputTokens: 128, price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } },
  }))
  try {
    const child = spawn(process.execPath, ['ops/build-runner/test/sequential-runner-driver.mjs', settingsPath, cwd, join(directory, 'state')], { env: { ...process.env, PROOF_API_KEY: 'synthetic-secret-marker' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data })
    const code = await new Promise(resolve => child.on('close', resolve))
    assert.equal(code, 0, output)
    assert.match(output, /sequential runners ok/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
