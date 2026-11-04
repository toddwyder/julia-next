## Goal
A card started through one entry point has its build run inside a stock workflow, as a step carried out by a plain Mastra agent with the repository's skills, shell and files. The build's records sit under the run's trace and carry the card. Review and landing keep working as they do today. The old launcher is deleted.

## Read first
- Work this card in poteto-mode, whose skill is at `.agents/skills/poteto-mode/SKILL.md`.
- Mastra facts come from the installed `@mastra/core` and its bundled version-matched docs in `dist/docs/references/`: the workflow pages (`docs-workflows-agents-and-tools.md`, `docs-workflows-control-flow.md`, `docs-workflows-error-handling.md`), the agent pages (`docs-agents-overview.md`, `docs-agents-tools.md`, `docs-subagents.md`), and `docs-skills.md`. Cite the installed package file and line for each stock feature you use.
- pstack facts come from `.agents/docs/guide/` (chapters 02, 05 and 06) and the principles `principle-prove-it-works`, `principle-subtract-before-you-add` and `principle-encode-lessons-in-structure`. `docs/harness/mastra-code.md` shows which Mastra Code tool each pstack name maps to today, and `.agents/docs/harness/claude-code.md` shows what an adapter looks like.

## What we know
- The parent workflow and `machine/run.mjs` exist only on the unmerged first-slice branch. Main still has `scripts/start-machine.mjs`. This card builds its own small workflow on main and leaves that branch untouched.
- The remediation and landing stages are separate commands today. They stay that way here, started by steps of the new workflow.
- Today's build model is a constant in `machine/remediation/workflow.mjs`. The place where pstack roles name their models is `~/.agents/pstack-models.md`, which `AGENTS.md` names.
- Stock Mastra's model list does not include every model this machine uses. A model id missing from it needs Mastra's custom-provider route.
- The model key already reaches machine processes through `scripts/julia-agents.mjs`. Todd handles no credential.
- The repository has no Mastra packages of its own yet.

## Steps
1. Before changing anything, run a plain Mastra agent on a trivial task with the stock workspace, the pstack skills, and child agents for the roles poteto-mode delegates to (explore, plan, execute), on the build model. Read its trace. This proves the riskiest part first.
2. Add the Mastra packages the build step needs to the repository's own package list, at the version Mastra Code runs today, and import them by name.
3. Build the card's workflow on main with one entry point. Its build step calls the plain agent. Give the agent an explicit step ceiling and an abort signal for the time limit, and nest its records under the run's trace with the card as a tag. Its remediation and landing steps start the existing commands.
4. Read the build model from `~/.agents/pstack-models.md`. Add a test that fails when the build step's source names a model.
5. Write one short doc that maps pstack's names to the plain agent's tools and child agents. Leave `docs/harness/mastra-code.md` as it is, because interactive Mastra Code sessions still use it.
6. Run one real small card through the entry point. Put the run's steps with start and end times, the build's model calls, and its tokens and cost, read from the run's trace, in the pull request.
7. After that card has landed, delete `scripts/start-machine.mjs`, the glue state it kept, and the tests and live docs that describe only it.

## Acceptance criteria
- A card started through the entry point is built in one workflow run, and the run's trace shows the build as a step with start and end times.
- The build's model calls sit inside that step's trace, each tagged with the card.
- The build's tokens and cost can be read from that same trace.
- A card started through the entry point goes on to review and landing as it does today.
- The repository has one way to start a card, and Todd changes the build model in one place.

## Outside check
The Shipping reviewer reviews this card's own pull request and posts a verdict on it. A fresh agent session reads only the runbook, starts a small card through the entry point, and finds its build in the run's trace.

## Out of scope
Review and landing as agents, Babysit, the runs page, the dashboard, the thread id, the scorecard pipeline, and the retry patch.

## Pull request
Name only this card in the pull request title and description.
