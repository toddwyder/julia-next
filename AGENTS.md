# AGENTS.md — Julia

Julia uses the pstack way of working on probation since 22 October 2026. pstack builds and proves. The Build card runs the same way; its retro decides keep, adjust or revert. This file is the whole rulebook.

## Work
- Build with the poteto-mode skill and follow it as written.
- Spending is $0: Codex runs on Todd's signed-in plan; real request checks use a model CommandCode's billing page lists as free. Any cost readback above $0 stops the work.
- Framework facts come from the installed packages, their version-matched official docs, and the learning tests under ops/build-runner/framework/. The learning tests stay green.
- Commit and push as you go. The poteto-mode todo list and show-me-your-work decision log are committed under docs/agents/<card>/.
- Publish with gh using the ordinary signed-in GitHub access.

## Todd
Ask Todd only when a step needs him in his own account, spending would rise above $0, or a choice changes what Julia does for the household. Decide everything else and record it in the decision log.

## Server
- Agents run as ubuntu with admin rights; Todd accepts the risks.
- Commands needing Julia keys: node scripts/julia-agents.mjs -- <command>.
- Server: docs/agents/server-runbook.md. Domain words: GLOSSARY.md.
- Linear holds cards and requirements. GitHub holds code.

## Finish
An open PR to main with the proof in it and CI green.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
