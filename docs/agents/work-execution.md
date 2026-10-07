# How card work runs

Mastra Factory is **PAUSED**, not removed. Its code and server service stay as they are. New Julia
and machine cards live in Linear: Linear owns cards, requirements, acceptance criteria, and status;
GitHub owns code, commits, pull requests, and CI; Run files own execution state. The intended route
is the adapted JUL-122 runner, started on Todd's Windows laptop with `$init JUL-nnn`. The adapted
runner and `$init` wrapper are pending implementation and verification. This documentation
checkpoint does not authorize starting delivery through them. The adapted runner's complete test
suite must pass on Todd's Windows laptop before it is used for delivery. UAT means Todd testing the
Vercel preview before merge by following the card's household-facing steps, not testing the live app
after merge.

## Paused Factory route (historical, not for new cards)

1. A GitHub issue lands in Factory's Intake column and waits; it starts only when Todd taps it.
2. Factory's planning step writes the plan; it names the seams and the failing tests written
   first (`.claude/skills/tdd/SKILL.md`) and the lasting observability the change adds. The plan
   is saved in the pull request.
3. Factory's build step follows the approved plan and opens a pull request with a plain-language
   "Try it" section.
4. Factory's stock review step runs on its configured reviewer helper, whose maker must differ from
   the builder's and be visible in the review trace. It publishes the sole verdict. When that review
   passes and CI is green, the Factory reviewer merges the Julia PR. An open PR stays outside Done.
5. Todd tries the live app after merge; if he rejects the change, revert it and return the card to
   Factory.

Progress is Factory's Work and Review boards and its Needs attention list. Each card's audit
record shows whether every step was done by Factory or by Todd.

## Historical Factory support (not for new cards)

- Sets up and looks after Factory, Mastra, GitHub and Vercel settings, writes specs and documents,
  and runs product-use audits.
- For a machine card, uses the laptop's ordinary signed-in access: `git push` the branch, `gh pr
  create`, then `gh pr merge --squash` once CI is green. The publisher App and
  `scripts/publish-pr.mjs` / `scripts/merge-pr.mjs` are for the Factory-card route only and must
  not be used for machine cards. It never builds, reviews, moves, or merges a Factory card and
  never uses Factory's GitHub keys.
- Approved custom pieces go on the exceptions list in `ops/factory/README.md`.

## Historical machine-card route (not for new cards)

Keep machine-card GitHub issues open while working, label new ones `factory:machine` at creation,
and do not send them to Factory; the Factory GitHub rules exclude the known machine issues and
their PRs, the `factory:machine` label, and publisher App PRs from intake.

1. On a machine card the laptop agent is the operator: builds, uses its ordinary signed-in access
   to `git push` the branch, `gh pr create`, and `gh pr merge --squash` once CI is green, installs
   on the server, proves it with its own read-back, and closes the card. The publisher App and
   `scripts/publish-pr.mjs` / `scripts/merge-pr.mjs` are for the Factory-card route only and must
   not be used for machine cards.
2. Read-only server work needs no approval. A server change a card calls for is allowed: note the
   current state first and restore it if the read-back fails.
3. Every machine PR is built test-first with Pocock's `/tdd` (the branch history shows a failing
   test committed before the code that passes it) and checked with Pocock's `/code-review` against
   `CODING_STANDARDS.md`, with the card as the spec. The PR body holds the review output, and each
   finding is marked fixed or deliberately left. If this evidence is missing the card is PARKED.
4. Stop only for: a step with no way back; spending Todd has not approved; or a credential or
   permission the agent does not hold. Then PARK with one line and move on. Never ask Todd for a
   workaround.
5. A new rule is added only after the thing it prevents has actually happened.

The Factory code, server service, publisher App, and scripts remain in place but are inactive for
new work. Do not start, move, or merge a Factory card while Factory is paused. Do not use the
publisher App or `scripts/publish-pr.mjs` / `scripts/merge-pr.mjs` for Linear cards.

## Historical Factory model settings

These settings describe the paused Factory route and do not apply to new Linear cards.

Models are settings, never fixed in documents: the builder and Factory review helper are selected
in Factory's settings, and the memory observer/reflector is selected in Factory's memory settings.
Follow an explicit model choice from Todd; do not substitute models without his approval. The review
helper is always from a different maker than the builder, and missing trace evidence fails review.

## Plan answers and blockers

The approved plan answers the questions skills ask — public interface, test seams, scope,
acceptance criteria, verification, and lasting observability. When a skill asks to agree test
seams, the plan's seams are the agreed seams; do not ask Todd again. Resolve routine
implementation details from code and history and record a concise assumption.

### Runtime dependency matrix

Any Factory plan or laptop brief for a change that runs on the server or touches a database must
include a `## Runtime dependency matrix`. The plan is not approved without it. For every boundary
the change crosses, include one row naming the principal (the identity the deployed service
actually runs as), the backing store or API, read or write mode, the fixture that exercises the
boundary in tests, and the proof command that shows it works on the real server.

This comes from #211: unit tests covered code paths but not the deployed path, and unstated
runtime dependencies later surfaced as a missing entry point, HTTP sign-in Factory does not
support, the wrong Factory project, missing database permissions, and trace pages that were never
followed. Use those as the worked example; a generic matrix does not make a plan executable.

Never ask Todd for an exception or workaround approval. If an authorization boundary or platform
limit blocks the next required action, park the Linear card with one line explaining why. Factory's
Needs attention route is inactive while Factory is paused.
