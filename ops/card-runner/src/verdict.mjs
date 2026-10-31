// The verdict is the shape docs/adr/0026-shipping-verdict-gate.md reads from a
// PR comment. Shipping writes it to a file; the runner validates it before
// posting anything, so a malformed free-model answer never becomes the newest
// verdict on a pull request.
export const VERDICT_VERSION = 1

export function parseVerdict(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return { ok: false, errors: ['no verdict file was written'] }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, errors: ['the verdict file is not JSON'] }
  }
  return parseVerdictObject(parsed)
}

export function parseVerdictObject(parsed) {
  const errors = []
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, errors: ['the verdict is not an object'] }
  if (parsed.juliaShippingVerdict !== VERDICT_VERSION) errors.push('juliaShippingVerdict must be 1')
  if (typeof parsed.card !== 'string' || !parsed.card.trim()) errors.push('card is missing')
  if (typeof parsed.head !== 'string' || !/^[0-9a-f]{7,40}$/i.test(parsed.head)) errors.push('head is not a commit')
  if (!['PASS', 'FAIL'].includes(parsed.verdict)) errors.push('verdict must be PASS or FAIL')
  if (typeof parsed.builder !== 'string' || !parsed.builder.trim()) errors.push('builder is missing')
  if (typeof parsed.verifier !== 'string' || !parsed.verifier.trim()) errors.push('verifier is missing')
  if (parsed.builder && parsed.verifier && parsed.builder === parsed.verifier) errors.push('builder and verifier are the same')
  if (!Array.isArray(parsed.criteria) || parsed.criteria.length === 0) {
    errors.push('criteria is empty')
  } else {
    parsed.criteria.forEach((item, index) => {
      if (!item || typeof item !== 'object') { errors.push(`criterion ${index + 1} is not an object`); return }
      if (typeof item.criterion !== 'string' || !item.criterion.trim()) errors.push(`criterion ${index + 1} has no wording`)
      if (!['PASS', 'FAIL'].includes(item.verdict)) errors.push(`criterion ${index + 1} is not PASS or FAIL`)
      if (typeof item.note !== 'string' || !item.note.trim()) errors.push(`criterion ${index + 1} has no note`)
    })
    const verdicts = parsed.criteria.map((item) => item?.verdict)
    if (parsed.verdict === 'PASS' && verdicts.some((verdict) => verdict !== 'PASS')) errors.push('a PASS verdict has a criterion that did not pass')
    if (parsed.verdict === 'FAIL' && !verdicts.includes('FAIL')) errors.push('a FAIL verdict has no failing criterion')
  }
  return { ok: errors.length === 0, errors, verdict: parsed }
}

const CRITERIA_HEADING = /^\s*(?:#{1,6}\s*)?(?:acceptance criteria|acceptance|done means|done when|done)\s*:?\s*$/i

export function criteriaFrom(description) {
  const lines = String(description ?? '').split('\n')
  const start = lines.findIndex((line) => CRITERIA_HEADING.test(line))
  if (start === -1) return []
  const criteria = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue
    if (/^#{1,6}\s+/.test(lines[index]) || /^[A-Z][^\n]{0,50}:$/.test(line)) break
    const bullet = line.match(/^(?:[-*]|\d+[.)])\s+(.*)$/)
    if (bullet) criteria.push(bullet[1].trim())
    else if (criteria.length) break
  }
  return criteria
}

export function normalizeCriterion(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[`*_"'’]+/g, '')
    .replace(/[.;:]+$/, '')
    .trim()
    .toLowerCase()
}

// Every criterion the card names has to appear in the verdict, or Shipping has
// not answered the card it was handed. Shipping may quote the criterion with a
// word or two of its own, so a containment match counts.
export function coversCriteria(verdict, expected) {
  if (!expected?.length) return { ok: true, missing: [] }
  const answered = verdict.criteria.map((item) => normalizeCriterion(item.criterion))
  const missing = expected.filter((criterion) => {
    const wanted = normalizeCriterion(criterion)
    return !answered.some((answer) => answer === wanted || answer.includes(wanted) || wanted.includes(answer))
  })
  return { ok: missing.length === 0, missing }
}

function modelKey(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// A judge sometimes names the model it ran in readable words instead of the id
// the runner started. One part of the id matching is enough to say it is that
// model; a judge that reports another model still fails.
function sameModel(reported, expected) {
  const got = modelKey(reported)
  if (!got) return false
  const id = String(expected ?? '')
  const parts = new Set([id, ...id.split('/'), id.split(':')[0]])
  for (const part of parts) {
    const key = modelKey(part)
    if (key.length >= 5 && got.length >= 5 && (got === key || got.endsWith(key) || key.endsWith(got))) return true
  }
  return false
}

export function validateVerdict(parsed, { card, head, verifier, expectedCriteria = [] }) {
  const result = parseVerdictObject(parsed)
  const errors = [...result.errors]
  if (result.verdict) {
    if (result.verdict.card !== card) errors.push(`card is ${result.verdict.card}, expected ${card}`)
    if (result.verdict.head !== head) errors.push(`head is ${result.verdict.head}, expected ${head}`)
    if (verifier && !sameModel(result.verdict.verifier, verifier)) errors.push(`verifier is ${result.verdict.verifier}, expected ${verifier}`)
    const covered = coversCriteria(result.verdict, expectedCriteria)
    for (const criterion of covered.missing) errors.push(`no verdict for: ${criterion}`)
  }
  return { ok: errors.length === 0, errors, verdict: result.verdict }
}
