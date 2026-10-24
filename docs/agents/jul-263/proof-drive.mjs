import { createRequire } from 'node:module'
import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const require = createRequire(fileURLToPath(new URL('../../../ops/mastra-agents/reviewer/package.json', import.meta.url)))
const { chromium } = require('playwright')

const base = process.env.JULIA_CONTROL_URL ?? 'https://ovh.tail91f394.ts.net/julia-control'
const card = process.env.PRACTICE_CARD ?? 'JUL-264'
const model = process.env.PRACTICE_MODEL ?? 'reflection/beam:free'
const effort = process.env.PRACTICE_EFFORT ?? 'high'
const coderEffort = process.env.PRACTICE_CODER_EFFORT ?? effort
const outDir = fileURLToPath(new URL(process.env.PROOF_OUT ?? './proof/final/', import.meta.url))
const timeoutMs = Number(process.env.PROOF_TIMEOUT_MS ?? 30 * 60 * 1000)
const pollMs = Number(process.env.PROOF_POLL_MS ?? 2000)

await mkdir(outDir, { recursive: true })
const startedAt = new Date().toISOString()
const consoleEvents = []
const pageErrors = []
const snapshots = []
const shots = {}
const pinned = { runId: process.env.PROOF_RUN_ID || null }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } })
page.on('console', message => consoleEvents.push({ type: message.type(), text: message.text() }))
page.on('pageerror', error => pageErrors.push(String(error)))

async function jobs() {
  const response = await page.evaluate(async path => {
    const result = await fetch(path)
    return { status: result.status, body: await result.json() }
  }, '/julia-control/api/builds')
  if (response.status !== 200) throw new Error(`builds request failed: ${response.status} ${JSON.stringify(response.body)}`)
  return response.body
}

function jobFor(list) {
  const jobs = Array.isArray(list) ? list : []
  if (pinned.runId) return jobs.find(job => job.runId === pinned.runId)
  return jobs.filter(job => job.snapshot?.card?.identifier === card).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).at(-1)
}

function counts(job) {
  const summary = job?.checklist?.summary
  if (summary) return { finished: summary.finished, skipped: summary.skipped, pending: summary.pending, total: summary.finished + summary.skipped + summary.pending }
  const items = job?.checklist?.items ?? []
  return {
    finished: items.filter(item => item.status === 'finished').length,
    skipped: items.filter(item => item.status === 'skipped').length,
    pending: items.filter(item => item.status === 'pending').length,
    total: items.length,
  }
}

async function shot(name, job) {
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true })
  let cardShot = false
  let pageHeading = null
  if (job?.runId) {
    const card = page.locator('article.build-card').filter({ hasText: job.runId }).first()
    if (await card.count()) {
      pageHeading = (await card.locator('h3').textContent())?.trim() ?? null
      await card.screenshot({ path: join(outDir, `${name}-card.png`) })
      cardShot = true
    }
  }
  shots[name] = {
    takenAt: new Date().toISOString(),
    state: job?.state ?? null,
    runId: job?.runId ?? null,
    pageHeading,
    checklist: counts(job),
    cardShot,
    items: job?.checklist?.items ?? [],
  }
}

try {
  await page.goto(`${base}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.locator('select[name="card"]').waitFor({ state: 'visible', timeout: 60000 })

  const cardSelect = page.locator('select[name="card"]')
  const cardOptions = await cardSelect.locator('option').evaluateAll(options => options.map(option => ({ value: option.value, text: option.textContent })))
  const cardOption = cardOptions.find(option => option.text.includes(card))
  if (!cardOption) throw new Error(`card ${card} is not offered: ${JSON.stringify(cardOptions)}`)
  await cardSelect.selectOption(cardOption.value)

  const beamValue = `${'commandcode'}::${model}`
  for (const legendText of ['Orchestrator', 'Coder']) {
    const fieldset = page.locator('fieldset', { has: page.locator('legend', { hasText: legendText }) })
    const selects = fieldset.locator('select')
    const options = await selects.first().locator('option').evaluateAll(values => values.map(option => ({ value: option.value, text: option.textContent })))
    const beam = options.find(option => option.value === beamValue) ?? options.find(option => option.value.includes(model))
    if (!beam) throw new Error(`Beam is not offered for ${legendText}: ${JSON.stringify(options)}`)
    await selects.first().selectOption(beam.value)
    await selects.nth(1).selectOption(legendText === 'Coder' ? coderEffort : effort)
  }
  await shot('start-selected', null)

  const startResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/api/start'), { timeout: 120000 })
  await page.getByRole('button', { name: /^Start$/ }).click()
  const started = Date.now()
  const startBody = await (await startResponse).json()
  if (!startBody.build?.runId) throw new Error(`Start returned no build: ${JSON.stringify(startBody)}`)
  pinned.runId = startBody.build.runId
  await writeFile(join(outDir, 'start-ui-response.json'), JSON.stringify(startBody, null, 2))
  let job
  while (Date.now() - started < 120000) {
    const list = await jobs()
    job = jobFor(list)
    if (job) break
    await page.waitForTimeout(pollMs)
  }
  if (!job) throw new Error('the Start did not create a job')
  await writeFile(join(outDir, 'start-response.json'), JSON.stringify(job, null, 2))

  await shot('running', null)
  let startShot = false
  let middleShot = false
  let startFinished = null
  const startFallback = Date.now() + 180000
  while (Date.now() - started < timeoutMs) {
    const list = await jobs()
    const current = jobFor(list)
    if (current) job = current
    const countsNow = counts(job)
    snapshots.push({ at: new Date().toISOString(), state: job.state, ...countsNow })
    await appendFile(join(outDir, 'checklist.jsonl'), JSON.stringify(snapshots.at(-1)) + '\n')

    if (!startShot && (countsNow.total > 0 || Date.now() > startFallback)) {
      startShot = true
      startFinished = countsNow.finished
      await shot('start', job)
    } else if (startShot && !middleShot && job.state === 'running' && countsNow.total > 0 && countsNow.finished !== startFinished) {
      middleShot = true
      await shot('middle', job)
    }
    if (job.state === 'ready-for-review') {
      const finishedCard = page.locator('article.build-card').filter({ hasText: pinned.runId }).first()
      await finishedCard.locator('h3', { hasText: 'ready-for-review' }).waitFor({ timeout: 20000 })
      await shot('end', job)
      if (!String(shots.end?.pageHeading ?? '').includes('ready-for-review')) throw new Error(`end screenshot does not show the finished build: ${shots.end?.pageHeading}`)
      break
    }
    if (job.state === 'failed') {
      const failedCard = page.locator('article.build-card').filter({ hasText: pinned.runId }).first()
      await failedCard.locator('h3', { hasText: 'failed' }).waitFor({ timeout: 20000 }).catch(() => {})
      await shot('end-failed', job)
      break
    }
    await page.waitForTimeout(pollMs)
  }

  if (job.state !== 'ready-for-review') await shot('end', job)
  await writeFile(join(outDir, 'final-job.json'), JSON.stringify(job, null, 2))
  await writeFile(join(outDir, 'browser.json'), JSON.stringify({ url: base, card, model, startedAt, consoleEvents, pageErrors }, null, 2))
  await writeFile(join(outDir, 'screenshots.json'), JSON.stringify(shots, null, 2))
  console.log(JSON.stringify({ result: job.state, runId: job.runId, screenshots: Object.keys(shots), checklist: counts(job) }, null, 2))
  if (job.state !== 'ready-for-review') process.exitCode = 1
} finally {
  await browser.close()
}
