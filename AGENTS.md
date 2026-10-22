# AGENTS.md — hybrid trial

This branch trials a looser way of working. pstack builds and proves. This file is the whole rulebook.

## Work
- Build with the poteto-mode skill and follow it as written.
- Every pstack model role runs on the parent model (inherit-parent).
- Spending is $0: Codex runs on Todd's signed-in plan; real request checks use a model CommandCode's billing page lists as free. Any cost readback above $0 stops the work.
- Framework facts come from the installed packages, their version-matched official docs, and the learning tests under framework/. The learning tests stay green.
- Commit and push as you go. The poteto-mode todo list and show-me-your-work decision log are committed under docs/agents/<card>/.

## Todd
Ask Todd only when a step needs him in his own account, spending would rise above $0, or a choice changes what Julia does for the household. Decide everything else and record it in the decision log.

## Server
- Agents run as ubuntu with admin rights; Todd accepts the risks.
- Commands needing Julia keys: node scripts/julia-agents.mjs -- <command>.
- Server: docs/agents/server-runbook.md. Domain words: GLOSSARY.md.
- Linear holds cards and requirements. GitHub holds code.

## Finish
An open PR to main with the proof in it. Todd decides the merge after the retro.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

Follow the version-matched Next.js entry in “Look it up, don't recall it” above.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
