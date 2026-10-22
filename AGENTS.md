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

Use ordinary signed-in GitHub access for delivery. Todd’s latest 22 October 2026 decision
keeps agents on the existing ubuntu connection; julia-agent remains in place, unused.
The builder has admin rights. Todd accepts access to the control-page vault pass,
changes to runner limits and the deployed-code route. Do not add safeguards, rules,
criteria, checks or cards to prevent those accepted risks. The ubuntu lockdown and
julia-agent handoff requirements are dropped.

## Building and reviewing

Accepted ADRs and Todd’s dated card decisions bind. Proposed ADRs and other docs do not.
When records disagree, Todd’s latest dated decision wins.

### Free models for machinery checks

Todd’s decisions, 22 October 2026 07:35–07:44: learning tests and Proof drives use
one free model, Reflection Beam Free (`reflection/beam:free`). Claude read Todd’s
CommandCode usage page at 06:58 on 22 October and saw $0.0000 for each Beam request;
Todd accepts that evidence, with no further cost proof required. Drop MiniMax,
Laguna and Glyph Cluster from the machinery checks. “Each real free builder” and
“both free builders” mean Beam alone.

In learning tests and Proof drives only, if the free model becomes unavailable,
the agent picks another model that CommandCode’s billing page lists as free,
records the old and new model IDs in the card’s evidence, and continues without
another Todd decision. Do not wait on the usage page or retry unavailable models;
one HTTP 200 is enough to switch. If the usage page later shows any cost for that
model, the adapter refuses it from then on and the card stops. Paid models remain
Todd’s decision.

Latest review decision — Todd, 22 October 2026 11:54 PT:
Code review belongs to Implement. Run /code-review once after the build is done;
Standards and Spec helpers run in this session on this model. Never send code
review to a paid or outside model. Real building remains Codex GPT-6 Sol.
Adversarial review is separate, after Implement, by Gemini. DeepSeek has no
review role. Until Todd names the exact Gemini model and route, no adversarial
review runs; ask him in one line when a card reaches that step.

One adversarial round reviews one candidate, including all its angles/calls.
A recheck after fixes is round two. There is no round three: stop the card under
the stop rule. Supply the spec, pinned changed files/callers and evidence once
per round. JUL-249's runner enforces runner-only launch and the durable two-round
maximum in code; the builder cannot call a reviewer model.

JUL-250 has no paid review left. Finish its own /code-review, Proof and tests,
then merge; this card does not wait for Gemini configuration. Do not loosen the
tracker to make room for more review. The shared CommandCode allowlist now admits
only reflection/beam:free for machinery learning/Proof. No external code-review
or adversarial model is admitted. Ornith is denied and Glyph remains dropped.
The learning route and Proof preload use the same durable tracker. Retain actual
completed response costs and unresolved reservations; never ask for receipts.

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

Machine changes finish in-session code review, then use Gemini with the project-local
adversarial-review skill (`.agents/skills/adversarial-review/SKILL.md`), followed by Proof.
JUL-250 follows Todd’s 11:54 exception above: its own code review, tests and Proof, then merge.
Proof recipe:
`docs/agents/machine-pstack-verification.md`; it runs `verify-machine` as machine UAT.

## Authorization and blockers

Keep Todd's start authorization and explicit model/spend choices. Never ask Todd for an exception
or workaround approval. If an authorization boundary or platform limit blocks the next required
action, park the Linear card with one line explaining why; do not use Factory's Needs attention
route: Factory is retired.

Before asking for any approval: find where the thing lives today and why the current path can't reach it. Ask only if no existing path works, and include that trace in the request.

When a skill says to ask the user for access, evidence, or permission to add temporary logging, get it yourself. Temporary logging is pre-approved and removed when the analysis is done. Ask Todd only for an account action, money beyond the limit, or a product decision.

### Standing stop policy

Every report and its evidence is committed under docs/agents/<card>/ (evidence copied into docs/agents/<card>/evidence/) and pushed before it is reported to Todd. The report names the pushed commit.

Todd’s decision, 22 October 2026 09:52: ask Todd only when the next step physically
requires his account action and work cannot continue without it, spending would exceed
the cap, or a choice changes what Julia does for the household. Decide everything else,
including security, credentials and risk, using Todd’s standard: accept unlikely risks;
act only on actual harm or misuse. Record the decision in one line on the card and continue.
The observed CommandCode-key exposure is accepted; do not rotate. Ordinary errors are
diagnosed with `.claude/skills/diagnosing-bugs/SKILL.md` and fixed test-first in place.
Report only at each merge or those account/money/product blockers. Waiting for CI is not a stop.

Linear statuses: Triage, Backlog, Ready, Implementation, Code review, Evidence review,
Remediation, Staging/smoke test, UAT, Complete. Use Implementation for active building;
this team has no In Progress status.

### Preflight

Before any task, verify the applicable entry points, the launcher's accepted command list,
configuration and authorized spend limits, required credentials, and branch/worktree state. Fix
what is safely fixable before starting work. Confirm each tool the card uses is at the version its brief or lockfile names, and that its automatic updates are off. Spend limits belong in
accepted ADRs and dated card decisions, never in prompts. The reviewer limit is **$1.00 per card**.
[Permanent machine parts](docs/agents/permanent-machine-parts.json) are preflight prerequisites and no cleanup ever removes them.
On the server, commands needing Julia keys use `node scripts/julia-agents.mjs -- <command> [args...]`.
The thin bootstrap loads the already-provisioned agents pass from
`/home/ubuntu/.config/julia-agents/service-account-token` (ubuntu-owned 0600, directory 0700),
clears inherited 1Password authentication overrides and runs stock `op run` with the committed
references-only `scripts/julia-agents.env`. Missing or invalid authentication returns
`provider unavailable` before the command. No fallback to the control-page pass. The one-time
bootstrap item has already been read; never repeat that read. Windows commands keep the wrapper below.
On Windows, every local command that needs a Julia vault secret must run through
`scripts/julia-vault-windows.ps1`; its default configuration is the provisioned restricted Julia
service account. Never use personal 1Password desktop authentication for those commands. Direct
`julia-vault.mjs` key operations fail closed when the service-account bootstrap is absent.

### Delivery finish line

Publishing is part of the card's finish line, so work to it without stopping. When review and Proof pass: push the exact reviewed candidate to a branch, open or resume one pull request, and wait for CI on that exact commit. A machine card then merges without asking Todd, and the agent confirms main contains the merged commit. A Julia product card stops for Todd's household test of the preview and merges only the commit he tested. After merging, post the result and links on the card and delete every branch and file you created that the card's brief doesn't name. Use ordinary signed-in GitHub access. Never ask Todd to run any of these steps or to relay a message between agents.

## Server and domain

Agents continue as ubuntu, with the admin/control-pass/deployed-code risks accepted by Todd.
julia-agent remains unused. No denial or tamper-protection proof is required for those risks.
Server cleanup is verified by the maker's own checksummed readback. The report labels it a self-check, never independent review. Never ask Todd for an exception for it. See `docs/agents/server-runbook.md`. Domain model: `GLOSSARY.md`; decisions: `docs/adr/`;
routes: `docs/agents/work-execution.md`. The former Factory decision record is historical only.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

Follow the version-matched Next.js entry in “Look it up, don't recall it” above.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
