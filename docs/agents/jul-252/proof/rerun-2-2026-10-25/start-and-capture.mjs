import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(resolve('ops/mastra-agents/reviewer/package.json'))
const { chromium } = require('playwright')

const baseURL = process.argv[2] ?? 'https://ovh.tail91f394.ts.net/julia-control'
const outputDir = process.argv[3] ?? 'docs/agents/jul-252/proof/rerun-2-2026-10-25'
await mkdir(outputDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 1500 } })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', error => consoleErrors.push(String(error)))

  await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 60000 })
  await page.locator('select[name="card"]').waitFor({ timeout: 60000 })

  const cards = await page.locator('select[name="card"] option').evaluateAll(options => options.map(option => ({ value: option.value, text: option.textContent })))
  const card = cards.find(entry => entry.text.includes('JUL-252'))
  assert.ok(card, 'JUL-252 is not offered by the Start page')
  await page.selectOption('select[name="card"]', card.value)

  const fieldset = legend => page.locator('fieldset').filter({ has: page.locator('legend', { hasText: legend }) })
  const roleSelect = legend => fieldset(legend).locator('select').nth(0)
  const effortSelect = legend => fieldset(legend).locator('select').nth(1)

  async function choose(legend, matches) {
    const options = await roleSelect(legend).locator('option').evaluateAll(entries => entries.map(entry => ({ value: entry.value, text: entry.textContent })))
    const option = options.find(matches)
    assert.ok(option, `no ${legend} option matched`)
    await roleSelect(legend).selectOption(option.value)
    await effortSelect(legend).selectOption('medium')
    return option.text
  }

  const orchestrator = await choose('Orchestrator', option => option.text.includes('Claude Opus 5.5'))
  const coder = await choose('Coder', option => option.text.includes('DeepSeek V4.1 Flash') && !option.text.includes('Fast'))

  const start = Date.now()
  await page.getByRole('button', { name: /^Start$/ }).click()
  const heading = page.getByRole('heading', { name: /^JUL-252 · running$/ })
  await heading.waitFor({ timeout: 180000 })

  const buildCard = page.locator('#live-builds article.build-card').first()
  const meta = await buildCard.locator('p').first().textContent()
  const runId = /Run (\S+)/.exec(meta ?? '')?.[1] ?? null

  const itemSelector = '[data-testid="live-checklist-item"]'
  const snapshots = []
  await page.locator(itemSelector).first().waitFor({ timeout: 20 * 60 * 1000 })
  const dashboard = page.locator('main > section.dashboard').first()
  await dashboard.scrollIntoViewIfNeeded()
  const firstScreenshot = join(outputDir, 'dashboard-jul-252-checklist-first.png')
  await dashboard.screenshot({ path: firstScreenshot })
  const finishDeadline = Date.now() + 10 * 60 * 1000
  let finished = false
  while (Date.now() < finishDeadline) {
    const items = await page.locator(itemSelector).evaluateAll(nodes => nodes.map(node => ({ status: node.getAttribute('data-status'), text: node.textContent })))
    const summary = await page.locator('[data-testid="live-checklist"] .checklist-summary').first().textContent().catch(() => null)
    const snapshot = { at: new Date().toISOString(), elapsedMs: Date.now() - start, summary, items }
    if (JSON.stringify(snapshots.at(-1)?.items) !== JSON.stringify(items)) snapshots.push(snapshot)
    finished = items.some(item => item.status === 'finished')
    if (finished) break
    await page.waitForTimeout(2000)
  }

  const screenshot = join(outputDir, 'dashboard-jul-252-running.png')
  await dashboard.screenshot({ path: screenshot })
  const cardScreenshot = join(outputDir, 'jul-252-build-card.png')
  await buildCard.screenshot({ path: cardScreenshot })

  const items = await page.locator(itemSelector).evaluateAll(nodes => nodes.map(node => ({ status: node.getAttribute('data-status'), text: node.textContent })))
  const summary = await page.locator('[data-testid="live-checklist"] .checklist-summary').first().textContent().catch(() => null)
  const evidence = {
    url: baseURL,
    capturedAt: new Date().toISOString(),
    card: card.text,
    orchestrator,
    coder,
    runId,
    heading: await heading.textContent(),
    finished,
    checklist: { summary, items },
    snapshots,
    firstScreenshot,
    screenshot,
    cardScreenshot,
    consoleErrors,
  }
  await writeFile(join(outputDir, 'dashboard.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await browser.close()
}
