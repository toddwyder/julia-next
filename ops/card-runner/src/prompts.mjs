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

export function buildPrompt({ card, branch, pull }) {
  return `You are the build session for one Linear card. Work only in this checkout, on branch ${branch}, which was created from origin/main for you.

${cardSection(card)}

${UNATTENDED}

Read AGENTS.md, then docs/plans/path-forward.md. Activate the poteto-mode skill and follow the playbook its table names for this card's label (${labelNames(card)}).

Finish this card on this branch:
- Change the code so every acceptance criterion above is met. If a criterion is already met, change nothing for it and say what you saw.
- Run the checks that prove it: the repository's own test and lint commands for the area you touched.
- Commit and push the work on this branch.
- ${pull ? `A pull request already exists at ${pull}; push to it.` : `Open a pull request to main with a body line exactly: Card: ${card.identifier}`}

Post the evidence Shipping will judge, with no one in between:
- For every acceptance criterion, post one Linear comment with \`node scripts/linear-cli.mjs comment ${card.identifier} --file <path>\` (LINEAR_API_KEY is already in your environment).
- Each comment starts with \`Prove It Works: <the criterion in the card's words>\`, then what you ran and what you saw. Name the exact command and its result. A summary is not evidence.
- Do not merge the pull request and do not move the card. Shipping decides, and a person gives UAT.

Print what changed, the pull request number, and which criterion Shipping should look at first.`
}

export function shippingPrompt({ card, evidence, verifierModel, verdictPath, final }) {
  const pass = final ? 'final' : 'first'
  return `You are Shipping. You did not build this card, and you have never seen the build session's conversation. Judge only what you can run and read for yourself.

${cardSection(card)}

## The evidence the build posted

${evidence}

${UNATTENDED}

Do not trust the evidence or any summary in it. Run the change yourself:
- Read the pull request diff and the code it touches.
- Build or start a copy of the change and drive it the way a person would. For a dashboard change use a free port; for the Julia app use a preview address; otherwise run the repository's own checks.
- Read the page logs, the command output and the tests. If a criterion cannot be checked, mark it FAIL.

Answer every acceptance criterion above with PASS or FAIL and one note saying exactly what you ran and saw. A criterion judged from a description alone is a FAIL.

This is the ${pass} Shipping pass and it runs on ${verifierModel}.

Write your verdict to this absolute path, and print it too:
${verdictPath}

The file holds one JSON object, nothing else:
{"juliaShippingVerdict":1,"card":"${card.identifier}","head":"<the pull request's head commit sha>","verdict":"PASS","builder":"<the GitHub login of the head commit's author>","verifier":"${verifierModel}","criteria":[{"criterion":"<the card's criterion in its own words>","verdict":"PASS","note":"<what you ran and saw>"}]}

Rules for the file:
- \`verdict\` is PASS only when every criterion passes; otherwise FAIL.
- \`head\` is the pull request head you actually tested. Get it with \`gh pr view <n> --json headRefOid\`.
- \`builder\` is a different name from \`verifier\`. Get it from \`gh pr view <n> --json commits\` (the author login of the first commit).
- Every acceptance criterion appears once, in the card's own words.

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
