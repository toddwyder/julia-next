import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

import { activityDelta, launchControlServer, prohibitedActivity, readInitializationBoundary, retainBoundaryMeasurements } from './initialization-driver-support.mjs'

const repoRoot = resolve(import.meta.dirname, '../../..')

const evidenceDirectory = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(repoRoot, '.artifacts/verify-machine', `${Date.now()}-${process.pid}`)
const targetCardId = process.argv[3] || process.env.JULIA_VERIFY_CARD_ID || 'JUL-230'

await mkdir(evidenceDirectory, { recursive: true })
const storagePath = resolve(evidenceDirectory, 'initialization.db')
const serverLogPath = resolve(evidenceDirectory, 'control-server.log')
const launcherScript = resolve(repoRoot, 'scripts/start-julia-control-page.ps1')

const launchBoundary = boundaryLabel => launchControlServer({ boundaryLabel, launcherScript, repoRoot, storagePath })

const startedAt = new Date().toISOString()
const allServerLogs = []
let boundary1
let boundary2
let browser

try {
// --- Launch Boundary 1 ---
boundary1 = await launchBoundary('boundary-1')

browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
page.setDefaultTimeout(90000)
page.setDefaultNavigationTimeout(90000)

const consoleErrors = []
page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})

let interceptedRequests = []
page.on('request', req => {
  interceptedRequests.push({ method: req.method(), url: req.url(), timestamp: new Date().toISOString() })
})

// --- Load Control Page in Browser ---
console.log(JSON.stringify({ event: 'navigating-to-control-page', url: boundary1.serverInfo.url }))
await page.goto(boundary1.serverInfo.url)
await page.getByRole('heading', { name: 'Initialize a Ready card' }).waitFor()
const cardSelect = page.locator('select[name="card"]')
await cardSelect.waitFor()
await cardSelect.locator('option').first().waitFor({ state: 'attached' })

// Fetch discovery state
const stateRes = await fetch(`${boundary1.serverInfo.url}/api/state`)
const state = await stateRes.json()

// Find target card index
const cardOptions = await cardSelect.locator('option').allInnerTexts()
const matchingIndex = cardOptions.findIndex(text => text.startsWith(targetCardId))
assert.ok(matchingIndex >= 0, `Could not find card ${targetCardId} in options: ${cardOptions.join(', ')}`)
await cardSelect.selectOption(String(matchingIndex))

// --- Record Initial Role Selections ---
const initialRoleSelections = {}
for (const role of ['Builder', 'Reviewer', 'Crash fixer', 'Crash reviewer']) {
  const group = page.getByRole('group', { name: role, exact: true })
  const modelValue = await group.getByLabel('Route and model').inputValue()
  const effortValue = await group.getByLabel('Effort').inputValue()
  initialRoleSelections[role] = { modelValue, effortValue }
}
console.log(JSON.stringify({ event: 'recorded-initial-role-selections', initialRoleSelections }))

// --- Exercise 1: Cancel after creating selections that would fail Start validation ---
console.log(JSON.stringify({ event: 'testing-cancel-with-invalid-selections' }))

// Builder and Reviewer from the same company violates the cross-company constraint
const antigravityOffers = state.offers.filter(o => o.route === 'antigravity')
const commandCodeOffers = state.offers.filter(o => o.route === 'commandcode')
assert.ok(antigravityOffers.length > 0, 'Must have at least one Antigravity model offer')
assert.ok(commandCodeOffers.length > 0, 'Must have at least one CommandCode model offer')

const sameCompanyOffer = antigravityOffers[0]
// Set both Builder and Reviewer to same company (Google Antigravity), which would fail Start validation
const builderGroup = page.getByRole('group', { name: 'Builder', exact: true })
const reviewerGroup = page.getByRole('group', { name: 'Reviewer', exact: true })
await builderGroup.getByLabel('Route and model').selectOption(`${sameCompanyOffer.route}::${sameCompanyOffer.modelId}`)
await reviewerGroup.getByLabel('Route and model').selectOption(`${sameCompanyOffer.route}::${sameCompanyOffer.modelId}`)

// Ensure invalid selections are active in DOM
assert.equal(
  await builderGroup.getByLabel('Route and model').inputValue(),
  await reviewerGroup.getByLabel('Route and model').inputValue(),
  'Both Builder and Reviewer must be configured with same company to fail Start validation'
)

const persistedBeforeCancel = await readInitializationBoundary(boundary1.serverInfo.url)
const browserRequestsBeforeCancel = interceptedRequests.length

// Click Cancel
await page.getByRole('button', { name: 'Cancel' }).click()
await page.getByText('Initialization closed. Nothing was sent or saved.').waitFor()

const formCountAfterCancel = await page.locator('form').count()
assert.equal(formCountAfterCancel, 0, 'Cancel must remove the form locally')
const browserRequestsAfterCancel = interceptedRequests.length
assert.equal(browserRequestsAfterCancel, browserRequestsBeforeCancel, 'Cancel must trigger zero browser requests')
const persistedAfterCancel = await readInitializationBoundary(boundary1.serverInfo.url)
assert.deepEqual(persistedAfterCancel.runs, persistedBeforeCancel.runs, 'Cancel must leave every persisted run unchanged')
assert.equal(persistedAfterCancel.totalRuns, persistedBeforeCancel.totalRuns, 'Cancel must leave the total run count unchanged')
const cancelActivityDelta = activityDelta(persistedAfterCancel.activity, persistedBeforeCancel.activity)
const zeroRoleDispatchDelta = Object.fromEntries(Object.keys(cancelActivityDelta.roleDispatches).map(role => [role, 0]))
assert.deepEqual(prohibitedActivity(cancelActivityDelta), {
  roleDispatches: zeroRoleDispatchDelta,
  llmInferenceCalls: 0,
  linearMutations: 0,
})

const cancelEvidence = {
  testedAt: new Date().toISOString(),
  invalidSelectionTested: {
    builderCompany: sameCompanyOffer.company,
    reviewerCompany: sameCompanyOffer.company,
    validationViolation: 'builder and reviewer must use different companies',
  },
  formCountAfterCancel,
  browserRequestsTriggered: browserRequestsAfterCancel - browserRequestsBeforeCancel,
  runCountBefore: persistedBeforeCancel.totalRuns,
  runCountAfter: persistedAfterCancel.totalRuns,
  persistedRunsBefore: persistedBeforeCancel.runs,
  persistedRunsAfter: persistedAfterCancel.runs,
  activityBefore: persistedBeforeCancel.activity,
  activityAfter: persistedAfterCancel.activity,
  activityDelta: cancelActivityDelta,
  message: 'Initialization closed. Nothing was sent or saved.',
}
await writeFile(resolve(evidenceDirectory, 'cancel-evidence.json'), `${JSON.stringify(cancelEvidence, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ event: 'cancel-verified', ok: true }))

// --- Exercise 2: Start with Valid Changed Selections in Browser UI ---
console.log(JSON.stringify({ event: 'verifying-start-through-browser-ui' }))
await page.goto(boundary1.serverInfo.url)
await page.getByRole('heading', { name: 'Initialize a Ready card' }).waitFor()
await cardSelect.waitFor()
await cardSelect.selectOption(String(matchingIndex))

// Choose 4 valid selections satisfying cross-company requirements and differing from initial values
const builderOffer = antigravityOffers.find(o => o.supportedEfforts.includes('high')) || antigravityOffers[0]
const reviewerOffer = commandCodeOffers.find(o => o.company.toLowerCase() !== builderOffer.company.toLowerCase() && o.supportedEfforts.includes('low')) || commandCodeOffers[0]
const crashFixerOffer = commandCodeOffers.find(o => o.company.toLowerCase() !== builderOffer.company.toLowerCase() && o.supportedEfforts.includes('medium')) || commandCodeOffers[0]
const crashReviewerOffer = antigravityOffers.find(o => o.company.toLowerCase() !== crashFixerOffer.company.toLowerCase() && o.supportedEfforts.includes('xhigh')) || antigravityOffers[0]

assert.notEqual(builderOffer.company.toLowerCase(), reviewerOffer.company.toLowerCase(), 'Builder and Reviewer companies must differ')
assert.notEqual(crashFixerOffer.company.toLowerCase(), crashReviewerOffer.company.toLowerCase(), 'Crash fixer and Crash reviewer companies must differ')

const roleSelectionsToApply = [
  { role: 'Builder', offer: builderOffer, effort: builderOffer.supportedEfforts.includes('high') ? 'high' : builderOffer.supportedEfforts[0] },
  { role: 'Reviewer', offer: reviewerOffer, effort: reviewerOffer.supportedEfforts.includes('low') ? 'low' : reviewerOffer.supportedEfforts[0] },
  { role: 'Crash fixer', offer: crashFixerOffer, effort: crashFixerOffer.supportedEfforts.includes('medium') ? 'medium' : crashFixerOffer.supportedEfforts[0] },
  { role: 'Crash reviewer', offer: crashReviewerOffer, effort: crashReviewerOffer.supportedEfforts.includes('xhigh') ? 'xhigh' : crashReviewerOffer.supportedEfforts[0] },
]

// Apply selections and verify every final selection differs from its initial value
const finalRoleSelections = {}
for (const { role, offer, effort } of roleSelectionsToApply) {
  const group = page.getByRole('group', { name: role, exact: true })
  const optionValue = `${offer.route}::${offer.modelId}`
  await group.getByLabel('Route and model').selectOption(optionValue)
  await group.getByLabel('Effort').selectOption(effort)
  finalRoleSelections[role] = { modelValue: optionValue, effort }

  const initial = initialRoleSelections[role]
  const differs = (optionValue !== initial.modelValue) || (effort !== initial.effortValue)
  assert.ok(differs, `Role ${role} final selection (${optionValue}, ${effort}) must differ from initial value (${initial.modelValue}, ${initial.effortValue})`)
}
console.log(JSON.stringify({ event: 'proved-all-four-selections-differ', initialRoleSelections, finalRoleSelections }))

await page.getByRole('button', { name: 'Start' }).click()
await page.getByText('Ready for build').waitFor({ timeout: 90000 })

const statusText = await page.locator('.status pre').innerText()
const startResult = JSON.parse(statusText)

assert.equal(startResult.state, 'ready-for-build', 'State must be ready-for-build')
assert.equal(startResult.resumed, false, 'First Start must report resumed: false')
assert.equal(startResult.snapshot.card.identifier, targetCardId, 'Snapshot must match target card')

for (const { role, offer, effort } of roleSelectionsToApply) {
  const roleKey = role === 'Crash fixer' ? 'crashFixer' : role === 'Crash reviewer' ? 'crashReviewer' : role.toLowerCase()
  const snapshotRole = startResult.snapshot.roles[roleKey]
  assert.equal(snapshotRole.route, offer.route)
  assert.equal(snapshotRole.modelId, offer.modelId)
  assert.equal(snapshotRole.effort, effort)
}

await writeFile(resolve(evidenceDirectory, 'start-evidence.json'), `${JSON.stringify(startResult, null, 2)}\n`, 'utf8')
const persistedAfterStart = await readInitializationBoundary(boundary1.serverInfo.url)
assert.equal(persistedAfterStart.totalRuns, persistedBeforeCancel.totalRuns + 1, 'Start must add exactly one persisted run')
assert.deepEqual(persistedAfterStart.runs, [{ ...startResult, resumed: true }], 'read boundary must return the initialized run')
assert.ok(persistedAfterStart.activity.linearQueries > persistedBeforeCancel.activity.linearQueries, 'live activity measurement must observe Linear discovery queries')
const zeroRoleDispatches = Object.fromEntries(Object.keys(persistedAfterStart.activity.roleDispatches).map(role => [role, 0]))
assert.deepEqual(prohibitedActivity(persistedAfterStart.activity), {
  roleDispatches: zeroRoleDispatches,
  llmInferenceCalls: 0,
  linearMutations: 0,
})
console.log(JSON.stringify({ event: 'start-verified', runId: startResult.runId, state: startResult.state }))

// --- Exercise 3: Repeat Start through Browser UI (Idempotence) ---
console.log(JSON.stringify({ event: 'verifying-idempotence-through-browser-ui' }))
await page.goto(boundary1.serverInfo.url)
await page.getByRole('heading', { name: 'Initialize a Ready card' }).waitFor()
await cardSelect.waitFor()
await cardSelect.selectOption(String(matchingIndex))

for (const { role, offer, effort } of roleSelectionsToApply) {
  const group = page.getByRole('group', { name: role, exact: true })
  const optionValue = `${offer.route}::${offer.modelId}`
  await group.getByLabel('Route and model').selectOption(optionValue)
  await group.getByLabel('Effort').selectOption(effort)
}

await page.getByRole('button', { name: 'Start' }).click()
await page.getByText('Ready for build').waitFor({ timeout: 90000 })

const repeatedStatusText = await page.locator('.status pre').innerText()
const repeatedResult = JSON.parse(repeatedStatusText)

assert.equal(repeatedResult.runId, startResult.runId, 'Repeat Start must return identical runId')
assert.equal(repeatedResult.resumed, true, 'Repeat Start must report resumed: true')
assert.equal(repeatedResult.state, 'ready-for-build', 'Repeat Start state must remain ready-for-build')
assert.deepEqual(repeatedResult.snapshot, startResult.snapshot, 'Repeat Start snapshot must be identical')

await writeFile(resolve(evidenceDirectory, 'idempotence-evidence.json'), `${JSON.stringify(repeatedResult, null, 2)}\n`, 'utf8')
const persistedAfterRepeat = await readInitializationBoundary(boundary1.serverInfo.url)
assert.equal(persistedAfterRepeat.totalRuns, persistedAfterStart.totalRuns, 'repeat Start must not create another run')
assert.deepEqual(persistedAfterRepeat.runs, persistedAfterStart.runs, 'repeat Start must not change persisted run state')
console.log(JSON.stringify({ event: 'idempotence-verified', ok: true }))

// --- Exercise 4: Boundary Restart and External Readback through Supported Boundary ---
console.log(JSON.stringify({ event: 'stopping-first-boundary-and-restarting' }))
const boundary1Cleanup = await boundary1.stop()
allServerLogs.push(...boundary1.logs)

// Start genuinely new process through the real launcher
boundary2 = await launchBoundary('boundary-2')

console.log(JSON.stringify({ event: 'performing-read-only-external-readback', url: `${boundary2.serverInfo.url}/api/runs` }))
const restartedBoundaryState = await readInitializationBoundary(boundary2.serverInfo.url)
assert.equal(restartedBoundaryState.totalRuns, persistedAfterRepeat.totalRuns, 'restarted boundary must independently report the total run count')
assert.deepEqual(restartedBoundaryState.runs, persistedAfterRepeat.runs, 'restarted boundary must read the persisted run without Start')
assert.ok(restartedBoundaryState.activity.linearQueries > 0, 'restarted process must measure its actual Linear discovery query')
assert.deepEqual(prohibitedActivity(restartedBoundaryState.activity), {
  roleDispatches: zeroRoleDispatches,
  llmInferenceCalls: 0,
  linearMutations: 0,
})

const readbackEvidence = {
  testedAt: new Date().toISOString(),
  boundaryRestarted: boundary1.launcherPid !== boundary2.launcherPid,
  externalBoundary: `${boundary2.serverInfo.url}/api/runs`,
  readback: restartedBoundaryState,
}
await writeFile(resolve(evidenceDirectory, 'readback-evidence.json'), `${JSON.stringify(readbackEvidence, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ event: 'readback-verified', ok: true }))

// Close browser and stop boundary 2
assert.deepEqual(consoleErrors, [], 'control page browser console must remain clean')
await browser.close()
const boundary2Cleanup = await boundary2.stop()
allServerLogs.push(...boundary2.logs)

// --- Write Combined Server Log ---
const formattedLogs = allServerLogs.map(l => l.entry)
await writeFile(serverLogPath, `${formattedLogs.join('\n')}\n`, 'utf8')

// --- Exercise 5: Retain structured boundary events and actual measurements ---
console.log(JSON.stringify({ event: 'retaining-boundary-measurements' }))
const processMeasurements = [persistedAfterRepeat.activity, restartedBoundaryState.activity]
const { boundaryEvents, measuredActivity } = retainBoundaryMeasurements(allServerLogs, processMeasurements)
assert.ok(measuredActivity.linearQueries > 0, 'structured activity must contain actual allowed Linear queries')
assert.deepEqual(prohibitedActivity(measuredActivity), {
  roleDispatches: zeroRoleDispatches,
  llmInferenceCalls: 0,
  linearMutations: 0,
})

const boundaryTraceReport = {
  measuredAt: new Date().toISOString(),
  totalBoundaryLogLines: allServerLogs.length,
  totalParsedEvents: boundaryEvents.length,
  processMeasurements,
  measuredActivity,
  boundaryEvents,
}
await writeFile(resolve(evidenceDirectory, 'boundary-traces.json'), `${JSON.stringify(boundaryTraceReport, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ event: 'boundary-measurements-retained', measuredActivity }))

// --- Final drive.json Summary ---
const driveSummary = {
  feature: 'initialize-ready-card',
  command: 'node .agents/skills/verify-machine/drive-initialization.mjs',
  expected: 'launcher-driven control page, all four selections differ from initial values, Cancel sends no browser request and preserves persisted state, repeat Start is idempotent, restart uses the read-only run boundary, structured activity measures dispatches, inference calls, Linear operations, and PID-scoped cleanup fails on survivors',
  observed: {
    targetCard: targetCardId,
    launcherUsed: launcherScript,
    initialRoleSelections,
    finalRoleSelections,
    cancelTest: {
      invalidSelection: cancelEvidence.invalidSelectionTested,
      browserRequestsTriggered: cancelEvidence.browserRequestsTriggered,
      runCountBefore: cancelEvidence.runCountBefore,
      runCountAfter: cancelEvidence.runCountAfter,
      persistedRunsBefore: cancelEvidence.persistedRunsBefore,
      persistedRunsAfter: cancelEvidence.persistedRunsAfter,
      activityDelta: cancelEvidence.activityDelta,
    },
    firstStart: {
      runId: startResult.runId,
      state: startResult.state,
      resumed: startResult.resumed,
      snapshotRoles: startResult.snapshot.roles,
    },
    repeatStartBrowserUI: {
      runId: repeatedResult.runId,
      state: repeatedResult.state,
      resumed: repeatedResult.resumed,
      totalRuns: persistedAfterRepeat.totalRuns,
    },
    restartAndExternalReadback: {
      externalBoundary: `${boundary2.serverInfo.url}/api/runs`,
      totalRuns: restartedBoundaryState.totalRuns,
      runs: restartedBoundaryState.runs,
    },
    activityMeasurement: measuredActivity,
    browserConsoleErrors: consoleErrors,
    pidCleanup: {
      boundaries: [boundary1Cleanup, boundary2Cleanup],
      capturedPids: [...new Set([...boundary1Cleanup.capturedPids, ...boundary2Cleanup.capturedPids])],
      survivors: [...new Set([...boundary1Cleanup.survivors, ...boundary2Cleanup.survivors])],
      allCapturedPidsStopped: [boundary1Cleanup, boundary2Cleanup].every(result => result.allCapturedPidsStopped),
    },
  },
  status: 'completed',
  startedAt,
  finishedAt: new Date().toISOString(),
  sideEffects: { persistedRuns: restartedBoundaryState.totalRuns, measuredActivity },
}

await writeFile(resolve(evidenceDirectory, 'drive.json'), `${JSON.stringify(driveSummary, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ event: 'drive-completed', ok: true }))
} finally {
  if (browser) await browser.close().catch(() => {})
  if (boundary2) await boundary2.stop()
  if (boundary1) await boundary1.stop()
}
