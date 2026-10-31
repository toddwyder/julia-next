import { criteriaFrom } from './verdict.mjs'

export const UNATTENDED = `This run is unattended. No question and no approval can be answered, and asking for one ends the run with nothing judged. Do not call request_access or submit_plan, and stay inside the checkout you are in. The model and effort are already chosen for you, so skip the model files AGENTS.md points at.`

export function cardSection(card) {
  return `# Card ${card.identifier}: ${card.title}

${card.description ?? ''}

Card: ${card.url}`
}

function labelNames(card) {
  const names = (card.labels ?? []).map((label) => (typeof label === 'string' ? label : label?.name)).filter(Boolean)
  return names.join(', ') || 'none'
}

export function buildPrompt({ card, branch, runDir }) {
  return `You are the build session for one Linear card. Work only in this checkout, on branch ${branch}, which was created from origin/main for you.

${cardSection(card)}

${UNATTENDED}

Read AGENTS.md, then docs/plans/path-forward.md. Activate the poteto-mode skill and follow the playbook its table names for this card's label (${labelNames(card)}).

Finish this card on this branch:
- Change the code so every acceptance criterion above is met. If a criterion is already met, change nothing for it and say what you saw.
- Run the checks that prove it: the repository's own test and lint commands for the area you touched.
- Commit and push the work on this branch.

Hand the pull request to the runner, which publishes it for you:
- Write the title to ${runDir}/pr/title.txt as one line, ending with (${card.identifier}).
- Write the description to ${runDir}/pr/body.md. It must carry a line exactly: Card: ${card.identifier}
- Do not open or edit the pull request yourself.

Say you are done by writing ${runDir}/build-done.json, after your last push:
{"card":"${card.identifier}","branch":"${branch}","head":"<sha of the pushed head commit>","startedAt":"<ISO time this session started>"}

Get the head with \`git rev-parse HEAD\`. That file is the only signal the runner waits for; until it exists, Shipping does not start. Write it last, once every criterion below has its evidence.

Post the evidence Shipping will judge, with no one in between:
- For every acceptance criterion, post one Linear comment with \`node scripts/linear-cli.mjs comment ${card.identifier} --file <path>\` (LINEAR_API_KEY is already in your environment).
- Each comment starts with \`Prove It Works: <the criterion in the card's words>\`, then what you ran and what you saw. Name the exact command and its result. A summary is not evidence.
- The runner checks every criterion has its own comment before Shipping starts, and sends you back with the missing list if one does not.
- Do not merge the pull request and do not move the card. Shipping decides, and a person gives UAT.

Print what changed, the branch, and which criterion Shipping should look at first.`
}

export function buildBackPrompt({ card, branch, runDir, missing }) {
  return `You are the build session for one Linear card, back before Shipping starts because some criteria have no evidence yet. Work only in this checkout, on branch ${branch}.

${cardSection(card)}

${UNATTENDED}

These acceptance criteria have no \`Prove It Works:\` comment on the card:
${missing.map((criterion) => `- ${criterion}`).join('\n')}

For each one:
- If the code does not yet do it, finish the code, run the repository's checks, commit and push on this branch.
- Prove it in one Linear comment with \`node scripts/linear-cli.mjs comment ${card.identifier} --file <path>\`. The comment starts with \`Prove It Works: <the criterion in the card's words>\`, then the exact command you ran and the result you saw.

Then rewrite ${runDir}/build-done.json with the new head commit from \`git rev-parse HEAD\` and the same card and branch. Do not open or edit the pull request, do not merge, and do not move the card.`
}

export function shippingPrompt({ card, evidence, verifierModel, verdictPath, final, pull }) {
  const pass = final ? 'final' : 'first'
  const criteria = criteriaFrom(card.description ?? '')
  const criteriaList = criteria.map((criterion, index) => `${index + 1}. ${criterion}`).join('\n')
  return `You are Shipping. You did not build this card, and you have never seen the build session's conversation. Judge only what you can run and read for yourself.

${cardSection(card)}

## The criteria, in the card's words

A verdict answers these one by one, in this order. Copy each line character for character; do not merge or drop a line.

${criteriaList}

${pull ? `The pull request to judge is ${pull.url} (number ${pull.number}), and its head commit at the time this run started was ${pull.head}.` : ''}

## The evidence the build posted

${evidence}

Each block names the Linear comment it came from. Read any of them yourself before you judge it: \`node scripts/linear-cli.mjs comments ${card.identifier}\`.

${UNATTENDED}

Do not trust the evidence or any summary in it. Run the change yourself:
- Read the pull request diff and the code it touches.
- Build or start a copy of the change and drive it the way a person would. For a dashboard change use a free port; for the Julia app use a preview address; otherwise run the repository's own checks.
- Read the page logs, the command output and the tests. If a criterion cannot be checked, mark it FAIL.

Answer every acceptance criterion above with PASS or FAIL and one note saying exactly what you ran and saw. A criterion judged from a description alone is a FAIL.

Every FAIL note carries its reason in three parts: the command or action you ran, what you expected, and what you saw instead. A FAIL note without all three is not a usable reason.

This is the ${pass} Shipping pass and it runs on ${verifierModel}.

Write your verdict to this absolute path, and print it too:
${verdictPath}

The file holds one JSON object, nothing else:
{"juliaShippingVerdict":1,"card":"${card.identifier}","head":"<the pull request's head commit sha>","verdict":"PASS","builder":"<the GitHub login of the head commit's author>","verifier":"${verifierModel}","criteria":[{"criterion":"<the card's criterion in its own words>","verdict":"PASS","note":"<what you ran and saw>"}]}

Rules for the file:
- \`verdict\` is PASS only when every criterion passes; otherwise FAIL.
- \`head\` is the pull request head you actually tested. Get it with \`gh pr view <n> --json headRefOid\`.
- \`builder\` is a different name from \`verifier\`. Get it from \`gh pr view <n> --json commits\` (the author login of the first commit).
- Every line of the criteria list appears once, in the order given, as \`criterion\`.

Do not change code, commit, push, merge or move the card. You judge; you do not fix.`
}

export function verdictComment({ card, verdict, model, pass, attempts }) {
  const header = `${pass} Shipping pass on ${model}${attempts ? ` (attempt ${attempts})` : ''}`
  if (!verdict) return `## ${header}\n\nShipping produced no valid verdict, so nothing was judged.`
  const lines = verdict.criteria.map((item) => `- ${item.verdict}: ${item.criterion}\n  - ${item.note}`)
  return `## ${header}\n\n**${verdict.verdict}**\n\n${lines.join('\n')}`
}

export function exhaustedComment({ card, model, attempts, errors }) {
  return `## First Shipping pass on ${model}\n\nShipping ran ${attempts} time(s) and produced no valid verdict for ${card.identifier}.\n\n${errors.map((error) => `- ${error}`).join('\n')}`
}
