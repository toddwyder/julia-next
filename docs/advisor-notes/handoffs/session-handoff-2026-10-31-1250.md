# Handoff, 31 Oct 2026, ~12:50 PT (advisor to Todd)

Supersedes `claude/session-handoff-2026-10-31-0735.md` where they differ. Everything not mentioned here still stands.

## Where things stand

Todd stopped patching the runner and chose to redesign Shipping. Plan and decisions are in artifacts, not repeated here:
- Card (Triage, nothing starts from it): https://linear.app/julia-next/issue/JUL-299/shipping-you-can-trust-a-fresh-verifier-the-runners-own-identity-and-a. It passes `node scripts/check-agent-brief.mjs` (run on the clone). Three parts only (Outcome, Acceptance criteria, UAT steps); the repo's `.claude/skills/triage/AGENT-BRIEF.md` retired proof/constraints sections.
- Plan, decisions, build order: Linear document "Plan: Shipping you can trust 2026-10-31" (machine-setup), https://linear.app/julia-next/document/plan-shipping-you-can-trust-2026-10-31-0da15c88507c
- Step 1 (check the ground, done): https://linear.app/julia-next/document/step-1-check-the-ground-2026-10-31-a3342a66d029
- Why CI and evidence testing kept failing: https://linear.app/julia-next/document/step-back-why-evidence-testing-and-ci-keep-failing-2026-10-31-949aea06ab0e
- Runner vs stock Mastra comparison: Linear document "Research: card runner vs stock Mastra 2026-10-31" (machine-setup).

## Pending

- **Slicing.** Todd asked for poteto-mode (pstack multi-phase plan playbook) to split JUL-299 into as few slices as possible, because each slice costs tokens. I gave him a prompt for a Mastra Code session. **Unconfirmed that he pasted it.** If it ran: read the sub-issues and the comment on JUL-299, run the checker on each slice, verify claim by claim before relaying. My own suggestion, not agreed: two cards (clear and set the rules; the runner), with the real-card run being an existing Julia card.
- Nothing else is waiting on Todd. Later approvals the plan needs: the deletion list, one workflow-file edit, the GitHub App, the Linear app install, UAT.
- Open facts from step 1: owner GitHub plan unknown; installed GitHub Apps unreadable with the server token; whether the Julia controller Linear app's credentials still exist; no $0 model exists, so the first SDK session test needs one trivial Opus session.

## Corrections to the earlier handoff

- Main did merge today (PRs 392, 393). "Nothing merged since 26 Oct" was my error, repeated in a brief.
- The "criteria wording" refusal hit a free Shipping pass, not a paid one. The three paid losses: two `fetch failed` posts and one model-name refusal.
- The paid #394 proof review ran no commands (read one file by API) and its cost was last-step only, about 30-40 times low.
- Stock Shipping worked on 26 Oct (verdict comments on PRs 356 and 358). PRs 360 and 362 merged on 27 Oct with no verdict. Nothing mechanical stops that.

## Todd's decisions this session (his words or clear yes)

Stay on Mastra Code `execute` subagent for the verifier; Opus reviews; separate verifiers for Julia and machine; runner gets its own identity on GitHub and Linear; pause and crash recovery in the first build; each verified card saves its proof as a feature recipe (deviation row); "a FAIL is a result, not a failure"; the builder stays unrestricted on the server for now (restriction returns only if the launch record shows a run the builder started). Todd rejected: recommending without research, manual-versus-runner framing, withholding a key as a "guard", briefs instead of plans.

## How to work with Todd (reinforced)

- One decision at a time, plain English, pros, cons, recommendation, reason. Do not lawyer past decisions.
- Research and verify before recommending. Do not return with "unverified" hedges: verify, or say it needs a test and why.
- Do not patch; ask why it failed. Prefer paying less. No briefs when he asks for a plan.
- Briefs for agents open with "Read .agents/skills/poteto-mode/SKILL.md and follow it as a new task." Not diagnose-bugs.
- Do not refer to cards by number in replies to him.

## My slips this session (for the stop log and retro)

Recommended tossing Shipping without reading stock; flagged an unverified gap and recommended anyway (twice); put a wrong "nothing merged since 26 Oct" fact into a brief; offered manual-versus-runner against his 30 Oct decision; first card draft had retired sections; proposed repair-in-place plans repeatedly; wrote briefs when asked for a plan.

## Tools

- Linear tools used: `list_issues`, `get_issue`, `list_comments`, `list_documents`, `get_document`, `save_issue`, `save_document`, `list_teams`, `list_issue_statuses`, `list_projects`. Statuses on the JUL team include Triage, Backlog, Ready, Implementation, Remediation, UAT, Complete.
- julia-next is public. Clone at `/home/claude/jn/repo` (shallow, ephemeral); card draft at `/home/claude/jn/card.md`. Checker: `node scripts/check-agent-brief.mjs <file>`.
- GitHub API is blocked without a push-level attach, which Todd declined. WebFetch works on github.com pull pages and blob pages. Commit and tree listings are blocked by robots.

## Suggested skills

- `anthropic-skills:advisor`: before relaying an agent report or advising Todd.
- `anthropic-skills:julia-route-check`: before handing him any prompt, card or plan, and before calling anything done.
- `anthropic-skills:sharpen`: when he asks for a plan or recommendation.
- `anthropic-skills:julia-retrospective`: only if he says "retrospective".
