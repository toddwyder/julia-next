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
const outDir = fileURLToPath(new URL(process.env.PROOF_OUT ?? './proof/final/', import.meta.url))
const timeoutMs = Number(process.env.PROOF_TIMEOUT_MS ?? 30 * 60 * 1000)
const pollMs = Number(process.env.PROOF_POLL_MS ?? 2000)

await mkdir(outDir, { recursive: true })
const startedAt = new Date().toISOString()
const consoleEvents = []
const pageErrors = []
const snapshots = []
const shots = {}

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
  return (Array.isArray(list) ? list : []).filter(job => job.snapshot?.card?.identifier === card).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).at(-1)
}

function counts(job) {
  const items = job?.checklist?.items ?? []
  return { done: items.filter(item => item.done).length, total: items.length }
}

async function shot(name, job) {
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true })
  shots[name] = {
    takenAt: new Date().toISOString(),
    state: job?.state ?? null,
    runId: job?.runId ?? null,
    checklist: counts(job),
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
    await selects.nth(1).selectOption(effort)
  }
  await shot('start-selected', null)

  await page.getByRole('button', { name: /^Start$/ }).click()
  const started = Date.now()
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
  const startFallback = Date.now() + 180000
  while (Date.now() - started < timeoutMs) {
    const list = await jobs()
    const current = jobFor(list)
    if (current) job = current
    const countsNow = counts(job)
    snapshots.push({ at: new Date().toISOString(), state: job.state, done: countsNow.done, total: countsNow.total })
    await appendFile(join(outDir, 'checklist.jsonl'), JSON.stringify(snapshots.at(-1)) + '\n')

    if (!startShot && (countsNow.total > 0 || Date.now() > startFallback)) {
      startShot = true
      await shot('start', job)
    } else if (!middleShot && countsNow.total > 0 && countsNow.done > 0 && countsNow.done < countsNow.total) {
      middleShot = true
      await shot('middle', job)
    }
    if (job.state === 'ready-for-review') {
      await shot('end', job)
      break
    }
    if (job.state === 'failed') {
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
