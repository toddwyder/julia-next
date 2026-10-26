# AGENTS.md — Julia

Julia uses the pstack way of working, adopted 22 October 2026 and kept after the JUL-231 retro on 23 October. pstack builds and proves. This file is the whole rulebook.

## Work
- Build with the poteto-mode skill and follow it as written.
- In Mastra Code, read `docs/harness/mastra-code.md` once per session and read the pstack models file it names at task start when it exists.
- Todd's agreed delivery flow, decisions and order of work: [docs/plans/path-forward.md](docs/plans/path-forward.md).
- Fix every correction as high in [the inverse pyramid](docs/principles/inverse-pyramid.md) as it will go; a written rule is the last resort.
- Every card gets a scorecard of its spend at published API prices, its models and its stops, rebuilt from Mastra Code's records with `node scripts/scorecard.mjs JUL-<n> --write` into `docs/scorecards/` and committed with the card's PR. Money never stops a card. Every stop comments on the card and sets Todd a Linear reminder. Record Todd's UAT yes in `docs/scorecards/uat.json`. See [docs/adr/0024-run-scorecard-and-stop-ping.md](docs/adr/0024-run-scorecard-and-stop-ping.md).
- Framework facts come from the installed packages and their version-matched official docs.
- Commit and push as you go.
- Publish with gh using the ordinary signed-in GitHub access.

## Todd
Ask Todd only when a step needs him in his own account or a choice changes what Julia does for the household. Continue all independent work while an account action is pending. Decide everything else and record it in the decision log.

## Server
- Agents run as ubuntu with admin rights; Todd accepts the risks.
- Commands needing Julia keys: node scripts/julia-agents.mjs -- <command>.
- Server: docs/agents/server-runbook.md. Domain words: [GLOSSARY.md](GLOSSARY.md).
- Linear holds cards and requirements. GitHub holds code.

## Finish
An open PR to main with the proof in it and CI green.

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
