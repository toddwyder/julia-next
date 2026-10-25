# JUL-252 synthesized design (A with grafts)

Synthesis: candidate A (pure verdict + flow modules called from worker.mjs) with grafts from both runners:
reviewer and Investigation are read-only; every stage runs only after the previous runner closed (sequential
openRunner, so the one-runner rule and the fetch/ledger patch never overlap); each review round is persisted to
the job dir before Linear is touched; card-flow folded into evidence-review.mjs (no separate one-caller module);
no injected Linear fake in tests (pure functions only; Linear stays a boundary). Build job contract
(`ready-for-review`, BuildResultSchema) is unchanged; flow result rides on `job.evidenceReview`.

## Data shapes (ops/build-runner/evidence-review.mjs)
- `VERDICTS = ['proven', 'unproven', 'wrong thing tested']`
- `Verdict = { criterion, verdict, proofFile: string|null, reason }`
- `Review = { round, reviewer, company, candidateCommit, verdicts, passed }` passed = every verdict proven.
- `FLOW` table: `{ 'review-1': { pass: 'passed', fail: 'remediation' }, remediation: { done: 'review-2' }, 'review-2': { pass: 'passed', fail: 'investigation' }, investigation: { done: 'stopped' } }`
- `REQUIRED_PLAYBOOK = { remediation: 'Bug fix', investigation: 'Investigation' }`
- `COLUMN = { 'review-1': 'Evidence review', remediation: 'Remediation', 'review-2': 'Evidence review', passed: 'Staging' }`

## Pure functions (tested)
- acceptanceCriteria(description), chooseReviewer(settings, builderKeys), reviewPrompt({card, criteria, proofFiles}),
  parseVerdicts(text, criteria, proofPaths), verdictComment(review), nextStage(stage, outcome).
- playbook-guard.mjs: declaredPlaybook(checklist), playbookSteps(markdown), assertFollowsPlaybook({checklist, required, playbookMarkdown}).

## Boundaries (not unit-tested; no fakes allowed)
- readProofFolder(worktree, commit, cardId): `git ls-tree` + `git show` of `docs/proof/<CARD-ID>/` at the commit, size bounded.
- linear-card.mjs: moveCard(identifier, stateName), commentCard(identifier, body) over scripts/linear-cli.mjs.
- worker.mjs: runSession extraction; build -> guard -> save build result -> evidence flow.
