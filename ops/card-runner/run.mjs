#!/usr/bin/env node
// Runs one card's build and Shipping passes inside the Mastra workflow.
//
//   node scripts/julia-agents.mjs -- node ops/card-runner/run.mjs JUL-295
//   node scripts/julia-agents.mjs -- node ops/card-runner/run.mjs JUL-295 --ship-only --branch feat/jul-295-x
//
// The workflow starts every step itself: nothing is launched by hand between
// the build and Shipping. `--ship-only` picks up a branch a build already
// finished outside this workflow and starts at the same handover a build it ran
// itself leaves behind.
import { createCardRunWorkflow } from './src/workflow.mjs'

function parseArgs(argv) {
  const [card, ...rest] = argv
  if (!card || !/^JUL-\d+$/i.test(card)) throw new Error('usage: run.mjs JUL-<n> [--repo <path>] [--run-dir <path>] [--ship-only] [--branch <name>]')
  const options = { card: card.toUpperCase() }
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index]
    const value = rest[index + 1]
    if (flag === '--repo') { options.repoDir = value; index += 1 }
    else if (flag === '--run-dir') { options.runDir = value; index += 1 }
    else if (flag === '--ship-only') options.shipOnly = true
    else if (flag === '--branch') { options.branch = value; index += 1 }
    else throw new Error(`unknown argument: ${flag}`)
  }
  return options
}

export async function runCardCard(options, { createWorkflow = createCardRunWorkflow, log = console.log } = {}) {
  const workflow = createWorkflow()
  const run = await workflow.createRun()
  const result = await run.start({ inputData: options })
  if (result.status !== 'success') {
    const failed = result.steps ? Object.entries(result.steps).find(([, step]) => step?.status === 'failed') : undefined
    throw new Error(`card run did not finish: ${failed ? `${failed[0]}: ${failed[1].error?.message ?? 'failed'}` : result.status}`)
  }
  const state = result.result
  log(`card ${state.card}`)
  log(`free Shipping: ${state.freeVerdict ? `${state.freeVerdict.verdict} after ${state.freeAttempts} attempt(s) on ${state.models.shippingFree}` : `no usable verdict after ${state.freeAttempts} attempt(s)`}`)
  log(`final Shipping: ${state.finalVerdict ? `${state.finalVerdict.verdict} on ${state.models.shippingFinal}` : `no usable verdict (${state.finalError})`}`)
  log(`run record: ${state.runDir}/run.json`)
  return state
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const state = await runCardCard(parseArgs(process.argv.slice(2)))
    process.exitCode = state.finalVerdict ? 0 : 1
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
