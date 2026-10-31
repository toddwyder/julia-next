// Token and cost totals for one run. Sessions are CLI subprocesses, so Mastra
// never sees their usage; each session prints it, the workflow keeps it per
// step, and this file adds it up. A price comes from the dashboard's own sweep
// (`models.json`), the same catalogue `scripts/scorecard.mjs` costs runs with.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const TOKEN_FIELDS = ['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens', 'reasoningTokens']

export function addUsage(total, usage) {
  const next = { ...total }
  for (const field of TOKEN_FIELDS) {
    if (typeof usage?.[field] === 'number') next[field] = (next[field] ?? 0) + usage[field]
  }
  return next
}

export function cataloguePath({ stateDir = process.env.DASHBOARD_STATE_DIR ?? '/var/lib/julia-dashboard' } = {}) {
  return join(stateDir, 'state', 'models.json')
}

export function readCatalogue(options = {}) {
  const path = cataloguePath(options)
  try {
    return { path, models: JSON.parse(readFileSync(path, 'utf8')).models ?? [] }
  } catch {
    return { path, models: null }
  }
}

function normalize(model) {
  return typeof model === 'string' ? model.replace(/^mastracode\//, '').replace(/^commandcode\//, '') : ''
}

export function priceFor(model, catalogue) {
  if (!catalogue?.models) return null
  const wanted = normalize(model)
  const rows = catalogue.models.filter((row) => normalize(row.id) === wanted)
  if (rows.length === 1) return rows[0]
  if (rows.length > 1) return rows.find((row) => row.id === model) ?? rows[0]
  const tail = wanted.split('/').at(-1)
  const byTail = catalogue.models.filter((row) => normalize(row.id).split('/').at(-1) === tail)
  return byTail.length === 1 ? byTail[0] : null
}

// Cost is in whole cents: a run is billed in dollars, and half a cent of
// precision is already more than any provider reports.
export function costOf({ model, usage, catalogue }) {
  if (!usage) return { usd: null, reason: `no usage was recorded for ${model}` }
  const row = priceFor(model, catalogue)
  if (!row) return { usd: null, reason: `the price catalogue has no row for ${model}` }
  if (row.free) return { usd: 0, reason: null }
  if (typeof row.inputPerMillion !== 'number' || typeof row.outputPerMillion !== 'number') {
    return { usd: null, reason: `the price catalogue has no per-million price for ${model}` }
  }
  const input = (usage.inputTokens ?? 0) * row.inputPerMillion / 1e6
  const output = (usage.outputTokens ?? 0) * row.outputPerMillion / 1e6
  return { usd: input + output, reason: null }
}

// Totals over every activity that ran a model. Unknown prices are reported
// instead of guessed, so a run record never claims a cost it cannot support.
export function usageSummary(activities, { catalogue = readCatalogue() } = {}) {
  let tokens = {}
  let usd = 0
  let priced = true
  const missingPrices = []
  for (const activity of activities) {
    if (!activity.usage) continue
    tokens = addUsage(tokens, activity.usage)
    const cost = costOf({ model: activity.model, usage: activity.usage, catalogue })
    if (cost.usd === null) {
      priced = false
      missingPrices.push(cost.reason)
    } else {
      usd += cost.usd
    }
  }
  const hasTokens = Object.keys(tokens).length > 0
  return {
    tokens: hasTokens ? tokens : null,
    costUsd: hasTokens ? (priced ? Number(usd.toFixed(4)) : null) : 0,
    costNote: hasTokens
      ? (priced ? null : `${[...new Set(missingPrices)].join('; ')}; token totals are recorded, cost is not`)
      : null,
    priceCatalogue: catalogue.path,
  }
}
