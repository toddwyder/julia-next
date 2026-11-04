# Handoff, 31 Oct 2026, ~23:10 PT (advisor to Todd)

Supersedes `claude/session-handoff-2026-10-31-1250.md` where they differ. Everything not mentioned here still stands.

## Where things stand

The redesign "Shipping you can trust" is now two finished slices, with the rest parked. Plan, decisions and evidence are in artifacts, not repeated here:
- Plan (machine-setup): https://linear.app/julia-next/document/plan-shipping-you-can-trust-2026-10-31-0da15c88507c
- Slice 1, complete (old verdict-reading gate off main, the Julia Runner GitHub App exists, Linear identity is a label): https://linear.app/julia-next/issue/JUL-300/slice-1-clear-the-old-way-and-name-the-runner
- Slice 2, complete (a fresh Shipping agent on a free model, started by a Mastra workflow, ran the criterion itself and posted PASS+NOTES): https://linear.app/julia-next/issue/JUL-301/slice-2-the-shipping-agent-reviews-the-evidence-and-decides
- The determination: https://github.com/toddwyder/julia-next/pull/401
- Slice 3 (JUL-302) was cancelled as parked. The guard on main only returns if a builder still goes around the workflow once the machine runs.
- Parent card, reopened to Triage by me after it auto-completed: https://linear.app/julia-next/issue/JUL-299/shipping-you-can-trust-a-fresh-verifier-the-runners-own-identity-and-a . Its criteria are still the OLD wide set and need rewriting to the real scope.
- "Connect the path" (JUL-291) auto-cancelled when I cancelled its last open child (JUL-295). Linear closes a parent when every child is closed; check before changing a child's status.

Proof that the Shipping agent really judged it: I re-ran its commands on the pull request head and they matched; a separate read-only audit of the Mastra trace showed the workflow run, the model answering as the free Beam model, seven recorded tool calls, and the agent's answer stored whole and identical to the comment. Limit: the comment's headings and tables are composed by `machine/shipping/determination.mjs` after the run. Exit codes are mostly missing from Mastra's record. Beam's cost is null in the trace.

## Pending

- **One message to the builder was written for Todd to send** (not confirmed sent). It carries: revert retro fixes 1, 3, 5 and keep 2, 4; deviation rows 10 to 13 approved, row 12 reworded, row 8 replaced with the free-model decision, header line on when a row needs Todd; a new AGENTS.md rule that rules and criteria name a kind of model, with a brief-checker check; remove the builder's extra "Criteria" section from the slice 2 card; run the cleanup card https://linear.app/julia-next/issue/JUL-306 ; one pull request, no other card. First job: find out whether it was sent and verify each item from main, GitHub and Linear before relaying anything.
- Remediation is the next card and is not written. Write it through `tighten`. It carries the fail cases, the adversarial cases (a change that claims done but the evidence is missing or faked), the missing exit codes, retry on Beam's 429 throttling, and Beam's first tool call being rejected for a missing argument. Decision made: the builder fixes its own failure in its resumed session; a fresh session only if its session is gone.
- Rewrite the parent card's criteria to the delivered scope (with the remediation card).
- Later cards, none filed: memory helpers on a free model, the Julia verifier, accurate whole-session cost, the guard on main, the runner merging after Todd's yes, pause and restart, saving proofs as feature recipes plus the post-deploy smoke test.
- Small: dashboard health bug card (JUL-303, Triage); throwaway card JUL-304 and pull request 399 await the cleanup.
- Open question I raised and Todd has not answered: whether the plan's "Sol for a paid round" is a standing rule or a choice for that round. Todd said model choices are per round, not rules.

## Todd's decisions this session (his words or a clear yes)

- Slice 2 is only the evidence review and the determination. "Green means nothing to me, evidence is everything." A FAIL is a win. Fail cases belong to remediation.
- Use Mastra agents, Mastra workflows and pstack fully, no homemade scripts standing in.
- Slice 2 builder was DeepSeek for that round only. A model choice for a round is not a rule. Helpers use "a free model", not Beam specifically.
- Linear identity is the label "Julia runner:" (the existing key). GitHub identity is the Julia Runner App, key on the server, created by the manifest flow.
- The runner does not merge in these slices. Builder goes away once the machine runs.
- Retro: fixes 1, 3, 5 reverted; 2 and 4 kept. Deviation rows 10 to 13 approved.

## How to work with Todd (reinforced today)

- One decision at a time, plain English, no tables, with a recommendation and the reason. He hates tables.
- Never put approvals in his voice. Finish the discussion, then give him one message for the builder, not one per item.
- Do not hand him key, token or mechanics work; design the secret out. Solve ahead of time instead of handing blockers back piecemeal.
- Do not narrow a general decision to a named instance. Do not add rules, skills or criteria he did not ask for; check the repo's own rules first (YAGNI, then the inverse pyramid: code before prose).
- Verify an agent's claims on the real page. Put every link in the same message. Do not refer to cards by number alone. Agent prompts open with "Read .agents/skills/poteto-mode/SKILL.md and follow it as a new task." and are one copyable block.
- Closing a card by cutting the hard part is a fake green light; he caught that parent auto-complete.

## Tools

- Clone of the repo at `/home/claude/jn/repo` (shallow, ephemeral); brief checker `node scripts/check-agent-brief.mjs <file>`. It flags words like file, branch, code, no, not in acceptance criteria.
- Linear MCP: `save_issue` and `save_document` accept `patch` operations; read back after saving.
- GitHub: WebFetch works on pull pages (cached up to 15 minutes); `git ls-remote` and `git fetch origin pull/<n>/head` work; the API is blocked.
- Built-in browser is signed in to Linear, not GitHub. The Chrome extension was not connected.
- `/advisor` typed as a command is intercepted as unavailable; ask for the advisor skill by name. `/tighten` works.
- Two skill proposals (advisor update, tighten update) were shown as cards; whether Todd saved them is unknown. Todd said lessons should not go into `tighten`; use `tighten` on them instead.

## Suggested skills

- `anthropic-skills:advisor`: before relaying an agent report or advising Todd.
- `anthropic-skills:tighten`: before writing the remediation card, the parent card rewrite, or any agent prompt.
- `anthropic-skills:julia-route-check`: before handing him a prompt, card or plan, and before calling anything done.
- `anthropic-skills:sharpen`: when he asks for a plan or recommendation.
- `anthropic-skills:julia-retrospective`: only if he says "retrospective".
