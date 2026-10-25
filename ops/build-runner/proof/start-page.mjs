import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../mastra-agents/reviewer/package.json', import.meta.url))
const { chromium } = require('playwright')

const [baseURL, outputDir] = process.argv.slice(2)
if (!baseURL || !outputDir) throw Error('usage: start-page.mjs <control-url> <output-dir>')
await mkdir(outputDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 1200 } })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  await page.goto(baseURL, { waitUntil: 'networkidle' })
  await page.locator('select[name="card"]').waitFor({ timeout: 30000 })
  const orchestrator = page.locator('fieldset').filter({ has: page.locator('legend', { hasText: 'Orchestrator' }) }).locator('select').first()
  await orchestrator.waitFor({ timeout: 30000 })
  const options = await orchestrator.locator('option').allTextContents()
  const services = [...new Set(options.map(option => option.split(' · ')[0]))].sort()
  assert.deepEqual(services, ['ChatGPT plan', 'Claude subscription', 'CommandCode'])

  await orchestrator.evaluate(select => { select.size = select.options.length })
  await page.waitForTimeout(250)
  const screenshot = join(outputDir, 'start-page-tailscale.png')
  const form = page.locator('#app')
  await form.scrollIntoViewIfNeeded()
  await form.screenshot({ path: screenshot })
  const evidence = {
    url: baseURL,
    capturedAt: new Date().toISOString(),
    optionCount: options.length,
    services,
    perService: Object.fromEntries(services.map(service => [service, options.filter(option => option.startsWith(`${service} · `)).length])),
    sample: Object.fromEntries(services.map(service => [service, options.filter(option => option.startsWith(`${service} · `)).slice(0, 3)])),
    screenshot,
    consoleErrors,
  }
  await writeFile(join(outputDir, 'start-page-tailscale.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await browser.close()
}
