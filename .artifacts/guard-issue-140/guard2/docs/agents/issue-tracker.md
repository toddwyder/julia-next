# Issue tracker: GitHub

New work lives in GitHub issues on `toddwyder/julia-next` (ADR 0009). Every issue lands in Mastra
Factory's Intake column and waits there until Todd taps it, so only buildable work becomes an
issue. Use the `gh` CLI.

Linear (team Julia-next) is the read-only library of Julia documents. Read it with the Linear MCP
tools; don't create new Linear cards. JUL-184 (Factory setup) was the last one.

## Specs

A spec is a document in the repo under `docs/specs/<name>.md`, published through a pull request.
It is never an issue, because an issue in Intake could be started by mistake. Each spec gets a
**milestone** of the same name, and its tickets belong to that milestone, which gives the
Linear-style grouping and a progress bar. The first is **Factory route**.

## Conventions

- **Create an issue**: `gh issue create --repo toddwyder/julia-next --title <title> --body-file
  <file> --milestone "<spec milestone>"`. The body links the spec in `docs/specs/` and any Linear
  card or document the ticket came from. Issues are created as Todd (his `gh` sign-in), so
  Factory treats them as trusted.
- **Blocking**: GitHub's native "blocked by" issue relationship where available; otherwise a
  "Blocked by #N" line at the top of the body. Todd starts a ticket only when its blockers are
  closed.
- **Read an issue**: `gh issue view <number> --comments`.
- **List issues**: `gh issue list --milestone "<name>"` (add `--state all` for closed ones).
- **Comment**: `gh issue comment <number> --body-file <file>`.
- **Close**: Factory closes issues when their work merges. Close by hand only to cancel, with
  `gh issue close <number> --reason "not planned" --comment "<one-line reason>"`.
- **Labels**: none are required; Factory's Intake is the queue, not a label. The triage labels in
  `docs/agents/triage-labels.md` are not used on GitHub.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Publish a spec to `docs/specs/` through a pull request and create its milestone
(`gh api repos/toddwyder/julia-next/milestones -f title="<name>"`). Publish each ticket as a
GitHub issue in that milestone, blockers first. Linear conventions (the `Julia-next agent
defaults` template) apply only to the historical Linear library.

## When a skill says "fetch the relevant ticket"

`gh issue view <number> --comments`. For older Linear cards, `get_issue` then `list_comments`.
