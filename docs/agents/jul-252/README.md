# Review card and rulebook correction

Todd authorized this work on 23 October 2026.

- [JUL-252, Review](https://linear.app/julia-next/issue/JUL-252/review) is in Backlog and blocked by JUL-231. Its description contains only the supplied decisions and ordering.
- [JUL-233](https://linear.app/julia-next/issue/JUL-233) is Canceled, with the requested one-line supersession comment.
- The reply under JUL-249's closing comment links JUL-252.
- AGENTS.md changes only the learning-test directory from framework/ to ops/build-runner/framework/.

Maker self-check: live Linear readback confirms the cards, dependency and reply parent. The new directory exists. The AGENTS.md diff is exactly the requested replacement. No implementation or model request was made.

Triage searched current Review cards and the existing initialization/delivery workflow. No card titled Review existed. The old saved-candidate path was superseded. No .out-of-scope directory exists. The label enhancement was unavailable, so the existing Feature category and needs-triage labels were used, with the requested Backlog status.

Evidence is in evidence/2026-10-23-review/readback.json. CI and merge will be checked on the exact PR candidate before the final report.

The first CI run failed because scripts/agent-docs.test.mjs still required the old path. The same focused command failed locally. Updated its single literal assertion to Todd's corrected path; all six documentation tests then passed. This keeps the existing documentation contract check aligned with the requested wording. Red and green outputs are retained beside the readback evidence.

Framework map: connected Linear tools and https://linear.app/developers/graphql, reached through its llms.txt; installed gh 2.45.0 help for pr create, checks and merge. This changes documentation only.

User instructions override the skill's generic approval and prose templates: create the settled card now, use the exact one-line cancellation, post only a link in the reply, and merge after green CI.

## 24 October revisit

Todd settled the review's inputs and failure handling on 24 October. The card was re-triaged in place; the status stays Backlog until Todd says settled.

- No evidence index. The reviewer reads the proof folder for the exact candidate commit; a missing or thin proof folder is a failed criterion.
- The "evidence is there" card is dropped. No Linear card existed for it, so nothing was canceled.
- First failed review: the card moves to Remediation and a fix starts automatically on the Bug fix playbook from the review's findings.
- Second failed review: an Investigation run reports the root cause, then the card stops.
- Every build and remediation run records its required playbook (build: the playbook it declares; first remediation: Bug fix; second: Investigation). The machine saves no result for a run whose checklist follows a different playbook.
- The five-card checkpoint stays as Todd's later decision over the saved review results. The card delivers no report.

Todd revised the brief in the same session: criteria 2 and 8 are one criterion, criterion 10 and its report are removed, and proof uses a real failing Beam practice card. The playbook-mismatch and same-company refusals stay as planted checks.

## 24 October card shape

Todd replaced the long brief with a short Outcome and at most five criteria that describe what he sees. Requirements, Contracts, Proof and Out of scope are retired; the proof lives in a criterion when it matters. The detailed brief above is superseded, and the card's three criteria are the contract.

The live card now carries that shape. Its three criteria cover the adversarial cross-company review, the verdict on the card, and the failure path.

Maker self-check: live Linear readback in evidence/2026-10-24-triage/readback.json confirms the title, labels, status and comments. The description matches card-brief.md after Linear's Markdown normalisation of bullet markers. `check-agent-brief.mjs` reports the brief passes the four writing-for-agents rules, recorded in evidence/2026-10-24-triage/brief-rules.txt. `card-admission-check.ts JUL-252` reports admitted true with no issues, recorded in evidence/2026-10-24-triage/brief-check.json. The review implementation does not exist yet: ops/build-runner/worker.mjs ends at ready-for-review, and ops/build-runner/pstack-session.mjs checks that a checklist exists, not that it follows a playbook.
