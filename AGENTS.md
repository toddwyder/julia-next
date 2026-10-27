# AGENTS.md — Julia

Julia uses pstack (adopted 22 October 2026). pstack builds and proves. This file is the whole rulebook.

## Work
- Build with the poteto-mode skill and follow it as written.
- In Mastra Code, read `docs/harness/mastra-code.md` once per session and the pstack models file it names at task start.
- Before planning a card, read [docs/plans/path-forward.md](docs/plans/path-forward.md) for Todd's delivery flow and decisions.
- Fix every correction as high in [the inverse pyramid](docs/principles/inverse-pyramid.md) as it will go; a written rule is the last resort.
- Every card's PR includes its scorecard, built with `node scripts/scorecard.mjs JUL-<n> --write`, and every stop pings Todd; the rest is in [docs/adr/0024-run-scorecard-and-stop-ping.md](docs/adr/0024-run-scorecard-and-stop-ping.md). Money never stops a card.
- Framework facts come from the installed packages and their version-matched official docs.
- Commit and push as you go; publish with gh using the ordinary signed-in GitHub access.

## Todd
Todd decides what Julia does for the household and gives UAT. Everything else is yours: decide it and record it in the decision log. When a step truly needs his own account, show that nothing else can do it, reduce it to one approval he clicks, and keep working while it is pending.

## Server
- Agents run as ubuntu with admin rights; Todd accepts the risks.
- Commands needing Julia keys: `node scripts/julia-agents.mjs -- <command>`.
- Before changing the server, read `docs/agents/server-runbook.md`. When a card uses a Julia word you don't know, read [GLOSSARY.md](GLOSSARY.md).
- Linear holds cards and requirements. GitHub holds code.

## Finish
A card is finished when its PR is merged to main (after Todd's UAT yes when the card changes something he uses), main CI is green on the merge commit, and the card is Complete in Linear with that commit in a comment.

## Enforced rules

| Rule | Enforcement |
| --- | --- |
| Skill names are unique across the installed catalogs. | `node scripts/check-skill-names.mjs` rejects duplicate frontmatter names. |
| Current agent-read files point only at paths that exist. | `node scripts/check-agent-links.mjs` checks the entry points, pstack skills, and `ask-matt`. |
| Every branch except `main` has an open pull request to `main`. | `node scripts/check-branch-pr.mjs` audits GitHub branches and open pull requests in CI. |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
