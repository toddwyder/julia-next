import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire('/home/ubuntu/julia-jul-253/ops/mastra-agents/reviewer/package.json')
const { chromium } = require('playwright')
const evidence = new URL('.', import.meta.url).pathname
const url = 'https://ovh.tail91f394.ts.net/julia-control'
const cardId = 'JUL-261'
const model = 'commandcode::deepseek/deepseek-v4.1-flash'

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1365, height: 1100 } })
const page = await context.newPage()
const consoleEntries = []
const pageErrors = []
const network = []
page.on('console', m => consoleEntries.push({ type: m.type(), text: m.text() }))
page.on('pageerror', e => pageErrors.push(String(e)))
page.on('response', r => {
  if (r.url().startsWith(url)) network.push({ url: r.url(), method: r.request().method(), status: r.status() })
})

try {
  await page.goto(url, { waitUntil: 'networkidle' })
  const stateResponse = await context.request.get(url + '/api/state')
  assert.equal(stateResponse.ok(), true)
  const state = await stateResponse.json()
  const index = state.cards.findIndex(entry => entry.card.identifier === cardId && entry.admitted)
  assert.ok(index >= 0, `${cardId} is not admitted`)

  await page.locator('select[name="card"]').selectOption(String(index))
  for (const label of ['Orchestrator', 'Coder']) {
    const field = page.locator('fieldset').filter({ has: page.locator('legend', { hasText: label }) })
    await field.locator('select').first().selectOption(model)
    await field.locator('select').nth(1).selectOption('medium')
  }
  await page.screenshot({ path: evidence + 'start-selected.png', fullPage: true })

  const waiting = page.waitForResponse(
    r => r.request().method() === 'POST' && r.url() === url + '/api/start',
    { timeout: 60_000 },
  )
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  const response = await waiting
  const body = await response.json()
  await writeFile(evidence + 'start-response.json', JSON.stringify({ url: response.url(), status: response.status(), body }, null, 2))
  assert.equal(response.status(), 200)
  assert.equal(body.build.state, 'running')
  assert.equal(body.snapshot.card.identifier, cardId)
  assert.equal(body.snapshot.roles.orchestrator.route, 'commandcode')
  assert.equal(body.snapshot.roles.orchestrator.modelId, 'deepseek/deepseek-v4.1-flash')
  assert.equal(body.snapshot.roles.coder.route, 'commandcode')
  assert.equal(body.snapshot.roles.coder.modelId, 'deepseek/deepseek-v4.1-flash')
  await page.screenshot({ path: evidence + 'start-running.png', fullPage: true })

  const started = Date.now()
  let job
  while (Date.now() - started < 20 * 60_000) {
    const statusResponse = await context.request.get(url + '/api/builds')
    const jobs = await statusResponse.json()
    job = jobs.find(item => item.runId === body.runId)
    if (job && (job.state === 'failed' || job.state === 'ready-for-review')) break
    await new Promise(resolve => setTimeout(resolve, 5000))
  }
  await writeFile(evidence + 'final-job.json', JSON.stringify(job ?? null, null, 2))
  console.log(JSON.stringify({
    runId: body.runId,
    baseCommit: body.build.baseCommit,
    worktree: body.build.worktree,
    roles: body.snapshot.roles,
    finalState: job?.state ?? 'timeout',
    error: job?.error?.message ?? null,
    candidateCommit: job?.result?.candidateCommit ?? null,
    spentNano: job?.result?.account?.spentNano ?? null,
  }))
} finally {
  await writeFile(evidence + 'start-browser.json', JSON.stringify({ url, consoleEntries, pageErrors, network }, null, 2))
  await context.close()
  await browser.close()
}
