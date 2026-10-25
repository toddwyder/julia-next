import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(resolve('ops/mastra-agents/reviewer/package.json'))
const { chromium } = require('playwright')

const baseURL = process.argv[2] ?? 'https://ovh.tail91f394.ts.net/julia-control'
const outputDir = process.argv[3] ?? 'docs/agents/jul-252/proof/rerun-2026-10-25'
await mkdir(outputDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 1500 } })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', error => consoleErrors.push(String(error)))
  await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 60000 })
  const buildCard = page.locator('#live-builds article.build-card').filter({ hasText: 'JUL-252' }).first()
  await buildCard.waitFor({ timeout: 60000 })
  await page.locator('[data-testid="live-checklist"]').first().waitFor({ timeout: 60000 })
  const heading = await buildCard.locator('h3').textContent()
  const items = await page.locator('[data-testid="live-checklist-item"]').evaluateAll(nodes => nodes.map(node => ({ status: node.getAttribute('data-status'), text: node.textContent })))
  const summary = await page.locator('[data-testid="live-checklist"] .checklist-summary').first().textContent().catch(() => null)
  const dashboard = page.locator('main > section.dashboard').first()
  await dashboard.scrollIntoViewIfNeeded()
  const screenshot = join(outputDir, 'dashboard-jul-252-latest.png')
  await dashboard.screenshot({ path: screenshot })
  const cardScreenshot = join(outputDir, 'jul-252-build-card-latest.png')
  await buildCard.screenshot({ path: cardScreenshot })
  const evidence = { capturedAt: new Date().toISOString(), heading, summary, items, screenshot, cardScreenshot, consoleErrors }
  await writeFile(join(outputDir, 'dashboard-latest.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await browser.close()
}
