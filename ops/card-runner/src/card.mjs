// Everything the workflow needs from outside itself: the card on Linear, a
// checkout for the build, the pull request the build opens, and the places a
// verdict goes back to. Each function takes its collaborators so tests can run
// the whole workflow without a network or a repository.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getIssue, postComment } from '../../../scripts/linear-cli.mjs'

export function linearOptions(apiKey = process.env.LINEAR_API_KEY) {
  if (!apiKey) throw new Error('LINEAR_API_KEY is not set; run through node scripts/julia-agents.mjs --')
  return { apiKey }
}

export function normalizeCard(issue) {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? '',
    url: issue.url,
    labels: (issue.labels?.nodes ?? []).map((label) => label.name),
    comments: issue.comments?.nodes ?? [],
  }
}

export async function loadCard(identifier, { apiKey } = {}) {
  const issue = await getIssue(identifier, { includeComments: true, ...linearOptions(apiKey) })
  if (!issue) throw new Error(`Linear returned no card for ${identifier}`)
  return normalizeCard(issue)
}

export function runCommand(command, args, { cwd, env = process.env, exec = execFileSync } = {}) {
  const clean = { ...env }
  delete clean.CLICOLOR_FORCE
  delete clean.GH_FORCE_TTY
  return String(exec(command, args, { cwd, env: clean, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).trim()
}

export function branchFor(card) {
  const number = String(card.identifier).replace(/^JUL-/i, '')
  if (!/^\d+$/.test(number)) throw new Error(`${card.identifier} is not a JUL card id`)
  return `runner/card-${number}`
}

export function tryCommand(command, args, options) {
  try {
    return runCommand(command, args, options)
  } catch {
    return ''
  }
}

// Each run gets its own worktree so a build cannot disturb the checkout a
// person is working in, and the branch is rebuilt from main every time. A rerun
// clears yesterday's worktree and branch first, or git refuses to make them.
export function prepareCheckout({ repoDir, card, runDir, exec }) {
  const branch = branchFor(card)
  const checkout = join(runDir, 'checkout')
  mkdirSync(runDir, { recursive: true })
  tryCommand('git', ['worktree', 'remove', '--force', checkout], { cwd: repoDir, exec })
  tryCommand('git', ['branch', '-D', branch], { cwd: repoDir, exec })
  runCommand('git', ['fetch', 'origin', 'main'], { cwd: repoDir, exec })
  runCommand('git', ['worktree', 'add', '-B', branch, checkout, 'origin/main'], { cwd: repoDir, exec })
  return { branch, checkout }
}

export function findPull({ repoDir, branch, exec }) {
  const text = runCommand('gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,headRefOid,url,title,commits'], { cwd: repoDir, exec })
  const pulls = JSON.parse(text || '[]')
  if (!pulls.length) return null
  const pull = pulls[0]
  const first = pull.commits?.[0] ?? {}
  const builder = first.authors?.[0]?.login ?? first.author?.login ?? first.authors?.[0]?.name ?? ''
  return { number: pull.number, head: pull.headRefOid, url: pull.url, title: pull.title, builder }
}

export function requirePull(options) {
  const pull = findPull(options)
  if (!pull) throw new Error(`the build did not open a pull request from ${options.branch}`)
  return pull
}

export function postCardComment(identifier, body, { apiKey } = {}) {
  return postComment(identifier, body, linearOptions(apiKey))
}

export function postPullComment({ repoDir, number, body, exec }) {
  const file = join(mkdtempSync(join(tmpdir(), 'card-runner-pr-')), 'comment.md')
  writeFileSync(file, body)
  return runCommand('gh', ['pr', 'comment', String(number), '--body-file', file], { cwd: repoDir, exec })
}
