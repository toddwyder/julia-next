# Mastra builder and reviewer agents: settled design and parked items

As of Sun 11 Oct 2026. This file is the source of truth for the Mastra agents. If a brief and this file disagree, this file wins. Mastra docs findings behind the 11 Oct changes: `claude/mastra-memory-research.md`.

## Where things stand
- Spike (closed PR #286) proved a Mastra agent on DeepSeek 4.1 Flash via CommandCode can use read-only tools and return a strict structured review in one run. Spike verdict on PR #282: PASS, 16 of 16 quotes verified.
- Real reviewer is in PR #287 (open). Six live attempts on 10-11 Oct were reported as reviewer-identity mismatches because the runner validated a missing observed identity before considering the worker's nonzero exit. Retained evidence separates three millisecond-scale preflight failures from three 79–139 second paid executions with storage/shutdown errors. The runner now reports nonzero worker exits as the primary failure and validates identity only for an exit-zero worker; an exit-zero missing or mismatched identity still fails closed. Earlier failures also exposed end-of-run database cleanup and missing-internal-span defects; those have regression coverage. The first 11 Oct proof attempt then showed that the AI SDK's OpenAI-compatible response schema removes CommandCode's non-standard `usage.cost` field before its metadata extractor runs. The provider transport now validates and retains raw response token usage before schema normalization, keyed by response ID, and fails closed when required token counts are missing or invalid.
- Spend limit: $1.00 per card (JUL-206 covers the #282 review; a separate $1.00 covers the #287 review). There is NO limit on the number of runs. Other runaway guards: time limits, stuck-worker rule, same step failing twice, two review rounds then park.
- PR #284 (OVH move) stays a draft, not merged. OVH VPS is cancelled only after the new reviewer is proven.
- 1Password: Julia-vault-only read_items service account, token DPAPI-protected on the laptop, unattended. Expires 6 Jan 2027 Pacific.

## Settled design
- Two Mastra agents, builder and reviewer, called as steps by the existing delivery runner. The runner owns sequence, saved state, lock, kill-orphan-workers and authorization checks.
- Look it up, don't recall it: use version-matched documentation bundled with each installed package first; otherwise use the tool's official `llms.txt` index and fetch only the applicable individual page, never `llms-full.txt`. The Mastra docs MCP server is a fallback only. Every framework-map job cites the exact page used. Custom code is allowed only after the applicable docs show the stock tool has no feature for the need, and the report records the gap.
- Models from the per-card configuration (JUL-195). Default: CommandCode `deepseek/deepseek-v4.1-flash`. Reviewer must be a different maker from the builder.
- Instructions: reviewer = `.agents/skills/adversarial-review/SKILL.md` plus CODING_STANDARDS.md. No builder role file yet; `julia-builder` still referenced in 5 legacy places.
- **Reviewer memory (Todd, 11 Oct): no observational memory.** Observational memory works only within one conversation, starts after about 30,000 tokens, and its cross-conversation mode is deprecated, so it cannot carry anything between one-shot reviews. Reviewer uses: message history; working memory, resource-scoped, holding Todd's standing rules (section "Standing rules for the reviewer"); semantic recall, resource-scoped, LibSQL vector store, local FastEmbed (one embedding model, needs a clean Windows proof). One stable resource for the reviewer, one thread per review. Reviewer memory is never shared with the builder (different resource). Revisit observational memory for the builder, whose sessions run long.
- Memory persists between reviews. Nothing is deleted at the end of a run.
- Tools: builder reads, writes, commits to its own branch, runs tests; reviewer is read-only and points at the commit. Neither merges, creates tickets or deletes.
- Structured output for the review and the builder's hand-off report. Quote check stays (every quote word for word in the named file or diff at that commit).
- **Verdict first:** the reviewer saves and returns its verdict before any end-of-run step. No end-of-run step may lose or replace a verdict.
- **End of run order:** verdict out; wait for memory background work (`memory.settled()`); flush observability; then close storage. No deletion.
- Guards: UnicodeNormalizer plus PromptInjectionDetector in warn-only mode.
- **Storage (Todd, 11 Oct):** traces, cost metrics, and permanent run-summary logs live together in one stock local DuckDB observability store. Reviewer message history, resource-scoped working memory, and resource-scoped semantic recall remain in LibSQL. Use Mastra's stock domain storage configuration; no custom per-method storage adapter. Configure the supported DuckDB `memoryLimit: '1GB'` and `threads: 1` options so full internal traces retain checkpoint headroom within the laptop's working set instead of using the adapter's 2 GB default ([installed DuckDB store types](../ops/mastra-agents/reviewer/node_modules/@mastra/duckdb/dist/storage/index.d.ts)). Configure the stock storage exporter with `maxBatchSize: 100` so it stays below the adapter's default batch of up to 1,000 events without triggering overlapping one-event checkpoints ([installed exporter types](../ops/mastra-agents/reviewer/node_modules/@mastra/observability/dist/exporters/mastra-storage.d.ts)). DuckDB uses its documented `preserve_insertion_order=false` OOM setting and Zstandard checkpoint compression ([DuckDB OOM guide](https://duckdb.org/docs/stable/guides/troubleshooting/oom_errors), [DuckDB pragmas](https://duckdb.org/docs/stable/configuration/pragmas)).
- **Tracing (Todd, 11 Oct):** `includeInternalSpans: true` (otherwise model, tool and step contents are dropped) and Mastra's default SensitiveDataFilter. Traces must show each step's content, tokens, and cost.
- **Retention (Todd, 11 Oct):** configure stock DuckDB observability retention only for spans, with `maxAge: '14d'`, and exercise stock `storage.prune()` through the reviewer's external-scheduler target. Metrics/cost records, logs/permanent summaries, and LibSQL memory have no retention policy and are never pruned. Do not delete at startup or shutdown. Install the laptop schedule from the merged checkout after UAT so it never points at a disposable PR worktree. Mastra pruning deletes rows but does not shrink the database file.
- **Permanent run summary (Todd, 11 Oct):** emit exactly one line per run through stock Mastra logging and keep it permanently. The line contains card, change, round, verdict or stop and reason, reviewer model and effort, safety-check model and effort, input/output tokens, cost, start/end time, and the memory and observability database sizes. When a provider has no effort setting, record that explicitly and cite its documentation.
- **Cost (Todd, 11 Oct, latest decision):** TokenCostControl ($1.00 per card) uses input/output/cache tokens multiplied by CommandCode's published `deepseek/deepseek-v4.1-flash` rates, recorded as `estimated` through stock `MetricsContext.emit(..., { costContext })`; this includes PromptInjectionDetector's safety call. At card start and after every run, the launcher-resolved key reads `/alpha/usage/summary`. The permanent summary records that machine-wide delta as `actual` next to the estimate and explicitly notes that concurrent CommandCode usage can only overcount the run. When actual exceeds estimate, the positive adjustment enters the stock brake aggregate, so an overrun larger than the remaining card budget blocks the next paid call. Missing or invalid token counts still fail closed. The runner refuses to start unless tracing, cost recording, and the start usage snapshot are live. Rates checked 11 Oct 2026: off-peak/weekend $0.15/M input, $0.60/M output, $0.003/M cache read; weekday peak (01:00–04:00 and 06:00–10:00 UTC) $0.30/M input and $1.20/M output; CommandCode publishes no separate peak cache rate.
- No human-in-the-loop in builder or reviewer. Anything needing Todd parks the card with a visible reason.
- Park visibility: post one safe, idempotent line to the Linear card after local state is saved.
- Scorers: passive recorder only. Model choice by an escalation ladder, authorized up front on the card. The stock permanent summary log is the run ledger.
- Delivery order is independent review, then Todd's UAT on the Vercel preview, then merge. Reviewers and automated runners never merge.
- No arbitrary caps. Still to remove: the 130,000-byte cap in the older minimal runner, the 5-failure/500-character trimming in the old controller.

## Reviewer acceptance evidence (Todd, 11 Oct)
Three pieces, retrieved and explained in plain English with where each came from:
1. A trace of one review: what it read, what the model did, tokens and cost per step.
2. Working memory: Todd's standing rules on the reviewer's notepad, and a review visibly applying one.
3. Semantic memory: a second review retrieving something relevant from the first, with the match shown.
Shown first in a free end-to-end run with a stand-in model, then on the real reviews of #282 and #287. The free proof also verifies one correct permanent summary per run, the brake total equals the sum of cost records (including the safety check), and stock 14-day retention deletes only traces while summaries, cost records, and memory remain. It runs locally and in CI.

## Standing rules for the reviewer (seed for working memory)
- Every quote must appear word for word in the named file or diff at the reviewed commit.
- No arbitrary caps or limits; flag any new one.
- Never ask Todd; anything needing a human parks the card with a visible reason.
- Agents never create tickets, merge, or delete.
- Prefer stock Mastra features; flag custom code that duplicates one.
- Flag missing tests and missing logging.

## Working rules for agents (this effort)
- Do not do code work without Todd's permission. Conserve tokens.
- Read this file before starting any Mastra work; it wins over a brief.
- For a root-cause analysis, work from the symptom and evidence with the diagnose-bugs skill, not from a hypothesis.
- Nothing may depend on Todd signing in repeatedly. At most one atomic account-owner approval. Never ask Todd about workspaces, branches or Git state.
- Each step ends in something Todd can see.

## Parked items, in the order they come up
1. Reviewer: build to this design, free end-to-end proof with the required retained evidence, diagnose and fix the reviewer-identity mismatch, then complete the real reviews of #282 (JUL-206) and #287 under $1.00 each. Todd performs UAT on the #287 Vercel preview before merge.
2. Runner preflight: the runner checks a card's assumptions and credentials before starting, repairs what it can, and posts stop reasons to the card.
3. Credential-list writer: the migration writer must add to `secrets.env`, not overwrite it.
4. Builder: research what Mastra gives a coding agent, small spike, build; builder role file; clean `julia-builder` references.
5. Token renewal (expires 6 Jan 2027): automatic or one tap.
6. Escalation ladder.
7. OVH cancellation after the reviewer is proven.
8. Smaller cleanups: confirm the cost ceiling from a real run; revoke stale 1Password service accounts; retire the old graph controller; close stale PR #184; investigate JUL-196's stall.
