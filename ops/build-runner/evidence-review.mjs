import { isAbsolute } from 'node:path'

export const VERDICTS = ['proven', 'unproven', 'wrong thing tested']
export const REQUIRED_PLAYBOOK = { remediation: 'bug-fix', investigation: 'investigation' }
const BUILD_PLAYBOOK_BY_LABEL = {
  feature: 'feature',
  refactoring: 'refactoring',
  'bug fix': 'bug-fix',
  'bug-fix': 'bug-fix',
  'perf issue': 'perf-issue',
  hillclimb: 'hillclimb',
}

export function requiredBuildPlaybook(card) {
  for (const label of card?.labels ?? []) {
    const slug = String(label).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (BUILD_PLAYBOOK_BY_LABEL[slug]) return BUILD_PLAYBOOK_BY_LABEL[slug]
  }
  return null
}

export function requiredPlaybookForRun({ card, history }) {
  const lastRun = (history ?? []).filter(entry => entry?.stage !== 'review').at(-1)
  if (lastRun?.stage === 'remediation') return REQUIRED_PLAYBOOK.remediation
  if (lastRun?.stage === 'investigation') return REQUIRED_PLAYBOOK.investigation
  return requiredBuildPlaybook(card)
}

const CRITERIA_HEADING = /^#+\s*acceptance criteria/i
const ANY_HEADING = /^#{1,6}\s+/
const BULLET = /^(?:[*+-]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/

const cardLabel = card => [card?.identifier ?? card?.id, card?.title].filter(Boolean).join(' ')

export function parseCriteria(card) {
  const lines = String(card?.description ?? '').split(/\r?\n/)
  const start = lines.findIndex(line => CRITERIA_HEADING.test(line))
  if (start === -1) return card?.title ? [{ criterion: 1, text: String(card.title).trim() }] : []
  const criteria = []
  for (const line of lines.slice(start + 1)) {
    if (ANY_HEADING.test(line)) break
    const bullet = BULLET.exec(line)
    if (!bullet) continue
    const text = bullet[1].trim()
    if (text) criteria.push({ criterion: criteria.length + 1, text })
  }
  return criteria.length || !card?.title ? criteria : [{ criterion: 1, text: String(card.title).trim() }]
}

export function nextStage(history) {
  const stages = Array.isArray(history) ? history : []
  if (!stages.length) return 'review'
  const last = stages[stages.length - 1]
  if (last?.stage === 'review') {
    if (last.passed) return 'passed'
    return stages.filter(entry => entry?.stage === 'review').length >= 2 ? 'investigation' : 'remediation'
  }
  if (last?.stage === 'remediation') return 'review'
  return 'stopped'
}

export function pickReviewer({ models, candidates, builderModels }) {
  const specs = models ?? {}
  const builderCompanies = new Set((builderModels ?? []).map(model => specs[model]?.company ?? model))
  for (const candidate of candidates ?? []) {
    const spec = specs[candidate]
    if (!spec?.company || spec.unavailable) continue
    if (builderCompanies.has(spec.company)) continue
    return { model: candidate, company: spec.company }
  }
  return null
}

function usableProofFile(proofFile, proofFileExists) {
  if (!proofFile) return false
  if (isAbsolute(proofFile)) return false
  if (proofFile.split('/').includes('..')) return false
  return Boolean(proofFileExists?.(proofFile))
}

export function parseVerdicts({ raw, criteria, proofFileExists }) {
  const list = Array.isArray(criteria) ? criteria : []
  const problems = []
  let reported = []
  try {
    const parsed = raw == null ? null : JSON.parse(raw)
    if (Array.isArray(parsed?.verdicts)) reported = parsed.verdicts
    else if (parsed != null) problems.push({ reason: 'verdicts.json has no verdicts array' })
  } catch (error) {
    problems.push({ reason: `verdicts.json is not readable JSON: ${error.message}` })
  }
  const byCriterion = new Map()
  const conflicting = new Set()
  for (const entry of reported) {
    const number = entry?.criterion
    if (!Number.isInteger(number) || !list.some(item => item.criterion === number)) {
      problems.push({ ...entry, reason: entry?.reason ?? '', problem: 'unknown criterion' })
      continue
    }
    if (byCriterion.has(number)) {
      problems.push({ ...entry, problem: 'duplicate criterion' })
      conflicting.add(number)
      continue
    }
    byCriterion.set(number, entry)
  }
  const noReadable = !reported.length
  const verdicts = list.map(item => {
    const base = { criterion: item.criterion, text: item.text, proofFile: null, reason: '' }
    if (noReadable) return { ...base, verdict: 'unproven', reason: 'reviewer wrote no readable verdicts' }
    const entry = byCriterion.get(item.criterion)
    if (!entry) return { ...base, verdict: 'unproven', reason: 'reviewer gave no verdict' }
    if (conflicting.has(item.criterion)) return { ...base, verdict: 'unproven', reason: 'reviewer gave more than one verdict' }
    const proofFile = typeof entry.proofFile === 'string' && entry.proofFile.trim() ? entry.proofFile.trim() : null
    if (!VERDICTS.includes(entry.verdict)) {
      return { ...base, proofFile, verdict: 'unproven', reason: `reviewer verdict not recognised: ${String(entry.verdict)}` }
    }
    if (entry.verdict === 'proven' && !usableProofFile(proofFile, proofFileExists)) {
      return { ...base, proofFile, verdict: 'unproven', reason: `proof file not found: ${proofFile ?? 'none'}` }
    }
    return { ...base, proofFile, verdict: entry.verdict, reason: String(entry.reason ?? '') }
  })
  const passed = verdicts.length > 0 && verdicts.every(entry => entry.verdict === 'proven')
  return { verdicts, passed, problems }
}

export function formatVerdictNote({ cardId, round, reviewer, candidateCommit, verdicts, passed, next }) {
  const lines = [
    `## Evidence review ${round} for ${cardId}: ${passed ? 'passed' : 'failed'}`,
    '',
    `Reviewer: ${reviewer?.model ?? 'unknown'} (${reviewer?.company ?? 'unknown'}). Candidate ${String(candidateCommit ?? '').slice(0, 12)}.`,
    '',
  ]
  for (const entry of verdicts ?? []) {
    const reason = entry.reason ? ` ${entry.reason}` : ''
    lines.push(`- ${entry.criterion}. **${entry.verdict}**: ${entry.text} (proof: ${entry.proofFile ?? 'none'}).${reason}`)
  }
  lines.push('', `Next: ${next}`)
  return lines.join('\n')
}

export function reviewPrompt({ card, criteria, round, requiredPlaybook, playbookText }) {
  const playbook = requiredPlaybook
    ? `This run must follow the ${requiredPlaybook} playbook. Its full text is given here:

--- playbook ${requiredPlaybook} ---
${String(playbookText ?? '').trim()}
--- end playbook ${requiredPlaybook} ---

Judge playbook adherence as part of this review. Read the run's checklist at \`.builder-home/proof/checklist.md\` and the candidate diff at \`.builder-home/proof/diff.patch\`. If the checklist follows a different playbook, or the work skips or omits the playbook's numbered steps, every criterion is unproven. A step the host has marked out of scope is not skipped work: the host owns publishing and pull requests, so an out-of-scope note on the Opening a PR step does not make a criterion unproven.`
    : `This card does not require a specific playbook. The run's checklist is at \`.builder-home/proof/checklist.md\` and the candidate diff is at \`.builder-home/proof/diff.patch\`.`
  return `You are the evidence reviewer for ${cardLabel(card)}. Follow .agents/skills/adversarial-review/SKILL.md in this working directory.

This is evidence review round ${round}. Judge the criteria below and playbook adherence against the evidence supplied. Every criterion starts unproven. Try to break each claim. A criterion is proven only by a named proof file that shows the criterion holding where Todd uses the result. Testing something other than the criterion is "wrong thing tested". Never edit the tree.

The proof is the \`.builder-home/proof/\` folder: an export of the candidate commit plus the committed files.

${playbook}

Write \`.builder-home/review/verdicts.json\` exactly as:
{"verdicts":[{"criterion":1,"verdict":"proven|unproven|wrong thing tested","proofFile":"relative/path","reason":"..."}]}

Criteria:
${(criteria ?? []).map(item => `${item.criterion}. ${item.text}`).join('\n')}`
}

export function remediationPrompt({ card, verdicts }) {
  const defects = (verdicts ?? []).filter(entry => entry?.verdict !== 'proven')
  return `This is a Remediation round for ${cardLabel(card)}. Follow poteto-mode's Bug fix playbook (.agents/skills/poteto-mode/playbooks/bug-fix.md).

The checklist at .builder-home/pstack/checklist.md must start with the line \`Playbook: Bug fix\` and follow that playbook.

The defects are the failed evidence verdicts:
${defects.map(entry => `- criterion ${entry.criterion} (${entry.verdict}): ${entry.text}. ${entry.reason ?? ''}`.trimEnd()).join('\n')}

Fix them in this worktree. Publishing is out of scope.`
}

export function investigationPrompt({ card, history }) {
  const reviews = (history ?? []).filter(entry => entry?.stage === 'review')
  const rounds = reviews.map((entry, index) => {
    const bullets = (entry.verdicts ?? []).map(item => `- ${item.criterion}. **${item.verdict}**: ${item.text} (proof: ${item.proofFile ?? 'none'}). ${item.reason ?? ''}`.trimEnd())
    return `Evidence review round ${entry.round ?? index + 1}: ${entry.passed ? 'passed' : 'failed'}\n${bullets.join('\n')}`
  })
  return `The second evidence review failed for ${cardLabel(card)}. Follow poteto-mode's Investigation playbook (.agents/skills/poteto-mode/playbooks/investigation.md).

The checklist at .builder-home/pstack/checklist.md must start with \`Playbook: Investigation\` and follow that playbook.

This run is read-only: change no tracked files. Write the root cause to .builder-home/investigation/root-cause.md.

${rounds.join('\n\n')}`
}
