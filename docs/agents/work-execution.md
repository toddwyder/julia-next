# How card work runs

Julia cards are built and reviewed by Mastra Factory. Server and machine work runs from the
laptop. Decisions are in `docs/adr/0009-mastra-factory.md` and issue #148.

## Factory runs Julia cards

1. A GitHub issue lands in Factory's Intake column and waits; it starts only when Todd taps it.
2. Factory's planning step writes the plan; it names the seams and the failing tests written
   first (`.claude/skills/tdd/SKILL.md`) and the lasting observability the change adds. The plan
   is saved in the pull request.
3. Factory's build step follows the approved plan and opens a pull request with a plain-language
   "Try it" section.
4. Factory's review step runs `.claude/skills/code-review/SKILL.md` against `CODING_STANDARDS.md`
   and the plan, records evidence for the five checks in `CODING_STANDARDS.md`, then publishes a
   verdict. When review passes and CI is green, the Factory reviewer merges the Julia PR. An open
   PR stays outside Done.
5. Todd tries the live app after merge; if he rejects the change, revert it and return the card to
   Factory.

Progress is Factory's Work and Review boards and its Needs attention list. Each card's audit
record shows whether every step was done by Factory or by Todd.

## What an agent outside Factory does

- Sets up and looks after Factory, Mastra, GitHub and Vercel settings, writes specs and documents,
  and runs product-use audits.
- Merges its own setup or document pull requests through the publisher App (`merge-pr.mjs`, pinned
  to the reviewed head); it never builds, reviews, moves, or merges a Factory card and never uses
  Factory's GitHub keys.
- Approved custom pieces go on the exceptions list in `ops/factory/README.md`.

## Machine cards

The laptop agent owns Factory, server, repository, and GitHub setup directly. Keep these GitHub
issues open while working, label new ones `factory:machine` at creation, and do not send them to
Factory; the Factory GitHub rules exclude the known machine issues and their PRs, the
`factory:machine` label, and publisher App PRs from intake. Build on a branch, get a review from a
different AI company, and merge the reviewed head through the publisher App.

## Models

Models are settings, never fixed in documents: the builder in Factory's model settings, the
separate reviewer in its own settings, and the memory observer/reflector in Factory's memory
settings. Follow an explicit model choice from Todd; do not substitute models without his approval.
The reviewer is always from a different maker than the builder.

## Plan answers and blockers

The approved plan answers the questions skills ask — public interface, test seams, scope,
acceptance criteria, verification, and lasting observability. When a skill asks to agree test
seams, the plan's seams are the agreed seams; do not ask Todd again. Resolve routine
implementation details from code and history and record a concise assumption.

Never ask Todd for an exception or workaround approval. If an authorization boundary or platform
limit blocks the next required action, park the card through Factory's existing card/Needs
attention route with one line explaining why.
