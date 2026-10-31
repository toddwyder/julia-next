#!/usr/bin/env node
// Starts one card run, then steps back. The workflow does the work; this file
// only opens the run, prints what happened, and offers the three things a
// person needs afterwards: resume a killed run, approve a paused run, and post
// a kept verdict again.

import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Mastra } from '@mastra/core'
import { LibSQLStore } from '@mastra/libsql'
import { WORKFLOW_ID, STATE_DIR, createCardRunWorkflow, readRunRecord } from './src/workflow.mjs'
import { postCardComment, postPullComment } from './src/card.mjs'
import { parseVerdict } from './src/verdict.mjs'
import { verdictComment } from './src/prompts.mjs'

export function parseArgs(argv) {
  const options = {}
  if (!argv.length) throw new Error('usage: run.mjs JUL-<n> [--repo <path>] [--run-dir <path>] [--ship-only --branch <name>]')
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--repo') options.repoDir = argv[++index]
    else if (arg === '--run-dir') options.runDir = argv[++index]
    else if (arg === '--branch') options.branch = argv[++index]
    else if (arg === '--ship-only') options.shipOnly = true
    else if (arg === '--resume') options.resume = argv[++index]
    else if (arg === '--approve') options.approve = argv[++index]
    else if (arg === '--repost') options.repost = argv[++index]
    else if (arg.startsWith('--')) throw new Error(`unknown argument: ${arg}`)
    else if (!options.card) {
      if (!/^JUL-\d+$/i.test(arg)) throw new Error(`not a card id: ${arg}`)
      options.card = arg.toUpperCase()
    } else throw new Error(`unexpected argument: ${arg}`)
  }
  if (!options.card && !options.resume && !options.approve && !options.repost) {
    throw new Error('usage: run.mjs JUL-<n> [--repo <path>] [--run-dir <path>] [--ship-only --branch <name>]')
  }
  return options
}

export function cardOfRun(runId) {
  const match = /^(JUL-\d+)-/i.exec(runId)
  if (!match) throw new Error(`not a card run id: ${runId}`)
  return match[1].toUpperCase()
}

export function runDirFor({ runDir, runId }) {
  return runDir ?? join(STATE_DIR, cardOfRun(runId))
}

async function openStorage(runDir) {
  mkdirSync(runDir, { recursive: true })
  const storage = new LibSQLStore({ id: 'card-runner', url: `file:${join(runDir, 'mastra.db')}` })
  await storage.init()
  const mastra = new Mastra({
    storage,
    workflows: { [WORKFLOW_ID]: createCardRunWorkflow() },
    logger: false,
  })
  return { storage, workflow: mastra.getWorkflow(WORKFLOW_ID) }
}

function stepOutput(saved, id) {
  return saved?.steps?.[id]?.output
}

export async function runCardCard(options, { log = console.log } = {}) {
  const runDir = options.runDir ?? join(STATE_DIR, options.card)
  const { storage, workflow } = await openStorage(runDir)
  const runId = `${options.card}-${Date.now()}`
  let saved
  try {
    const run = await workflow.createRun({ runId })
    await run.start({ inputData: options })
    saved = await workflow.getWorkflowRunById(runId)
  } finally {
    await storage.close()
  }

  const record = stepOutput(saved, 'record') ?? saved.result
  const verdict = record?.verdict ?? null
  log(`card ${options.card}`)
  log(`run ${runId}`)
  if (saved.status === 'success' || saved.status === 'suspended') {
    log(verdict ? `Shipping ${verdict.verdict} on ${verdict.verifier}` : `Shipping gave no usable verdict: ${record?.verdictError ?? 'unknown reason'}`)
    if (record?.postError) log(`the verdict was not posted: ${record.postError}; post it again with --repost ${runId}`)
    if (saved.status === 'suspended') log(`waiting for Todd's yes; approve with --approve ${runId}`)
    log(`record ${join(runDir, 'records', `${runId}.json`)}`)
  } else {
    log(`run ${saved.status}: ${saved.error?.message ?? saved.error ?? 'no error recorded'}`)
  }
  return { runId, status: saved.status, runDir, verdict, record, error: saved.error ?? null }
}

export async function resumeRun(runId, { runDir } = {}) {
  const dir = runDirFor({ runDir, runId })
  const { storage, workflow } = await openStorage(dir)
  try {
    const saved = await workflow.getWorkflowRunById(runId)
    if (!saved) throw new Error(`no run named ${runId} in ${dir}`)
    if (saved.status === 'suspended') throw new Error(`${runId} is waiting for approval; use --approve ${runId}`)
    if (saved.status === 'success') return { runId, status: 'success', result: saved.result }
    // Mastra keeps the step the run reached, so starting the same run id again
    // runs the step it died on, not the whole workflow.
    const run = await workflow.createRun({ runId })
    const out = await run.start({ inputData: saved.payload })
    return { runId, status: out.status, result: out.result }
  } finally {
    await storage.close()
  }
}

export async function approveRun(runId, { runDir } = {}) {
  const dir = runDirFor({ runDir, runId })
  const { storage, workflow } = await openStorage(dir)
  try {
    const saved = await workflow.getWorkflowRunById(runId)
    if (!saved) throw new Error(`no run named ${runId} in ${dir}`)
    if (saved.status !== 'suspended') throw new Error(`${runId} is ${saved.status}, not waiting for approval`)
    const run = await workflow.createRun({ runId })
    const out = await run.resume({ resumeData: { approved: true } })
    return { runId, status: out.status, result: out.result }
  } finally {
    await storage.close()
  }
}

export async function repostVerdict(runId, { runDir } = {}) {
  const dir = runDirFor({ runDir, runId })
  const record = readRunRecord(dir, runId)
  const verdict = record.verdict ?? parseVerdictFile(record.verdictPath)
  if (!verdict) throw new Error(`run ${runId} kept no verdict to post`)
  await postCardComment(record.card, verdictComment({ model: verdict.verifier, verdict }))
  if (record.pull) {
    await postPullComment({
      repoDir: record.checkout,
      number: record.pull.number,
      body: `Shipping verdict on ${record.pull.head}\n\n\`\`\`json\n${JSON.stringify(verdict)}\n\`\`\``,
    })
  }
  return { runId, card: record.card, verdict: verdict.verdict }
}

function parseVerdictFile(path) {
  try {
    const parsed = parseVerdict(readText(path))
    return parsed.ok ? parsed.verdict : null
  } catch {
    return null
  }
}

function readText(path) {
  return readFileSync(path, 'utf8')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.repost) {
    const out = await repostVerdict(options.repost, { runDir: options.runDir })
    console.log(`posted the kept verdict for ${out.card}: ${out.verdict}`)
    return
  }
  if (options.approve) {
    const out = await approveRun(options.approve, { runDir: options.runDir })
    console.log(`run ${out.runId} ${out.status}`)
    if (out.result?.verdict) console.log(`Shipping ${out.result.verdict.verdict}`)
    return
  }
  if (options.resume) {
    const out = await resumeRun(options.resume, { runDir: options.runDir })
    console.log(`run ${out.runId} ${out.status}`)
    if (out.result?.verdict) console.log(`Shipping ${out.result.verdict.verdict}`)
    return
  }
  const out = await runCardCard(options)
  process.exitCode = out.verdict && !out.record?.postError ? 0 : 1
}

if (process.argv[1] && process.argv[1].endsWith('run.mjs')) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
