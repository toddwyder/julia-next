# AGENTS.md — Julia

Julia uses the pstack way of working, adopted 22 October 2026 and kept after the JUL-231 retro on 23 October. pstack builds and proves. This file is the whole rulebook.

## Work
- Build with the poteto-mode skill and follow it as written.
- In Mastra Code, read `docs/harness/mastra-code.md` once per session and read the pstack models file it names at task start when it exists.
- Todd's agreed delivery flow, decisions and order of work: [docs/plans/path-forward.md](docs/plans/path-forward.md).
- Fix every correction as high in [the inverse pyramid](docs/principles/inverse-pyramid.md) as it will go; a written rule is the last resort.
- Card spend is recorded and reported per card at published API prices. Money never stops a card. A build stops only after 15 minutes with no activity, or pauses on a runaway or a provider that stays down, keeping its work and posting a Linear note so it can be continued. See [docs/adr/0023-actual-spend-card-cap.md](docs/adr/0023-actual-spend-card-cap.md).
- Framework facts come from the installed packages, their version-matched official docs, and the learning tests under ops/build-runner/framework/. The learning tests stay green.
- Commit and push as you go. The poteto-mode todo list and show-me-your-work decision log are committed under docs/agents/<card>/.
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
| Current agent-read files point only at paths that exist. | `node scripts/check-agent-links.mjs` checks the entry points, pstack skills, `ask-matt`, and generated recovery prompt. |
| Every branch except `main` has an open pull request to `main`. | `node scripts/check-branch-pr.mjs` audits GitHub branches and open pull requests in CI. |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
