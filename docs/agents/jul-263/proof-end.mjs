import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const require = createRequire(fileURLToPath(new URL('../../../ops/mastra-agents/reviewer/package.json', import.meta.url)))
const { chromium } = require('playwright')

const base = process.env.JULIA_CONTROL_URL ?? 'https://ovh.tail91f394.ts.net/julia-control'
const runId = process.env.PROOF_RUN_ID
if (!runId) throw new Error('PROOF_RUN_ID is required')
const outDir = fileURLToPath(new URL(process.env.PROOF_OUT ?? './proof/final/', import.meta.url))
await mkdir(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } })
const consoleEvents = []
const pageErrors = []
page.on('console', message => consoleEvents.push({ type: message.type(), text: message.text() }))
page.on('pageerror', error => pageErrors.push(String(error)))

try {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const card = page.locator('article.build-card').filter({ hasText: runId }).first()
  await card.locator('h3', { hasText: 'ready-for-review' }).waitFor({ timeout: 60000 })
  const pageHeading = (await card.locator('h3').textContent())?.trim() ?? null
  if (!pageHeading.includes('ready-for-review')) throw new Error(`page shows ${pageHeading}`)

  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: join(outDir, 'end.png'), fullPage: true })
  await card.screenshot({ path: join(outDir, 'end-card.png') })

  const jobs = await page.evaluate(async () => {
    const response = await fetch('/julia-control/api/builds')
    return response.json()
  })
  const job = jobs.find(entry => entry.runId === runId)
  if (!job) throw new Error(`job ${runId} not found`)
  await writeFile(join(outDir, 'final-job.json'), JSON.stringify(job, null, 2))

  async function countsBefore(file) {
    let mtime
    try { mtime = (await stat(file)).mtime.toISOString() } catch { return null }
    let selected = null
    for (const line of (await readFile(join(outDir, 'checklist.jsonl'), 'utf8')).split(/\r?\n/).filter(Boolean)) {
      const snapshot = JSON.parse(line)
      if (snapshot.at <= mtime) selected = snapshot
    }
    return selected
  }

  const summary = job.checklist?.summary ?? { finished: 0, skipped: 0, pending: 0 }
  const runningHeading = `${job.snapshot.card.identifier} · running`
  const start = await countsBefore(join(outDir, 'start.png'))
  const middle = await countsBefore(join(outDir, 'middle.png'))
  const shots = {
    'start-selected': { takenAt: null, state: null, runId: null, pageHeading: null, checklist: { finished: 0, skipped: 0, pending: 0, total: 0 } },
    running: { takenAt: null, state: null, runId: null, pageHeading: null, checklist: { finished: 0, skipped: 0, pending: 0, total: 0 } },
    start: { takenAt: start?.at ?? null, state: 'running', runId, pageHeading: runningHeading, checklist: start ? { finished: start.finished, skipped: start.skipped, pending: start.pending, total: start.total } : null },
    middle: { takenAt: middle?.at ?? null, state: 'running', runId, pageHeading: runningHeading, checklist: middle ? { finished: middle.finished, skipped: middle.skipped, pending: middle.pending, total: middle.total } : null },
    end: { takenAt: new Date().toISOString(), state: job.state, runId, pageHeading, checklist: { finished: summary.finished, skipped: summary.skipped, pending: summary.pending, total: summary.finished + summary.skipped + summary.pending }, cardShot: true },
  }
  await writeFile(join(outDir, 'screenshots.json'), JSON.stringify(shots, null, 2))
  await writeFile(join(outDir, 'browser.json'), JSON.stringify({ url: base, runId, consoleEvents, pageErrors }, null, 2))
  console.log(JSON.stringify({ result: job.state, runId, pageHeading, checklist: shots.end.checklist, screenshots: Object.keys(shots) }, null, 2))
} finally {
  await browser.close()
}
