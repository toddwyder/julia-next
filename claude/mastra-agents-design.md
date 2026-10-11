# Mastra builder and reviewer agents: settled design and parked items

As of Sun 11 Oct 2026, 07:45 Pacific. This file is the source of truth for the Mastra agents. If a brief and this file disagree, this file wins. Mastra docs findings behind the 11 Oct changes: `claude/mastra-memory-research.md`.

## Where things stand
- Spike (closed PR #286) proved a Mastra agent on DeepSeek 4.1 Flash via CommandCode can use read-only tools and return a strict structured review in one run. Spike verdict on PR #282: PASS, 16 of 16 quotes verified.
- Real reviewer is in PR #287 (open). Live attempts on 10-11 Oct reached the model but lost every verdict: the end-of-run cleanup deleted the database while it was in use (Windows EBUSY), and the error replaced the result. Traces were empty because internal spans were excluded. JUL-206 is parked.
- Spend limit: $1.00 per card (JUL-206 covers the #282 review; a separate $1.00 covers the #287 review). There is NO limit on the number of runs. Other runaway guards: time limits, stuck-worker rule, same step failing twice, two review rounds then park.
- PR #284 (OVH move) stays a draft, not merged. OVH VPS is cancelled only after the new reviewer is proven.
- 1Password: Julia-vault-only read_items service account, token DPAPI-protected on the laptop, unattended. Expires 6 Jan 2027 Pacific.

## Settled design
- Two Mastra agents, builder and reviewer, called as steps by the existing delivery runner. The runner owns sequence, saved state, lock, kill-orphan-workers and authorization checks.
- Stock Mastra first: every Mastra feature is configured from Mastra's own docs for the pinned version (@mastra/core 1.75.0), read through the Mastra docs MCP server (@mastra/mcp-docs-server 1.3.5), not from memory. Custom code only where the docs show Mastra has nothing, and the report says what was checked.
- Models from the per-card configuration (JUL-195). Default: CommandCode `deepseek/deepseek-v4.1-flash`. Reviewer must be a different maker from the builder.
- Instructions: reviewer = `.agents/skills/adversarial-review/SKILL.md` plus CODING_STANDARDS.md. No builder role file yet; `julia-builder` still referenced in 5 legacy places.
- **Reviewer memory (Todd, 11 Oct): no observational memory.** Observational memory works only within one conversation, starts after about 30,000 tokens, and its cross-conversation mode is deprecated, so it cannot carry anything between one-shot reviews. Reviewer uses: message history; working memory, resource-scoped, holding Todd's standing rules (section "Standing rules for the reviewer"); semantic recall, resource-scoped, LibSQL vector store, local FastEmbed (one embedding model, needs a clean Windows proof). One stable resource for the reviewer, one thread per review. Reviewer memory is never shared with the builder (different resource). Revisit observational memory for the builder, whose sessions run long.
- Memory persists between reviews. Nothing is deleted at the end of a run.
- Tools: builder reads, writes, commits to its own branch, runs tests; reviewer is read-only and points at the commit. Neither merges, creates tickets or deletes.
- Structured output for the review and the builder's hand-off report. Quote check stays (every quote word for word in the named file or diff at that commit).
- **Verdict first:** the reviewer saves and returns its verdict before any end-of-run step. No end-of-run step may lose or replace a verdict.
- **End of run order:** verdict out; wait for memory background work (`memory.settled()`); flush observability; then close storage. No deletion.
- Guards: UnicodeNormalizer plus PromptInjectionDetector in warn-only mode.
- **Tracing (Todd, 11 Oct):** local LibSQL; `includeInternalSpans: true` (otherwise model, tool and step contents are dropped); Mastra's default SensitiveDataFilter. Traces must show each step's content, tokens and cost.
- **Cleanup (Todd, 11 Oct): removed entirely until the reviewer is proven to run properly.** Added back later as Mastra's documented age-based retention plus `storage.prune()` from a scheduler, never at startup or shutdown. Deleting a card's traces after its retro would be custom (Mastra has no such feature) and is decided then.
- **Cost (Todd, 11 Oct):** LibSQL cannot store metrics, so cost records go to a second local database: route only the observability metrics to DuckDB (Mastra's documented local setup). TokenCostControl ($1.00 per card) reads from it. The runner refuses to start an agent unless tracing and cost recording are live. The model's price comes from Mastra's pricing registry or the documented way to supply one.
- No human-in-the-loop in builder or reviewer. Anything needing Todd parks the card with a visible reason.
- Park visibility: post one safe, idempotent line to the Linear card after local state is saved.
- Scorers: passive recorder only. Model choice by an escalation ladder, authorized up front on the card. A run ledger must be built (model, role, round, verdict, park reason, cost with source).
- No arbitrary caps. Still to remove: the 130,000-byte cap in the older minimal runner, the 5-failure/500-character trimming in the old controller.

## Reviewer acceptance evidence (Todd, 11 Oct)
Three pieces, retrieved and explained in plain English with where each came from:
1. A trace of one review: what it read, what the model did, tokens and cost per step.
2. Working memory: Todd's standing rules on the reviewer's notepad, and a review visibly applying one.
3. Semantic memory: a second review retrieving something relevant from the first, with the match shown.
Shown first in a free end-to-end run with a stand-in model, then on the real reviews of #282 and #287.

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
1. Reviewer: build to this design, free end-to-end proof with the three pieces of evidence, then the real reviews of #282 (JUL-206) and #287, merge, close JUL-206.
2. Runner preflight: the runner checks a card's assumptions and credentials before starting, repairs what it can, and posts stop reasons to the card.
3. Credential-list writer: the migration writer must add to `secrets.env`, not overwrite it.
4. Builder: research what Mastra gives a coding agent, small spike, build; builder role file; clean `julia-builder` references.
5. Token renewal (expires 6 Jan 2027): automatic or one tap.
6. Escalation ladder.
7. OVH cancellation after the reviewer is proven.
8. Cleanup back in: age-based retention and scheduled prune; decide on post-retro trace deletion.
9. Smaller cleanups: confirm the cost ceiling from a real run; revoke stale 1Password service accounts; retire the old graph controller; close stale PR #184; investigate JUL-196's stall.
