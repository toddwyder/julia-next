# Mastra intended-use audit

Date: 2026-09-27. Versions checked: `@mastra/factory` 0.17.2 (current npm `latest`, the version on OVH), `create-factory` 0.2.3, `@mastra/core` 1.71.0, `@mastra/code-sdk` 1.8.3 (the agent Factory runs), `@mastra/memory` 1.32.1. Sources: the live docs at factory.mastra.ai and mastra.ai, and the published npm package source. Server state was not inspected. Repo claims come from this checkout and from branch `origin/factory/jul183-home-version` (commit `25a073e`).

## Summary for Todd

- **We are already using a Mastra product. It is called Factory.** Factory is Mastra's finished "issue to pull request" app. Its agents already run with observational memory, and it has its own board, approvals, retries and stuck-card checks. The right approach is to set Factory up and adjust its settings, not to build a Mastra system of our own.
- **Your example is already true.** Factory's agents are Mastra agents, and observational memory is switched on by default. The one thing to check is the model it uses. We set that memory to GPT-6 Sol, while Mastra recommends a fast, cheap model for this job.
- **The first trial went around Factory.** An agent wrote its own proof files over SSH and moved the cards itself. It ticked boxes and merged with its own scripts. Factory's board phases were set up so that no agent would ever start.
- **Factory can already do several things we planned to build.** It sends your "Request changes" back to the builder. It lets us replace its built-in reviewer and planner instructions with our own, without touching Mastra's code. It already checks for stuck cards. It runs on a phone browser.
- **Some Mastra features we are not using:**
  - Mastra's traces and cost charts ("observability") are probably switched off on our server.
  - Mastra's automatic checks on agent output ("evals") are not used at all.
  - The official GitHub review-agent example is the right model for the DeepSeek reviewer, and we have not used it.
- **The requirements list is too big.** About a third of it is already provided by Factory or GitHub, or it contradicts ADR 0009. Details are in "Requirements to cut or simplify" below.

## How Mastra is meant to be used

**The layer we are on.** Mastra has two levels. The framework provides agents, workflows, memory, tools, storage, observability and evals ([docs](https://mastra.ai/docs)). Factory is a finished web app built on that framework. It connects a repository, brings issues onto a Work board, and "guide[s] a change through investigation, planning, implementation, and pull request review" ([What's Factory](https://factory.mastra.ai/what-is-factory)). Mastra names Factory as a flagship `AgentController` app ([Agent Controller](https://mastra.ai/docs/harness/agent-controller)). For a card → build → review → PR job, the intended pattern is to **run Factory and customise it through its supported hooks**. You do not assemble your own pipeline from framework parts. You only reach for the framework directly for a piece Factory lacks, such as a separate reviewer with a different model.

The building blocks, in Factory terms:

- **Board = the deterministic outer process.** Phases are `resting` (waiting for a person or event), `working` (an agent role) or `terminal`. Declared `outcomes` only *allow* moves; they never make them. A working phase does nothing unless its `onEnter` handler returns `invokeSkill`. Hard human gates belong in `transitionPolicy`, not in prompt wording. Handlers return idempotent decisions (`invokeSkill`, `transition`, `sendMessage`, `notify`, `reject`). ([Boards and rules](https://factory.mastra.ai/configure/boards-and-rules), [MastraFactory API](https://factory.mastra.ai/reference/mastra-factory-api))
- **Built-in Work and Review boards.** Work runs Intake → Triage → Planning → Building → Review → Done. It has human decisions for Accept, Approve plan and Merge, and two switches: Auto-start runs and Auto-approve plans. Each PR gets its own Review card and session. ([Work items](https://factory.mastra.ai/using/work-and-approvals), [Review items](https://factory.mastra.ai/using/reviews))
- **Human-in-the-loop.** Inside Factory, this means resting phases, `transitionPolicy`, and plan/tool approvals in the session. In plain Mastra, the equivalents are workflow `suspend()`/`resume()` and tool `requireApproval` ([workflow HITL](https://mastra.ai/docs/workflows/human-in-the-loop), [agent HITL](https://mastra.ai/docs/agents/human-in-the-loop)). **Applies:** yes, but through Factory's board. A separate Mastra workflow that duplicates the card lifecycle would be a second orchestrator, which requirement 30 of the .docx warns against.
- **Merge is deliberately left to the repository.** "Make the merge decision through your repository's normal human review process" ([Review items](https://factory.mastra.ai/using/reviews)). Factory never merges.
- **Skills.** Factory's stage behaviour comes from bundled skills: `factory-triage`, `factory-plan`, `factory-review`, `factory-rereview` and others. A project can **override** them by placing same-named skills under `src/mastra/public/factory-skills/` in the Factory project. The package says this lets projects "add (or override) Factory skills without patching the installed package" (`@mastra/factory@0.17.2` `dist/workspace.js:24-35`, `dist/skills/catalog.js:29`). The target repo's `.claude/skills` and `.agents/skills` are also loaded into every session workspace (`dist/workspace.js:507-511`). The general concept is covered in [Skills](https://mastra.ai/docs/skills). **Applies:** yes. This is the supported place to put our TDD and review rules.
- **Memory / observational memory (OM).** OM uses background Observer and Reflector agents to compress history into a dense observation log. It is turned on with `observationalMemory: true` in `Memory` options, and it requires a storage adapter (pg, libsql, mysql, mongodb, convex or oracledb). Thread scope is the default and the recommended scope; resource scope is deprecated. The recommended model is a fast one with a large context window; the default is `google/gemini-2.5-flash`, and `deepseek-v4-flash` has been tested. Studio's Memory tab shows the live observations and which models run them. ([Observational Memory](https://mastra.ai/docs/memory/observational-memory)) **Factory already enables it.** The code-sdk agent builds `Memory` with `observationalMemory: { enabled: true, temporalMarkers: true, retrieval, activateAfterIdle: 'auto', ... }` (`@mastra/code-sdk@1.8.3` `dist/agents/memory.js:128-170`). Factory re-applies per-project observer/reflector settings to each session (`@mastra/factory` `dist/session/factory-session.js:206-257`). Its storage is the Postgres + pgvector that Factory already requires ([Storage](https://factory.mastra.ai/configure/storage)).
- **Storage.** A single `PgFactoryStorage` + `PgVector` holds work items, sessions, memory and credentials, and survives restarts ([Storage](https://factory.mastra.ai/configure/storage)). **Applies:** in use.
- **Durability and health.** Factory's dispatcher uses leases, retries up to 5 attempts with backoff, and reconciliation (`dist/rules/dispatcher.js:16-30`). A deterministic supervisor computes `decision-stuck`, `start-stalled`, `seat-orphaned` and `held-waiting` findings "from storage rows alone — no model" every 5 minutes (`dist/supervisor/health.js:5-27`, `dist/supervisor/health-worker.js`). The findings are exposed at `GET /web/factory/projects/:id/supervisor/health` (`dist/routes/contracts.js:472`) and feed Overview / Needs attention ([Sessions](https://factory.mastra.ai/using/sessions)).
- **GitHub events.** Built-in rules cover `issueOpened`, `pullRequestMerged`, `pullRequestReviewSubmitted` and others (`dist/rules/types.d.ts:48`). A `CHANGES_REQUESTED` review sends "address the review" to the authoring Work session (`dist/integrations/github/default-rules.js:117-129`). Extra reviewer bots can be trusted through `MASTRACODE_GITHUB_AUTHORIZED_BOTS` (softwarefactory-template `src/mastra/index.ts:189`; `dist/integrations/github/webhook.js:239-259`). **Applies:** yes. This is the native send-back route and the native way for a second reviewer to reach the builder.
- **Models.** Factory has one default model per Factory, with personal or organisation credential scope ([Models](https://factory.mastra.ai/configure/models)). Per-phase or per-role model routing is not documented. Plain Mastra agents support ordered `model: [...]` fallbacks ([Models](https://mastra.ai/models)).
- **Separate cross-maker reviewer.** Mastra's official example is `mastra-ai/template-github-review-agent`. It is a Mastra agent plus a fixed 4-step workflow, with workspace skills for review standards and OM for large PRs, and "swap models" is supported ([README](https://github.com/mastra-ai/template-github-review-agent)). **Applies:** yes, for DeepSeek, because Factory cannot run a second model maker per phase.
- **Tools / MCP.** Mastra supports tools and MCP servers ([MCP](https://mastra.ai/docs/connections/mcp)). Factory sessions already have workspace tools and `gh`. **Applies:** not needed now.
- **Observability.** Traces cover every agent, tool and model call. Metrics (latency, tokens, cost) are derived from those traces. Both need `new Mastra({ observability: new Observability(...) })` and a store that supports them. Metrics need DuckDB, ClickHouse or Postgres VNext; LibSQL cannot hold metrics. ([Observability](https://mastra.ai/docs/observability/overview), [Metrics](https://mastra.ai/docs/observability/metrics/overview), [Studio observability](https://mastra.ai/docs/studio/observability)) Factory's generated entry passes no `observability` (softwarefactory-template `src/mastra/index.ts:435-440`). The code-sdk controller builds an `Observability` instance, but local trace storage is gated on the `localTracing` setting, which defaults to `false`. The platform exporter needs Mastra platform credentials (`@mastra/code-sdk` `dist/index.js:288-330`, `dist/onboarding/settings.js:159`). **Applies:** yes. It is probably off on our `--no-platform` server; this is unverified and should be checked with `npx mastra api trace list --url <factory>`.
- **Evals / scorers.** `runEvals` combines scorers with gates (must score 1.0) and thresholds, and returns a `passed`/`scored`/`failed` verdict. It runs in Vitest in CI ([Gates and verdicts](https://mastra.ai/docs/evals/gates-and-verdicts), [Running in CI](https://mastra.ai/docs/evals/running-in-ci)). **Applies:** later. It fits "the reviewer covered every acceptance criterion" and regression tests for our overridden skills.
- **Studio / dev server and deployment.** `mastra dev` serves Studio. `mastra build` produces a standalone Node server ([Mastra server](https://mastra.ai/docs/deployment/mastra-server)). For Factory, the self-hosted route is `create-factory --no-platform`, with a public HTTPS URL, Postgres and a credential key ([Deployment](https://factory.mastra.ai/deployment)). **Applies:** in use. Whether Studio's Memory and Traces views can be reached on our self-hosted Factory is unverified.
- **Signals / channels.** Signals are how outside events wake or steer an agent thread ([Signals](https://mastra.ai/docs/harness/signals)). Slack is Factory's supported chat channel ([Slack](https://factory.mastra.ai/configure/slack)). Factory "use[s] ... a web or mobile browser" ([What's Factory](https://factory.mastra.ai/what-is-factory)). No push-notification feature for Needs attention is documented.

## Feature checklist

| Feature | What it does | Applies to us? | Using it? |
|---|---|---|---|
| Factory Work + Review boards | Issue → triage → plan → build → PR → review | Yes, core | Yes (2nd trial, stock) |
| Custom board: `onEnter` / `tools.onResult` / `transitionPolicy` | Deterministic gates, agent starts | Only for a real gap (for example a hard UAT gate) | 1st trial used `transitionPolicy` only; no `onEnter`, so nothing ran |
| Factory skill overrides (`factory-skills/`) | Replace planner/reviewer instructions without patching | Yes: TDD plan, per-criterion review | No |
| Repo skills (`.agents/skills`) in sessions | Pocock skills visible to agents | Yes | Yes (loaded natively) |
| Observational memory | Compresses long sessions | Yes | Yes (Factory default); observer/reflector on GPT-6 Sol |
| Storage (Postgres + pgvector) | Durable cards, sessions, memory | Yes | Yes |
| Dispatcher retries/leases + supervisor health | Restart safety, stuck detection | Yes (R1, R6) | Built in; not relied on in the requirements |
| GitHub `pullRequestReviewSubmitted` rule | Todd's "Request changes" reaches the builder | Yes (R3) | Not exercised yet |
| `MASTRACODE_GITHUB_AUTHORIZED_BOTS` | Lets a reviewer bot notify the builder | Yes (DeepSeek bot) | No |
| Separate Mastra review agent (template) | Cross-maker review | Yes | No (1st trial forked a Factory session instead) |
| Model fallbacks | Automatic backup model | Only for the separate reviewer agent | No |
| Observability (traces, metrics, cost) | Diagnose from evidence, cost view | Yes (.docx req 37-38) | Probably not configured (unverified) |
| Evals / gates | Deterministic and qualitative checks of agent output | Later (.docx req 42) | No |
| Auto-start runs / Auto-approve plans | Removes Todd's Factory taps | Yes (R8, R20) | Off |
| Slack channel | Chat/phone access to sessions | Optional | No |
| Credential encryption, org-scope credentials | Safe shared model sign-in | Yes | Yes (org OpenAI OAuth per `ops/factory/README.md:26-28`) |

## Audit: deviations

**D1. The operator agent ran the card by hand beside Factory (1st trial).**
- **What we did:** The trial board's `red` and `build` working phases have no `onEnter` (`ops/factory/trial-board.mjs:62-69` at `25a073e`), so Factory never started an agent. Cards were moved by "jul183-controller", and RED/GREEN/guard were run over SSH (`docs/research/mastra-route-requirements.md:118-122`).
- **Mastra intends:** An `onEnter` → `invokeSkill` starts the phase's agent. `outcomes` "define the allowed moves without moving cards automatically" ([Boards and rules](https://factory.mastra.ai/configure/boards-and-rules)).
- **Lost if it stays:** Factory's retries, audit trail, health checks and idempotency don't cover the work, and the route depends on a long agent session. The first trial's session compacted twice.

**D2. Evidence lived in a hand-written file outside Factory.**
- **What we did:** `transitionPolicy` read a JSON manifest in `/var/lib/julia-factory/evidence/jul183` that the operator wrote (`trial-board.mjs:13-48`). "Phone delivery confirmed" evidence was typed by the operator as `confirmedBy: 'Todd'` (`.julia/complete-product-trial.mjs:31`).
- **Mastra intends:** Gates react to real Factory events. `tools.onResult` sees actual tool results, and `transitionPolicy` sees the item and actor ([API](https://factory.mastra.ai/reference/mastra-factory-api)). Deterministic checks of the repo belong in CI and the review skill's quality gate (`factory-skills/factory-review/SKILL.md`).
- **Lost if it stays:** The "deterministic proof" is only as honest as the agent that wrote it, which is the failure ADR 0009 set out to prevent.

**D3. Checkbox ticking, review requests and the merge were done by custom scripts using Factory's GitHub App keys.**
- **What we did:** `sync-evidence.mjs` hard-codes installation `165438606` and issue `#129` (lines 33-34 at `25a073e`). `.julia/resend-product-review.mjs` re-requests Todd. `.julia/complete-product-trial.mjs:6` imports `merge-pr.mjs` from a session sandbox.
- **Mastra intends:** Factory's GitHub integration and rules own GitHub side effects with idempotency keys, and merge goes through the repo's normal process ([Review items](https://factory.mastra.ai/using/reviews)). Direct external calls "don't receive that protection" ([API](https://factory.mastra.ai/reference/mastra-factory-api)).
- **Lost if it stays:** Duplicate or missed actions, and a merge path that bypasses GitHub's own protection.

**D4. The DeepSeek review ran as a forked Factory session instead of a separate reviewer.**
- **What we did:** Reviews used `forked: true` of the builder session to borrow the ChatGPT sign-in (`mastra-route-requirements.md:128`).
- **Mastra intends:** Factory has one default model ([Models](https://factory.mastra.ai/configure/models)). The official route to a second model is a standalone Mastra review agent ([template](https://github.com/mastra-ai/template-github-review-agent)) whose GitHub review Factory routes back to the builder (`default-rules.js:117-129`, `webhook.js:239-259`).
- **Lost if it stays:** The reviewer is not independent of the builder session, which breaks .docx requirements 17-19.

**D5. Mastra's own code was patched, twice.**
- **What we did:** We edited the skill loader (since removed) and the WorkOS cookie fix (still in place, approved exception #1; `ops/factory/apply-install-patches.py`). We also added temporary logging inside Mastra to prove which memory model ran (`mastra-route-requirements.md:112-116`).
- **Mastra intends:** Skill overrides go in `factory-skills/` (`dist/workspace.js:24-35`). Studio's Memory tab shows the Observer/Reflector model ([OM → Studio](https://mastra.ai/docs/memory/observational-memory)), and traces record model calls.
- **Lost if it stays:** Upgrades silently drop our changes. The WorkOS patch is the only one with a real upstream gap ([#25252](https://github.com/mastra-ai/mastra/issues/25252)) and a removal check. Keep that one; allow no new ones.

**D6. The observational-memory models are GPT-6 Sol.**
- **What we did:** "Personal and factory-wide observer/reflector settings select `openai/gpt-6-sol`" (`ops/factory/README.md:26`).
- **Mastra intends:** "a model that has a large context window (128K+) and is fast enough to run in the background". The default is `gemini-2.5-flash`, and `deepseek-v4-flash` and `-pro` have been tested ([OM → Models](https://mastra.ai/docs/memory/observational-memory)).
- **Lost if it stays:** Slower, heavier background calls that also draw on the builder's ChatGPT allowance. This is not verified as a problem, but it goes against the stated guidance. A DeepSeek flash model already has a key on the server.

**D7. Observability is not set up.**
- **What we did:** Nothing in the repo or the change logs configures `@mastra/observability`. The template passes none, and the code-sdk defaults `localTracing: false` (see above).
- **Mastra intends:** Configure observability and use Studio's Traces and Metrics views ([Observability](https://mastra.ai/docs/observability/overview)).
- **Lost if it stays:** ADR 0009 chose Mastra "for its dashboard, metrics, observability", but failures are still diagnosed from agent narrative. This is unverified on the server.

**D8. Process was put in a custom board instead of Factory's skills.**
- **What we did:** ADR 0009 says requirements 10-16 "become Factory board phases" (`docs/adr/0009-mastra-factory.md:17-19`). The trial built a parallel `julia-trial` board.
- **Mastra intends:** The stock Work board already plans, builds and reviews. In the 2nd trial it chose test-first on its own (`mastra-route-requirements.md:147`). Phase *behaviour* is customised by overriding `factory-plan` / `factory-review` skills. A board is for a different process ([Boards and rules](https://factory.mastra.ai/configure/boards-and-rules)).
- **Lost if it stays:** A custom board doesn't inherit the Work board's `submit_plan` handling or its acceptance policy ([API → Tool results](https://factory.mastra.ai/reference/mastra-factory-api)), so we would rebuild them.

**D9. The review verdict is not "approve".**
- **What we did:** The 2nd trial treated the comment plus `status:auto-approved` label as a problem (`mastra-route-requirements.md:147`).
- **Mastra intends:** "GitHub forbids an app from reviewing a pull request it authored, so ... the review skill falls back to posting its verdict as a plain comment" (`default-rules.js:130-139`). This is by design, not a fault.
- **Lost if it stays:** Nothing, as long as nobody builds a workaround for it.

**D10. Standing docs still describe hand-driven builds.**
- **What we did:** `docs/agents/work-execution.md:18-50` tells a coordinator to build and review by hand. `CLAUDE.md` still names the Pydantic graph.
- **Mastra intends:** Factory sessions do the build and review ([Work items](https://factory.mastra.ai/using/work-and-approvals)).
- **Lost if it stays:** Agents following repo instructions will keep driving cards by hand. That is D1 again.

**D11. The CI runner and the old graph fixtures were changed to make the trial pass.**
- **What we did:** We installed a self-hosted runner on OVH and edited the graph test fixtures (`mastra-route-requirements.md:124,131`). Both have since been removed (`docs/agents/factory-platform-auth-change-log.md`, "Stock Factory reset" step 5).
- **Mastra intends:** This is not a Mastra concern. It is listed only because it was machinery built around Factory.
- **Lost if it stays:** Nothing. It is already reverted.

## Requirements to cut or simplify

In `docs/research/mastra-route-requirements.md`:

- **R3 (send-back) → verify, don't build.** It is native: `CHANGES_REQUESTED` → `sendMessage` to the Work session (`default-rules.js:117-129`). Keep it only as a proof test.
- **R4 (per-card models with automatic backups) → cut to "builder and reviewer from different makers".** Factory has one default model ([Models](https://factory.mastra.ai/configure/models)). ADR 0009 already says "Per-card overrides wait until they are missed" (`0009:63`). Put backups on the separate reviewer agent through Mastra `model: [...]` fallbacks ([Models](https://mastra.ai/models)).
- **R6 (crash restarts the step) → verify, don't build.** Durable storage, leases and retries are built in (`dispatcher.js:16-30`; [Storage → Verify persistence](https://factory.mastra.ai/configure/storage)).
- **R1 (stuck card to phone) → narrow it.** Detection exists: the supervisor health findings and endpoint. Only delivery to Todd's phone is missing. Any custom piece should read `/supervisor/health` rather than compute "stuck" itself. ADR 0009 defers this.
- **R8 (phone = GitHub only) → reconsider.** It fights Factory's design. Accept, plan approval and review start live in Factory, which runs in a mobile browser ([What's Factory](https://factory.mastra.ai/what-is-factory)). Most of the taps disappear with Auto-start runs and Auto-approve plans ([Work items](https://factory.mastra.ai/using/work-and-approvals)). The built-in acceptance of non-bug tasks stays, unless a custom policy records `accept: true` ([API](https://factory.mastra.ai/reference/mastra-factory-api)).
- **R20 (start without an agent) → a setting, not a requirement.** Auto-start runs or Investigate already do this. The one real task is closing old open issues so Auto-start is safe.
- **R21 (acceptance = merge) → use GitHub's own auto-merge plus a branch rule requiring Todd's approval.** Factory intentionally leaves merge to the repo ([Review items](https://factory.mastra.ai/using/reviews)). No custom code is needed. The GitHub-side behaviour has not been verified here.
- **R17 + R19 (plain audit program; progress from the check) → shrink.** Factory already records the actor type (human or agent) and the ingress on every transition (`dist/rules/types.d.ts:73-79`; `configVersion` "recorded in audit entries", [API](https://factory.mastra.ai/reference/mastra-factory-api)). With observability on, traces show who did what. A small script that reads Factory's own records is enough; don't build a separate audit system.
- **R11 + R18 (patch removal; exception list) → merge into one list.** `ops/factory/README.md` and the change log already hold it.
- **R12, R13, R14 → drop as requirements.** They are one-time housekeeping (CI choice, doc updates, brief template), not route behaviour.
- **Add what is missing:**
  - Configure Mastra observability (.docx req 37-38).
  - Move the OM models to a fast model (D6).
  - Override `factory-plan` / `factory-review` skills to carry the TDD seam and the per-criterion adversarial verdict (D8).
  - Build the DeepSeek reviewer from the official review-agent template, trusted through `MASTRACODE_GITHUB_AUTHORIZED_BOTS` (D4).

In ADR 0009:
- "Requirements 10-16 become Factory board phases" should become "become overridden Factory skills plus CI checks" (D8).
- "A deterministic check ticks each box" is a Julia convention that Factory has no feature for. Direct GitHub writes from handlers aren't idempotency-protected. Either accept Factory's board and session as the progress view, or keep this as a named exception.

In the .docx: it is broadly aligned with Mastra, and D1-D4 are breaches of its own requirements 4, 5, 12 and 19. Requirement 29 (supervisors/subagents) and requirement 44 (extra roles) are not needed now.

## Sources

- Factory docs, fetched 2026-09-27: [index](https://factory.mastra.ai/llms.txt), [What's Factory](https://factory.mastra.ai/what-is-factory), [Work items](https://factory.mastra.ai/using/work-and-approvals), [Review items](https://factory.mastra.ai/using/reviews), [Sessions](https://factory.mastra.ai/using/sessions), [Models](https://factory.mastra.ai/configure/models), [GitHub](https://factory.mastra.ai/configure/github), [Slack](https://factory.mastra.ai/configure/slack), [Auth](https://factory.mastra.ai/configure/auth), [Storage](https://factory.mastra.ai/configure/storage), [Boards and rules](https://factory.mastra.ai/configure/boards-and-rules), [Deployment](https://factory.mastra.ai/deployment), [MastraFactory API](https://factory.mastra.ai/reference/mastra-factory-api).
- Mastra docs: [index](https://mastra.ai/llms.txt), [Observational Memory](https://mastra.ai/docs/memory/observational-memory), [Storage](https://mastra.ai/docs/storage), [Workflow suspend/resume](https://mastra.ai/docs/workflows/suspend-and-resume), [Workflow HITL](https://mastra.ai/docs/workflows/human-in-the-loop), [Agent HITL](https://mastra.ai/docs/agents/human-in-the-loop), [Agent Controller](https://mastra.ai/docs/harness/agent-controller), [Signals](https://mastra.ai/docs/harness/signals), [Skills](https://mastra.ai/docs/skills), [MCP](https://mastra.ai/docs/connections/mcp), [Observability](https://mastra.ai/docs/observability/overview), [Tracing](https://mastra.ai/docs/observability/tracing/overview), [Metrics](https://mastra.ai/docs/observability/metrics/overview), [Studio observability](https://mastra.ai/docs/studio/observability), [Gates and verdicts](https://mastra.ai/docs/evals/gates-and-verdicts), [Evals in CI](https://mastra.ai/docs/evals/running-in-ci), [Models / fallbacks](https://mastra.ai/models), [Mastra server](https://mastra.ai/docs/deployment/mastra-server), [createCodingAgent](https://mastra.ai/reference/coding-agent/create-coding-agent).
- Package source (npm tarballs): `@mastra/factory@0.17.2`: `dist/workspace.js`, `dist/skills/catalog.js`, `dist/rules/dispatcher.js`, `dist/rules/types.d.ts`, `dist/supervisor/health.js`, `dist/supervisor/health-worker.js`, `dist/routes/contracts.js`, `dist/integrations/github/default-rules.js`, `dist/integrations/github/webhook.js`, `dist/session/factory-session.js`, `factory-skills/factory-review/SKILL.md`. `@mastra/code-sdk@1.8.3`: `dist/agents/memory.js`, `dist/index.js`, `dist/onboarding/settings.js`.
- Mastra GitHub: [softwarefactory-template `src/mastra/index.ts`](https://github.com/mastra-ai/softwarefactory-template/blob/main/src/mastra/index.ts) (commit `de6e806`, 2026-09-25), [template-github-review-agent](https://github.com/mastra-ai/template-github-review-agent), [issue #25252](https://github.com/mastra-ai/mastra/issues/25252).
- Repo: `docs/adr/0008-smallest-working-route.md`, `docs/adr/0009-mastra-factory.md`, `docs/research/mastra-route-requirements.md`, `docs/research/Julia_Mastra_Factory_Requirements.docx`, `julia-next-handoff-2026-09-26-mastra-trial.md`, `docs/agents/work-execution.md`, `docs/agents/factory-platform-auth-change-log.md`, `ops/factory/*`, `.julia/*.mjs`, and `ops/factory/{trial-board,sync-evidence,configure-entry,trial-transition.check}.mjs` at `origin/factory/jul183-home-version` `25a073e`. `docs/retros/journey-zero-notes.md` predates Mastra and was not used.
- Not verified: server-side trace storage, whether Studio can be reached on our self-hosted Factory, the exact GitHub auto-merge behaviour with the Factory App as PR author, and whether a trusted bot's `CHANGES_REQUESTED` triggers the rework rule end to end.
