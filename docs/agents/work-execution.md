# How card work runs

Julia feature and defect cards are built and reviewed by Mastra Factory. Server
and machine work runs directly from the laptop under Todd's 2026-09-29 decision.
The decisions are in `docs/adr/0009-mastra-factory.md` and issue #148.

## Factory runs Julia cards

1. A GitHub issue lands in Factory's Intake column and waits. It starts only when Todd taps it.
2. Factory's planning step writes the plan. Every plan names the seams and the failing tests
   written first (`.claude/skills/tdd/SKILL.md`), and the lasting observability the change adds.
   Plans are approved automatically and saved in the pull request.
3. Factory's build step follows the approved plan and `AGENTS.md`, and opens a pull request with
   a plain-language "Try it" section: what changed and the steps Todd follows on the rehearsal
   copy.
4. CI runs on GitHub's own runners. Factory's review step runs `.claude/skills/code-review/SKILL.md`
   against `CODING_STANDARDS.md` and the plan. A separate review agent from a different model
   maker than the builder tries to break the work against every acceptance criterion. Either
   reviewer's "Request changes" goes back to the builder through Factory's own GitHub rule.
5. When everything is green, GitHub asks Todd to review. He tries the Vercel rehearsal copy and
   approves or requests changes in one sentence. Approval merges through GitHub's auto-merge.

Progress is Factory's board and its Needs attention list. Each card's audit record shows whether
every step was done by Factory or by Todd; anything else means someone went around the product.

## What an agent outside Factory does

- Sets up and looks after Factory, Mastra, GitHub and Vercel settings, writes specs and
  documents, and runs the independent product-use audits.
- Merges its own setup or document pull requests through the publisher App (`merge-pr.mjs`, pinned
  to the head), since they change nothing Todd can try; product changes wait for Todd's approval.
- Never builds, reviews, moves or merges a Factory card by hand, and never uses Factory's GitHub
  keys. If Factory seems unable to do something, check its docs and package source, then tell Todd
  the gap; don't work around it.
- Custom code, scripts or changes to Mastra's code need Todd's approval first and go on the
  exceptions list in `ops/factory/README.md`.

## Machine cards

The laptop agent owns Factory, server, repository, and GitHub setup directly.
Keep these GitHub issues open while working, label new ones `factory:machine`,
and do not send them to Factory. The Factory GitHub rules exclude the known
machine issues and their PRs, the `factory:machine` label, and publisher App
PRs from intake. Build on a branch, get a review from a different AI company,
and merge the reviewed head through the publisher App. Report evidence and
acceptance boxes on the GitHub issue, ending with two plain-English **For Todd:**
lines saying what happened and whether he must decide anything.

## Models

Models are settings, never fixed in documents: the builder in Factory's model settings, the
separate reviewer in its own settings, and the memory observer/reflector in Factory's memory
settings. Follow an explicit model choice from Todd; do not substitute models without his approval.
The reviewer is always from a different maker than the builder.
