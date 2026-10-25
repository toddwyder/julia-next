import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  VERDICTS,
  REQUIRED_PLAYBOOK,
  parseCriteria,
  declaredPlaybook,
  playbookSteps,
  checkPlaybookConformity,
  nextStage,
  pickReviewer,
  parseVerdicts,
  formatVerdictNote,
  reviewPrompt,
  remediationPrompt,
  investigationPrompt,
} from '../evidence-review.mjs'

const playbook = name => readFile(new URL(`../../../.agents/skills/poteto-mode/playbooks/${name}.md`, import.meta.url), 'utf8')

const jul252 = {
  identifier: 'JUL-252',
  title: 'Automatic evidence review by a second company',
  description: `## Outcome

Every finished build's proof gets an adversarial check by a model from a different company before the card moves on.

## Acceptance criteria

* A model from a different company reviews each finished build's proof adversarially, starting from unproven and trying to break each claim, with nobody pressing anything.
* The Linear card shows a verdict per criterion: proven, unproven or wrong thing tested.
* When a review fails the card moves to Remediation for one round of defect fixing, then a fresh review; a second failure runs an Investigation and the card stops.

## Notes

* This line is outside the criteria section.
`,
}

const checklistFor = (playbookName, steps) =>
  [`Playbook: ${playbookName}`, ...steps.map((step, index) => `${index + 1}. ${step}`)].join('\n')

test('criteria come from the Acceptance criteria bullets of the saved card', () => {
  const criteria = parseCriteria(jul252)
  assert.deepEqual(criteria.map(item => item.criterion), [1, 2, 3])
  assert.match(criteria[0].text, /different company/)
  assert.match(criteria[2].text, /Investigation/)
  assert.ok(criteria.every(item => !item.text.startsWith('*')))
  assert.doesNotMatch(JSON.stringify(criteria), /outside the criteria/)
})

test('a card with no Acceptance criteria section is judged against its title alone', () => {
  assert.deepEqual(parseCriteria({ identifier: 'JUL-1', title: 'Keep the marker', description: 'Nothing structured.' }), [
    { criterion: 1, text: 'Keep the marker' },
  ])
})

test('the declared playbook is read from the checklist line and slugged', () => {
  assert.equal(declaredPlaybook('Playbook: Bug fix'), 'bug-fix')
  assert.equal(declaredPlaybook('# JUL-252 Evidence review. Playbook: Feature (poteto-mode playbooks/feature.md)'), 'feature')
  assert.equal(declaredPlaybook('## Remediation\n\nPlaybook: Investigation'), 'investigation')
  assert.equal(declaredPlaybook('- [ ] Write the verdicts'), null)
  assert.equal(declaredPlaybook(null), null)
})

test('top-level playbook steps are the numbered lines only', async () => {
  const steps = playbookSteps(await playbook('feature'))
  assert.equal(steps.length, 8)
  assert.match(steps[0], /^`how` over the affected subsystem\.$/)
  assert.ok(steps.every(step => !step.startsWith(' ')))
})

test('a checklist that copies the steps, skip note included, conforms', async () => {
  const steps = playbookSteps(await playbook('feature'))
  const checklist = checklistFor('Feature', steps).replace(steps[7], `${steps[7]} skip: publishing is out of scope`)
  assert.deepEqual(checkPlaybookConformity({ required: 'feature', declared: 'feature', playbookText: await playbook('feature'), checklistText: checklist }), { ok: true })
})

test('a checklist that follows another playbook is refused', async () => {
  const steps = playbookSteps(await playbook('feature'))
  const result = checkPlaybookConformity({ required: 'bug-fix', declared: 'feature', playbookText: await playbook('bug-fix'), checklistText: checklistFor('Feature', steps) })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'checklist follows feature, run requires bug-fix')
  assert.equal(checkPlaybookConformity({ required: 'bug-fix', declared: null, playbookText: '', checklistText: '# no declaration' }).reason, 'checklist follows no declared playbook, run requires bug-fix')
})

test('a checklist that drops a playbook step is refused at that step', async () => {
  const steps = playbookSteps(await playbook('feature'))
  const checklist = checklistFor('Feature', steps.filter((_, index) => index !== 3))
  const result = checkPlaybookConformity({ required: 'feature', declared: 'feature', playbookText: await playbook('feature'), checklistText: checklist })
  assert.equal(result.ok, false)
  assert.match(result.reason, /missing playbook step 4: /)
})

test('an empty or absent checklist is refused', async () => {
  const text = await playbook('feature')
  assert.deepEqual(checkPlaybookConformity({ required: 'feature', declared: 'feature', playbookText: text, checklistText: '   \n' }), { ok: false, reason: 'missing checklist' })
  assert.deepEqual(checkPlaybookConformity({ required: 'feature', declared: 'feature', playbookText: text, checklistText: null }), { ok: false, reason: 'missing checklist' })
})

test('checklist items may be shortened, out of the steps order they may not be, and extra items are allowed between', async () => {
  const text = await playbook('feature')
  const steps = playbookSteps(text)
  const shortened = ['Playbook: Feature', ...steps.slice(0, 3).map((step, index) => `${index + 1}. ${step}`), '- [x] an extra unrelated item', `4. ${steps[3].slice(0, 50)}`, ...steps.slice(4).map((step, index) => `${index + 5}. ${step}`)].join('\n')
  assert.deepEqual(checkPlaybookConformity({ required: 'feature', declared: 'feature', playbookText: text, checklistText: shortened }), { ok: true })
  const tooShort = checkPlaybookConformity({ required: 'feature', declared: 'feature', playbookText: text, checklistText: ['Playbook: Feature', '1. how o', `2. ${steps[1]}`, `3. ${steps[2]}`].join('\n') })
  assert.equal(tooShort.ok, false)
  assert.match(tooShort.reason, /missing playbook step 1/)
  const annotated = ['Playbook: Feature', ...steps.map((step, index) => `- [x] ${index + 1}. ${step.slice(0, 45)} (done: see decisions.tsv)`)].join('\n')
  assert.deepEqual(checkPlaybookConformity({ required: 'feature', declared: 'feature', playbookText: text, checklistText: annotated }), { ok: true })
  const firstSentences = ['Playbook: Feature', ...steps.map((step, index) => `- [x] ${index + 1}. ${step.split('. ')[0]}.`)].join('\n')
  assert.deepEqual(checkPlaybookConformity({ required: 'feature', declared: 'feature', playbookText: text, checklistText: firstSentences }), { ok: true })
  const stubs = checkPlaybookConformity({ required: 'feature', declared: 'feature', playbookText: text, checklistText: ['Playbook: Feature', ...steps.map((step, index) => `${index + 1}. ${step.slice(0, 20)}`)].join('\n') })
  assert.equal(stubs.ok, false)
  const reversed = checkPlaybookConformity({ required: 'feature', declared: 'feature', playbookText: text, checklistText: ['Playbook: Feature', `1. ${steps[1]}`, `2. ${steps[0]}`].join('\n') })
  assert.equal(reversed.ok, false)
  assert.match(reversed.reason, /missing playbook step 2/)
})

test('remediation conforms to the real Bug fix playbook and investigation to the real Investigation playbook', async () => {
  const bugFix = await playbook('bug-fix')
  const bugSteps = playbookSteps(bugFix)
  assert.ok(bugSteps.length >= 6)
  const bugChecklist = checklistFor('Bug fix', bugSteps).replace(bugSteps[5], `${bugSteps[5]} skip: publishing is out of scope`)
  assert.deepEqual(checkPlaybookConformity({ required: REQUIRED_PLAYBOOK.remediation, declared: declaredPlaybook(bugChecklist), playbookText: bugFix, checklistText: bugChecklist }), { ok: true })
  const investigation = await playbook('investigation')
  const investigationChecklist = checklistFor('Investigation', playbookSteps(investigation))
  assert.deepEqual(checkPlaybookConformity({ required: REQUIRED_PLAYBOOK.investigation, declared: declaredPlaybook(investigationChecklist), playbookText: investigation, checklistText: investigationChecklist }), { ok: true })
  const wrong = checkPlaybookConformity({ required: REQUIRED_PLAYBOOK.remediation, declared: declaredPlaybook(investigationChecklist), playbookText: bugFix, checklistText: investigationChecklist })
  assert.equal(wrong.ok, false)
  assert.match(wrong.reason, /run requires bug-fix/)
})

test('the stage table advances review, remediation, review, investigation, stopped', () => {
  const review = passed => ({ stage: 'review', round: 1, passed })
  const remediation = { stage: 'remediation', playbook: 'bug-fix' }
  const investigation = { stage: 'investigation', playbook: 'investigation', rootCause: '# cause' }
  assert.equal(nextStage([]), 'review')
  assert.equal(nextStage(undefined), 'review')
  assert.equal(nextStage([review(false)]), 'remediation')
  assert.equal(nextStage([review(false), remediation]), 'review')
  assert.equal(nextStage([review(false), remediation, review(false)]), 'investigation')
  assert.equal(nextStage([review(false), remediation, review(false), investigation]), 'stopped')
  assert.equal(nextStage([review(true)]), 'passed')
  assert.equal(nextStage([review(false), remediation, review(true)]), 'passed')
})

test('the reviewer is the first candidate from a company the builders do not use', () => {
  const models = {
    'anthropic/claude-haiku-5-5': { company: 'Anthropic' },
    'commandcode/deepseek/deepseek-v4.1-flash': { company: 'DeepSeek' },
    'commandcode/qwen/qwen3.6-max-preview': { company: 'Alibaba' },
    'openai/gpt-5.3-codex': { company: 'OpenAI' },
    'openai/gpt-6-sol': { company: 'OpenAI' },
  }
  const builderModels = ['anthropic/claude-haiku-5-5', 'commandcode/deepseek/deepseek-v4.1-flash']
  const reviewers = ['commandcode/qwen/qwen3.6-max-preview', 'openai/gpt-6-sol', 'openai/gpt-5.3-codex']
  assert.deepEqual(pickReviewer({ models, candidates: reviewers, builderModels }), { model: 'commandcode/qwen/qwen3.6-max-preview', company: 'Alibaba' })
  assert.deepEqual(pickReviewer({ models, candidates: reviewers, builderModels: [...builderModels, 'commandcode/qwen/qwen3.6-max-preview'] }), { model: 'openai/gpt-6-sol', company: 'OpenAI' })
  assert.equal(pickReviewer({ models, candidates: ['commandcode/qwen/qwen3.6-max-preview'], builderModels: [...builderModels, 'commandcode/qwen/qwen3.6-max-preview'] }), null)
  assert.equal(pickReviewer({ models: { ...models, 'openai/gpt-6-sol': { company: 'OpenAI', unavailable: 'no credential' } }, candidates: ['openai/gpt-6-sol'], builderModels }), null)
  assert.deepEqual(pickReviewer({ models, candidates: ['missing/model', 'openai/gpt-6-sol'], builderModels }), { model: 'openai/gpt-6-sol', company: 'OpenAI' })
  assert.deepEqual(pickReviewer({ models, candidates: ['openai/gpt-6-sol'], builderModels: ['never/configured'] }), { model: 'openai/gpt-6-sol', company: 'OpenAI' })
})

test('a builder model missing from the catalogue blocks only its own key, never a company', () => {
  const models = { 'openai/gpt-6-sol': { company: 'OpenAI' }, 'never/configured': { company: 'OpenAI' } }
  assert.equal(pickReviewer({ models, candidates: ['openai/gpt-6-sol'], builderModels: ['never/configured'] }), null)
  assert.deepEqual(pickReviewer({ models, candidates: ['openai/gpt-6-sol'], builderModels: ['gone/model'] }), { model: 'openai/gpt-6-sol', company: 'OpenAI' })
})

const criteria = parseCriteria(jul252)
const verdictFor = (criterion, verdict, proofFile = 'proof/none.txt', reason = 'reason') => ({ criterion, verdict, proofFile, reason })
test('no readable verdicts leave every criterion unproven', () => {
  for (const raw of [null, '', 'not json at all', '{"verdicts":"proven"}']) {
    const result = parseVerdicts({ raw, criteria, proofFileExists: () => false })
    assert.equal(result.passed, false)
    assert.equal(result.verdicts.length, 3)
    assert.deepEqual(result.verdicts.map(entry => entry.verdict), ['unproven', 'unproven', 'unproven'])
    assert.deepEqual(new Set(result.verdicts.map(entry => entry.reason)), new Set(['reviewer wrote no readable verdicts']))
  }
})

test('an omitted criterion, a bogus verdict and an unreachable proof file all fail', () => {
  const raw = JSON.stringify({
    verdicts: [verdictFor(1, 'proven', 'proof/marker.txt'), verdictFor(2, 'maybe'), verdictFor(9, 'proven', 'proof/marker.txt')],
  })
  const result = parseVerdicts({ raw, criteria, proofFileExists: path => path === 'proof/marker.txt' })
  assert.equal(result.passed, false)
  assert.deepEqual(result.verdicts.map(entry => entry.verdict), ['proven', 'unproven', 'unproven'])
  assert.equal(result.verdicts[2].reason, 'reviewer gave no verdict')
  assert.match(result.verdicts[1].reason, /not recognised: maybe/)
  assert.equal(result.problems.length, 1)
  assert.equal(result.problems[0].criterion, 9)
})

test('a proven verdict needs a relative proof file that exists inside the export', () => {
  const missing = parseVerdicts({ raw: JSON.stringify({ verdicts: [verdictFor(1, 'proven', 'proof/missing.txt')] }), criteria, proofFileExists: () => false })
  assert.equal(missing.verdicts[0].verdict, 'unproven')
  assert.equal(missing.verdicts[0].reason, 'proof file not found: proof/missing.txt')
  assert.equal(missing.verdicts[0].proofFile, 'proof/missing.txt')
  for (const proofFile of ['/etc/passwd', '../outside.txt', 'proof/../tree.txt']) {
    const result = parseVerdicts({ raw: JSON.stringify({ verdicts: [verdictFor(1, 'proven', proofFile)] }), criteria, proofFileExists: () => true })
    assert.equal(result.verdicts[0].verdict, 'unproven')
    assert.equal(result.verdicts[0].reason, `proof file not found: ${proofFile}`)
  }
  const noFile = parseVerdicts({ raw: JSON.stringify({ verdicts: [{ criterion: 1, verdict: 'proven' }] }), criteria, proofFileExists: () => true })
  assert.equal(noFile.verdicts[0].reason, 'proof file not found: none')
})

test('every criterion proven with a real proof file is the only way to pass', () => {
  const raw = JSON.stringify({ verdicts: [verdictFor(1, 'proven', 'proof/a.txt'), verdictFor(2, 'wrong thing tested', 'proof/b.txt'), verdictFor(3, 'unproven')] })
  assert.equal(parseVerdicts({ raw, criteria, proofFileExists: () => true }).passed, false)
  const allProven = JSON.stringify({ verdicts: criteria.map(item => verdictFor(item.criterion, 'proven', `proof/${item.criterion}.txt`)) })
  const result = parseVerdicts({ raw: allProven, criteria, proofFileExists: () => true })
  assert.equal(result.passed, true)
  assert.deepEqual(result.problems, [])
  assert.equal(parseVerdicts({ raw: JSON.stringify({ verdicts: [] }), criteria: [], proofFileExists: () => true }).passed, false)
})

test('the Linear note names the reviewer, the candidate and every verdict word', () => {
  const verdicts = [
    { criterion: 1, text: 'The reviewer starts unproven.', verdict: 'proven', proofFile: 'proof/a.txt', reason: 'ran it' },
    { criterion: 2, text: 'The card shows each verdict.', verdict: 'wrong thing tested', proofFile: 'proof/b.txt', reason: 'tested the runner instead' },
    { criterion: 3, text: 'A failure runs Remediation.', verdict: 'unproven', proofFile: null, reason: 'no checklist' },
  ]
  const note = formatVerdictNote({ cardId: 'JUL-252', round: 2, reviewer: { model: 'openai/gpt-6-sol', company: 'OpenAI' }, candidateCommit: 'abcdef0123456789', verdicts, passed: false, next: 'investigation' })
  assert.match(note, /Evidence review 2 for JUL-252: failed/)
  assert.match(note, /openai\/gpt-6-sol \(OpenAI\)\. Candidate abcdef012345/)
  for (const word of VERDICTS) assert.match(note, new RegExp(`\\*\\*${word}\\*\\*`))
  assert.match(note, /\(proof: none\)/)
  assert.match(note, /Next: investigation/)
  assert.match(formatVerdictNote({ cardId: 'JUL-252', round: 1, reviewer: { model: 'a', company: 'b' }, candidateCommit: 'c', verdicts: [], passed: true, next: 'passed' }), /Evidence review 1 for JUL-252: passed/)
})

test('the three stage prompts carry what the run has to follow', () => {
  const review = reviewPrompt({ card: jul252, criteria, round: 1 })
  assert.match(review, /evidence reviewer/)
  assert.match(review, /adversarial-review\/SKILL\.md/)
  assert.match(review, /every criterion starts unproven/i)
  assert.match(review, /wrong thing tested/)
  assert.match(review, /\.builder-home\/proof\//)
  assert.match(review, /\.builder-home\/review\/verdicts\.json/)
  assert.match(review, /never edit the tree/i)
  assert.match(review, /1\. A model from a different company/)
  assert.match(review, /3\. When a review fails/)
  const remediation = remediationPrompt({ card: jul252, verdicts: [{ criterion: 2, verdict: 'unproven', text: 'The card shows each verdict.', reason: 'no comment' }, { criterion: 1, verdict: 'proven', text: 'ignored', reason: '' }] })
  assert.match(remediation, /Remediation round for JUL-252/)
  assert.match(remediation, /Bug fix playbook/)
  assert.match(remediation, /Playbook: Bug fix/)
  assert.match(remediation, /criterion 2 \(unproven\)/)
  assert.doesNotMatch(remediation, /criterion 1 \(/)
  assert.match(remediation, /publishing is out of scope/i)
  const investigation = investigationPrompt({ card: jul252, history: [{ stage: 'review', round: 1, passed: false, verdicts: [{ criterion: 1, verdict: 'unproven', text: 'first criterion', proofFile: null, reason: 'nope' }] }, { stage: 'remediation', playbook: 'bug-fix' }, { stage: 'review', round: 2, passed: false, verdicts: [{ criterion: 2, verdict: 'wrong thing tested', text: 'second criterion', proofFile: 'proof/x.txt', reason: 'other surface' }] }] })
  assert.match(investigation, /Investigation playbook/)
  assert.match(investigation, /Playbook: Investigation/)
  assert.match(investigation, /read-only: change no tracked files/)
  assert.match(investigation, /root-cause\.md/)
  assert.match(investigation, /Evidence review round 1: failed/)
  assert.match(investigation, /Evidence review round 2: failed/)
  assert.match(investigation, /wrong thing tested/)
})

test('review findings: empty playbooks, decorated declarations, nested criteria and conflicting verdicts', () => {
  assert.deepEqual(checkPlaybookConformity({ required: 'opening-a-pr', declared: 'opening-a-pr', playbookText: 'No numbered steps.', checklistText: 'Playbook: Opening a PR\n- [x] 1. fed the cat' }), { ok: false, reason: 'playbook opening-a-pr has no numbered steps' })
  for (const line of ['Playbook: Bug fix.', 'Playbook: **Bug fix**', 'Playbook: Bug fix, remediation round', 'Playbook: Feature (poteto-mode playbooks/feature.md)']) {
    assert.ok(['bug-fix', 'feature'].includes(declaredPlaybook(line)), line)
  }
  const nested = parseCriteria({ title: 'T', description: '## Acceptance criteria\n\n- [ ] The saved card resumes\n  - after a pause, with the same thread\n* Second.' })
  assert.deepEqual(nested.map(item => item.text), ['The saved card resumes', 'Second.'])
  assert.deepEqual(parseCriteria({ title: 'Only prose', description: '## Acceptance criteria\n\nIt works.' }), [{ criterion: 1, text: 'Only prose' }])
  const one = [{ criterion: 1, text: 'One' }]
  const raw = JSON.stringify({ verdicts: [{ criterion: 1, verdict: 'proven', proofFile: 'a.md' }, { criterion: 1, verdict: 'unproven', reason: 'broken' }] })
  const result = parseVerdicts({ raw, criteria: one, proofFileExists: () => true })
  assert.equal(result.passed, false)
  assert.equal(result.verdicts[0].reason, 'reviewer gave more than one verdict')
})
