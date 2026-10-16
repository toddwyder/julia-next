import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const skillDirectory = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(skillDirectory, '../../..')
const { createInitializationRuntime } = await import(
  `file:///${resolve(repoRoot, 'ops/mastra-agents/reviewer/src/mastra/initialization.ts').replaceAll('\\', '/')}`
)

const evidenceDirectory = process.argv[2] ? resolve(process.argv[2]) : resolve(repoRoot, '.artifacts/verify-machine', `${Date.now()}-${process.pid}`)
const targetCardId = process.argv[3] || process.env.JULIA_VERIFY_CARD_ID || 'JUL-230'

await mkdir(evidenceDirectory, { recursive: true })
const storagePath = resolve(evidenceDirectory, 'initialization.db')
const serverLogPath = resolve(evidenceDirectory, 'control-server.log')

const vaultScript = resolve(repoRoot, 'scripts/julia-vault-windows.ps1')
const serverScript = resolve(repoRoot, 'ops/mastra-agents/reviewer/src/mastra/control-server.ts')

console.log(JSON.stringify({ event: 'drive-starting', targetCardId, evidenceDirectory, storagePath }))

const startedAt = new Date().toISOString()
const serverLogs = []
let serverReadyResolve
let serverReadyReject
const serverReadyPromise = new Promise((resolve, reject) => {
  serverReadyResolve = resolve
  serverReadyReject = reject
})

const serverProcess = spawn('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
  `& '${vaultScript}' -SecretNames LINEAR_API_KEY,COMMANDCODE_API_KEY -RunArguments node,--experimental-strip-types,'${serverScript}'`,
], {
  cwd: repoRoot,
  env: {
    ...process.env,
    JULIA_INITIALIZATION_DB: storagePath,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const serverPid = serverProcess.pid
console.log(JSON.stringify({ event: 'server-spawned', pid: serverPid }))

const onLine = (line, stream) => {
  const entry = `[${new Date().toISOString()}] [${stream}] ${line}`
  serverLogs.push(entry)
  if (line.includes('"status":"ready"')) {
    try {
      const data = JSON.parse(line)
      serverReadyResolve(data)
    } catch (error) {
      serverReadyReject(error)
    }
  }
}

createInterface({ input: serverProcess.stdout }).on('line', line => onLine(line, 'STDOUT'))
createInterface({ input: serverProcess.stderr }).on('line', line => onLine(line, 'STDERR'))

serverProcess.on('exit', code => {
  serverReadyReject(new Error(`control server exited prematurely with code ${code}`))
})

const timeoutTimer = setTimeout(() => {
  serverReadyReject(new Error('timeout waiting for control server to report ready'))
}, 90000)

let serverInfo
try {
  serverInfo = await serverReadyPromise
} finally {
  clearTimeout(timeoutTimer)
}

console.log(JSON.stringify({ event: 'server-ready', url: serverInfo.url, storage: serverInfo.storage }))

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
page.setDefaultTimeout(90000)
page.setDefaultNavigationTimeout(90000)

const consoleErrors = []
page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})

const requests = []
page.on('request', req => {
  requests.push({ method: req.method(), url: req.url() })
})

// --- Exercise 1: Cancel ---
console.log(JSON.stringify({ event: 'verifying-cancel' }))
await page.goto(serverInfo.url)
await page.getByRole('heading', { name: 'Initialize a Ready card' }).waitFor()
await page.getByRole('button', { name: 'Cancel' }).waitFor({ timeout: 90000 })

const requestsBeforeCancel = requests.length
await page.getByRole('button', { name: 'Cancel' }).click()
await page.getByText('Initialization closed. Nothing was sent or saved.').waitFor()

const requestsAfterCancel = requests.length
assert.equal(requestsAfterCancel, requestsBeforeCancel, 'Cancel must not trigger server requests')
assert.equal(await page.locator('form').count(), 0, 'Cancel must remove the form locally')

const cancelEvidence = {
  testedAt: new Date().toISOString(),
  formRemoved: true,
  requestsDuringCancel: 0,
  consoleErrors,
  message: 'Initialization closed. Nothing was sent or saved.',
}
await writeFile(resolve(evidenceDirectory, 'cancel-evidence.json'), `${JSON.stringify(cancelEvidence, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ event: 'cancel-verified', ok: true }))

// --- Exercise 2: Start with 4 changed selections ---
console.log(JSON.stringify({ event: 'verifying-start', targetCardId }))
const statePromise = page.waitForResponse(res => res.url().includes('/api/state') && res.status() === 200).then(res => res.json())
await page.goto(serverInfo.url)
await page.getByRole('heading', { name: 'Initialize a Ready card' }).waitFor()
await page.getByRole('button', { name: 'Start' }).waitFor({ timeout: 90000 })

const state = await statePromise
assert.ok(state.cards && state.offers, 'State response must contain cards and offers')

// Wait for options to be attached
const cardSelect = page.locator('select[name="card"]')
await cardSelect.waitFor()
await cardSelect.locator('option').first().waitFor({ state: 'attached' })

// Find card index
const cardOptions = await cardSelect.locator('option').allInnerTexts()
const matchingIndex = cardOptions.findIndex(text => text.startsWith(targetCardId))
assert.ok(matchingIndex >= 0, `Could not find card ${targetCardId} in control page dropdown options: ${cardOptions.join(', ')}`)
await cardSelect.selectOption(String(matchingIndex))

const antigravityOffers = state.offers.filter(o => o.route === 'antigravity')
const commandCodeOffers = state.offers.filter(o => o.route === 'commandcode')

assert.ok(antigravityOffers.length > 0, 'Must have at least one Antigravity model offer')
assert.ok(commandCodeOffers.length > 0, 'Must have at least one CommandCode model offer')

const builderOffer = antigravityOffers.find(o => o.supportedEfforts.includes('high')) || antigravityOffers[0]
const reviewerOffer = commandCodeOffers.find(o => o.company.toLowerCase() !== builderOffer.company.toLowerCase() && o.supportedEfforts.includes('low')) || commandCodeOffers[0]
const crashFixerOffer = commandCodeOffers.find(o => o.company.toLowerCase() !== builderOffer.company.toLowerCase() && o.supportedEfforts.includes('medium')) || commandCodeOffers[0]
const crashReviewerOffer = antigravityOffers.find(o => o.company.toLowerCase() !== crashFixerOffer.company.toLowerCase() && o.supportedEfforts.includes('xhigh')) || antigravityOffers[0]

assert.notEqual(builderOffer.company.toLowerCase(), reviewerOffer.company.toLowerCase(), 'Builder and reviewer companies must differ')
assert.notEqual(crashFixerOffer.company.toLowerCase(), crashReviewerOffer.company.toLowerCase(), 'Crash fixer and crash reviewer companies must differ')

const roleSelectionsToApply = [
  { role: 'Builder', offer: builderOffer, effort: builderOffer.supportedEfforts.includes('high') ? 'high' : builderOffer.supportedEfforts[0] },
  { role: 'Reviewer', offer: reviewerOffer, effort: reviewerOffer.supportedEfforts.includes('low') ? 'low' : reviewerOffer.supportedEfforts[0] },
  { role: 'Crash fixer', offer: crashFixerOffer, effort: crashFixerOffer.supportedEfforts.includes('medium') ? 'medium' : crashFixerOffer.supportedEfforts[0] },
  { role: 'Crash reviewer', offer: crashReviewerOffer, effort: crashReviewerOffer.supportedEfforts.includes('xhigh') ? 'xhigh' : crashReviewerOffer.supportedEfforts[0] },
]

for (const { role, offer, effort } of roleSelectionsToApply) {
  const group = page.getByRole('group', { name: role, exact: true })
  const optionValue = `${offer.route}::${offer.modelId}`
  await group.getByLabel('Route and model').selectOption(optionValue)
  await group.getByLabel('Effort').selectOption(effort)
}

await page.getByRole('button', { name: 'Start' }).click()
await page.getByText('Ready for build').waitFor({ timeout: 90000 })

const statusText = await page.locator('.status pre').innerText()
const startResult = JSON.parse(statusText)

assert.equal(startResult.state, 'ready-for-build', 'State must be ready-for-build')
assert.equal(startResult.resumed, false, 'First Start must not be resumed')
assert.equal(startResult.snapshot.card.identifier, targetCardId, 'Snapshot must match selected card')

for (const { role, offer, effort } of roleSelectionsToApply) {
  const roleKey = role === 'Crash fixer' ? 'crashFixer' : role === 'Crash reviewer' ? 'crashReviewer' : role.toLowerCase()
  const snapshotRole = startResult.snapshot.roles[roleKey]
  assert.equal(snapshotRole.route, offer.route)
  assert.equal(snapshotRole.modelId, offer.modelId)
  assert.equal(snapshotRole.effort, effort)
}

await writeFile(resolve(evidenceDirectory, 'start-evidence.json'), `${JSON.stringify(startResult, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ event: 'start-verified', runId: startResult.runId, state: startResult.state }))

// --- Exercise 3: Repeat Start for Idempotence ---
console.log(JSON.stringify({ event: 'verifying-idempotence' }))
const idempotencePayload = {
  card: startResult.snapshot.card,
  roles: startResult.snapshot.roles,
}

const repeatRes = await fetch(`${serverInfo.url}/api/start`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(idempotencePayload),
})
const repeatedResult = await repeatRes.json()

assert.equal(repeatedResult.runId, startResult.runId, 'Repeat Start must return identical runId')
assert.equal(repeatedResult.resumed, true, 'Repeat Start must report resumed: true')
assert.equal(repeatedResult.state, 'ready-for-build', 'Repeat Start state must remain ready-for-build')
assert.deepEqual(repeatedResult.snapshot, startResult.snapshot, 'Repeat Start snapshot must be identical')

await writeFile(resolve(evidenceDirectory, 'idempotence-evidence.json'), `${JSON.stringify(repeatedResult, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ event: 'idempotence-verified', ok: true }))

// --- Close browser and stop control server ---
await browser.close()
console.log(JSON.stringify({ event: 'stopping-server' }))
serverProcess.kill('SIGINT')

await new Promise(r => setTimeout(r, 2000))
try { process.kill(serverPid) } catch {}
try {
  const { execFileSync } = await import('node:child_process')
  execFileSync('powershell.exe', [
    '-NoProfile', '-Command',
    `Get-NetTCPConnection -LocalPort 43123 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`,
  ])
} catch {}

await writeFile(serverLogPath, serverLogs.join('\n'), 'utf8')

// --- Exercise 4: Independent Persistence Readback on Boundary Restart ---
console.log(JSON.stringify({ event: 'verifying-independent-readback' }))
const restartedRuntime = await createInitializationRuntime({ storagePath })
const independentRead = await restartedRuntime.read(startResult.runId)
const totalRuns = await restartedRuntime.runCount()

assert.ok(independentRead, 'Persisted run must be readable upon boundary restart')
assert.equal(independentRead.runId, startResult.runId, 'Readback runId must match')
assert.equal(independentRead.state, 'ready-for-build', 'Readback state must be ready-for-build')
assert.equal(independentRead.resumed, true, 'Readback resumed must be true')
assert.deepEqual(independentRead.snapshot, startResult.snapshot, 'Readback snapshot must match original')
assert.equal(totalRuns, 1, 'Total runs in storage must be exactly 1')

await restartedRuntime.close()

await writeFile(resolve(evidenceDirectory, 'readback-evidence.json'), `${JSON.stringify({
  independentRead,
  totalRuns,
  verifiedAt: new Date().toISOString(),
}, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ event: 'readback-verified', ok: true, totalRuns }))

// --- Prove no LLM invoked ---
const serverLogContent = serverLogs.join('\n')
const forbiddenPatterns = ['builder-execution', 'reviewer-findings', 'crash-fixer-analysis', 'promptForRole']
for (const pat of forbiddenPatterns) {
  assert.ok(!serverLogContent.includes(pat), `Server log must not contain role LLM activity: ${pat}`)
}

// --- Write final drive.json ---
const driveSummary = {
  feature: 'initialize-ready-card',
  command: 'node .agents/skills/verify-machine/drive-initialization.mjs',
  expected: 'one durable restart-surviving pre-build run, snapshot matching exact 4 selections, no LLM invoked, idempotence on repeat, cancel zero side effects, clean independent readback',
  observed: {
    targetCard: targetCardId,
    runId: startResult.runId,
    state: startResult.state,
    snapshotRoles: startResult.snapshot.roles,
    idempotenceResumed: repeatedResult.resumed,
    cancelSideEffects: 0,
    readbackTotalRuns: totalRuns,
    noLlmInvoked: true,
  },
  exitCode: 0,
  startedAt,
  finishedAt: new Date().toISOString(),
  sideEffects: 'one suspended ready-for-build run persisted in run-owned storage; no external mutation, tracker mutation, or role execution',
}

await writeFile(resolve(evidenceDirectory, 'drive.json'), `${JSON.stringify(driveSummary, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ event: 'drive-completed', ok: true }))
