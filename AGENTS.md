# AGENTS.md

Mastra Factory is **RETIRED**. Its server, public endpoint, credentials, database, timers,
and repository source have been removed. Do not create, restart, or repair a Factory route.

New Julia and machine cards live in Linear. Linear owns cards, requirements, acceptance criteria,
and status; GitHub owns code, commits, pull requests, and CI; Run files own execution state. The
intended route is the adapted JUL-122 runner, started on Todd's Windows laptop with `$init JUL-nnn`.
The adapted runner and `$init` wrapper are pending implementation and verification. This
documentation checkpoint does not authorize starting delivery through them. The adapted runner's
complete test suite must pass on Todd's Windows laptop before it is used for delivery. UAT means
Todd testing the Vercel preview before merge, following the card's steps as a household member would.

Use ordinary signed-in GitHub access for delivery. Keep SSH and sudo outside automated runners;
an authorized operator uses the laptop's Tailscale route.

## Building and reviewing

Accepted ADRs and Todd’s dated card decisions bind. Proposed ADRs and other docs do not.
When records disagree, Todd’s latest dated decision wins.

## Look it up, don't recall it

Before using or configuring a tool, read the documentation matching the installed version. Start
with documentation bundled in the installed package. When none is bundled, use the publisher's
official `llms.txt` as an index and fetch only the applicable individual page; never fetch
`llms-full.txt`. The Mastra docs MCP server is a fallback only. A framework map names the exact
page read for each job, even when the job uses a tool not listed here.

| Tool | Version-matched documentation source, in lookup order |
| --- | --- |
| Mastra (`@mastra/*`) | The relevant installed package's `dist/docs/` under `ops/mastra-agents/reviewer/node_modules/@mastra/`; fall back to the pinned Mastra docs MCP server only if the package omits the page. |
| Next.js | `node_modules/next/dist/docs/` (currently Next 16.3.5). Heed deprecation notices; `next dev` maintains the agent-rules marker at the end of this file. |
| AI SDK OpenAI-compatible provider | `ops/mastra-agents/reviewer/node_modules/@ai-sdk/openai-compatible/docs/index.mdx` (currently 2.0.81). |
| React | [React's official `llms.txt`](https://react.dev/llms.txt), then the individual `.md` page it indexes (currently React 19.3.0). |
| Zod | [Zod's official `llms.txt`](https://zod.dev/llms.txt), then the applicable individual API page (currently Zod 4.6.5 in the reviewer). |
| DuckDB | Mastra's installed `@mastra/duckdb/dist/docs/` first; for DuckDB itself use [DuckDB's official `llms.txt`](https://duckdb.org/llms.txt), then one indexed page. |
| Turso/libSQL | Mastra's installed `@mastra/libsql/dist/docs/` first; otherwise [Turso's official `llms.txt`](https://docs.turso.tech/llms.txt), then one indexed page. |
| Sentry | [Sentry's official `llms.txt`](https://docs.sentry.io/llms.txt), then one indexed page (currently `@sentry/node` 10.75.0). |
| Firebase | [Firebase's official `llms.txt`](https://firebase.google.com/docs/llms.txt), then one indexed page. |
| Linear | [Linear's official `llms.txt`](https://linear.app/llms.txt), then one indexed developer page. |
| GitHub | [GitHub Docs' official `llms.txt`](https://docs.github.com/llms.txt), then one indexed page or Docs API article. |
| GitHub CLI (`gh`) | The installed command's `gh <command> --help`; use GitHub Docs only for concepts the CLI help does not cover. |
| CommandCode | [CommandCode's official `llms.txt`](https://commandcode.ai/docs/llms.txt), then its single applicable provider page, [BYOK Providers](https://commandcode.ai/docs/byok). |
| ESLint | The installed package README and `npx eslint --help`; when agent-oriented lookup is needed use the [official ESLint MCP server](https://eslint.org/docs/latest/use/mcp). ESLint publishes no `llms.txt`. |
| FastEmbed JS | `ops/mastra-agents/reviewer/node_modules/@mastra/fastembed/README.md`; the installed package bundles no fuller docs tree. |
| Playwright | The installed `node_modules/playwright/README.md` and `node_modules/@playwright/test/README.md`, then the linked individual [Playwright docs page](https://playwright.dev/docs/intro). Playwright publishes no `llms.txt`. |

Follow the approved plan; it answers the questions skills ask (scope, seams, acceptance criteria,
verification, observability). Build test-first with `.claude/skills/tdd/SKILL.md`; review with
`.claude/skills/code-review/SKILL.md` against [CODING_STANDARDS.md](CODING_STANDARDS.md). The
reviewer records evidence for the five checks in `CODING_STANDARDS.md`, or explains why a check
does not apply. Before handing a Julia user-facing change to independent review, run the relevant
proof in `.agents/skills/verify-julia/SKILL.md` and retain behavior evidence that identifies the
exact candidate commit and dirty-tree digest. Any source change after proof makes that proof stale;
rerun it before review. Missing, failed, unavailable, stale, or identity-mismatched proof is a
review blocker, not a pass or an implied not-applicable result.
A check by the same maker as the work is a self-check; never call it independent.

## Authorization and blockers

Keep Todd's start authorization and explicit model/spend choices. Never ask Todd for an exception
or workaround approval. If an authorization boundary or platform limit blocks the next required
action, park the Linear card with one line explaining why; do not use Factory's Needs attention
route: Factory is retired.

Before asking for any approval: find where the thing lives today and why the current path can't reach it. Ask only if no existing path works, and include that trace in the request.

### Standing stop policy

On any blocker other than (a) an account action, (b) money beyond the authorized limit, or
(c) a product decision, make the smallest reversible repository fix and continue. Record that
choice in the final report. Do not use a reversible repository defect as a reason to stop or ask
Todd for a workaround.

Work to the brief's finish line. A completed step is not a stopping point. Waiting on CI or any background job is not a stop: wait for it and continue.

### Preflight

Before any task, verify the applicable entry points, the launcher's accepted command list,
configuration and authorized spend limits, required credentials, and branch/worktree state. Fix
what is safely fixable before starting work. Spend limits belong in
accepted ADRs and dated card decisions, never in prompts. The reviewer limit is **$1.00 per card**.
On Windows, every local command that needs a Julia vault secret must run through
`scripts/julia-vault-windows.ps1`; its default configuration is the provisioned restricted Julia
service account. Never use personal 1Password desktop authentication for those commands. Direct
`julia-vault.mjs` key operations fail closed when the service-account bootstrap is absent.

## Server and domain

Keep SSH and sudo outside automated runners; an authorized operator uses the laptop's Tailscale
route. See `docs/agents/server-runbook.md`. Domain model: `GLOSSARY.md`; decisions: `docs/adr/`;
routes: `docs/agents/work-execution.md`. The former Factory decision record is historical only.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

Follow the version-matched Next.js entry in “Look it up, don't recall it” above.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
