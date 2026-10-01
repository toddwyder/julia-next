# Issue tracker: GitHub

New work lives in GitHub issues on `toddwyder/julia-next` (ADR 0009). Every issue lands in Mastra
Factory's Intake column and waits there until Todd taps it, so only buildable work becomes an
issue. Linear (team Julia-next) is a read-only historical library; do not create Linear cards.
Use the `gh` CLI; the native commands below are optional examples:

- **Create:** `gh issue create --repo toddwyder/julia-next --title <title> --body-file <file>`
- **Read:** `gh issue view <number> --comments`
- **Comment:** `gh issue comment <number> --body-file <file>`
- **Close by hand** only to cancel: `gh issue close <number> --reason "not planned" --comment "<one-line reason>"`
- **Labels:** none required — Factory's Intake is the queue.

A spec is a document in `docs/specs/<name>.md`, published through a pull request; it is never an
issue, because an issue in Intake could be started by mistake.

When a skill mentions a Linear template or a triage label, use this mapping: GitHub issues and
Factory are current, Linear is read-only, and no template, milestone, or readiness label is
required. The approved plan answers routine scope and seam questions.
