// The build tells the runner it is done by writing a file, and it hands over
// the pull request title and description the same way. The runner publishes the
// pull request from those files, so no one retypes a title between the build
// and the PR, and a build that ran outside the workflow can hand over the same
// files.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeCriterion } from './verdict.mjs'

export function handoverPaths(runDir) {
  return {
    title: join(runDir, 'pr', 'title.txt'),
    body: join(runDir, 'pr', 'body.md'),
    done: join(runDir, 'build-done.json'),
  }
}

export function writeBuildHandover({ runDir, card, branch, head, startedAt }) {
  const paths = handoverPaths(runDir)
  mkdirSync(join(runDir, 'pr'), { recursive: true })
  writeFileSync(paths.done, `${JSON.stringify({ card, branch, head, startedAt }, null, 2)}\n`)
  return paths
}

export function readBuildDone({ runDir, card }) {
  const { done } = handoverPaths(runDir)
  let parsed
  try {
    parsed = JSON.parse(readFileSync(done, 'utf8'))
  } catch {
    throw new Error(`the build did not say it was done: ${done} is missing or not JSON`)
  }
  if (parsed.card !== card) throw new Error(`the build said it was done for ${parsed.card}, expected ${card}`)
  if (typeof parsed.branch !== 'string' || !parsed.branch.trim()) throw new Error('build-done.json has no branch')
  if (!/^[0-9a-f]{7,40}$/i.test(String(parsed.head ?? ''))) throw new Error('build-done.json has no head commit')
  return { card: parsed.card, branch: parsed.branch, head: parsed.head, startedAt: parsed.startedAt ?? null }
}

export function readPullDraft({ runDir, card }) {
  const paths = handoverPaths(runDir)
  const title = readFileSync(paths.title, 'utf8').trim()
  const body = readFileSync(paths.body, 'utf8').trim()
  if (!title) throw new Error(`the build wrote no pull request title to ${paths.title}`)
  if (!body) throw new Error(`the build wrote no pull request description to ${paths.body}`)
  const namesCard = new RegExp(`^Card:\\s*${card}\\s*$`, 'mi')
  if (!namesCard.test(body)) throw new Error(`the pull request description carries no "Card: ${card}" line`)
  return { title, body }
}

// Shipping may only start once every acceptance criterion has its own evidence
// comment. A criterion counts as proven when a comment starts
// `Prove It Works:` and quotes that criterion in the card's words.
export function missingEvidence(evidence, criteria) {
  return (criteria ?? []).filter((criterion) => !claimedBy(evidence, criterion))
}

function claimedBy(evidence, criterion) {
  const wanted = normalizeCriterion(criterion)
  if (!wanted) return true
  return (evidence ?? []).some((item) => {
    const body = String(item.body ?? '').trim()
    if (!body.toLowerCase().startsWith('prove it works:')) return false
    const said = normalizeCriterion(body.split('\n')[0].slice('prove it works:'.length))
    return Boolean(said) && (said.includes(wanted) || wanted.includes(said))
  })
}
