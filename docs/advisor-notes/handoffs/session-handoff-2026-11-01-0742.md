# Handoff, 1 Nov 2026, ~07:42 PT (advisor to Todd)

Supersedes `claude/session-handoff-2026-10-31-2310.md` where they differ. Everything not mentioned here still stands.

## Goal and where we are

Todd's five steps, in order: remediation, preview and smoke test, UAT, merge, cleanup. A routine "land the slice" step (ordinary merge of the remediation pull request) sits between remediation and the next step. Todd's stated overall goal this session: remediation working properly.

- **Remediation: done** (Todd's word, 07:40). A FAIL goes back to the builder, which fixes it, and a fresh Shipping agent reviews again; a second FAIL runs poteto's Investigation playbook and pings Todd. Card: https://linear.app/julia-next/issue/JUL-307/remediation-a-fail-goes-back-to-the-builder-and-is-reviewed-again . Pull request: https://github.com/toddwyder/julia-next/pull/409
- **Proof, checked by me on GitHub and Linear:** fail, fix, PASS at https://github.com/toddwyder/julia-next/pull/406 ; two FAILs plus a fresh builder when the session was missing at https://github.com/toddwyder/julia-next/pull/408 ; the stop ping reached Todd's Linear inbox at 07:05 (comment by "Julia controller" on https://linear.app/julia-next/issue/JUL-313/practice-jul-307-remediation-loop-a-failure-that-comes-back ).
- **In progress:** the builder is running a root-cause investigation (Investigation playbook) on why free-model reviews die with "Missing required parameter: messages[N].reasoning_content" (4 of its 10 attempts that reached a model). The "about 35 turns" threshold is the builder's inference, unverified. This is a Shipping reviewer problem, separate from remediation. When it answers, verify its evidence before relaying. Todd has agreed the root-cause question belongs before the first real card.
- **Next, once the builder is free:** land the slice. Pull request 409's checks failed at about 15:12 UTC after commit 14624ef (Linear's feed says so; I could not read which check). Draft block, Todd has seen it and not yet sent it:

```
Read .agents/skills/poteto-mode/SKILL.md and follow it as a new task.

Todd does not mint, paste or handle any key, and never runs a command. His UAT yes on remediation is given.
1. The checks on https://github.com/toddwyder/julia-next/pull/409 failed at about 15:12 UTC, after commit 14624ef. Read the failing check, fix the cause, and push. Change nothing else.
2. When every check passes, merge the pull request the way the last slice was merged. Then add the merge commit to a comment on the remediation card and confirm main's checks pass on the merge commit.
3. Reply with the failing check's name, what you changed, and the merge commit.
```

## Linear access (settled this session, do not redo)

The machine no longer holds a Linear key. The existing Linear app "Julia controller" has client credentials switched on (I did that with Todd's yes, in his signed-in Chrome). Todd pasted the client secret once into the "Julia Linear" item in the Julia Agents 1Password vault, field `client_secret`. `scripts/linear-token.mjs` (on the pull request) trades the app's client pair for a token each run. The 1Password service account on the server is read-only, which is why Todd pasted by hand. I cannot type or paste secrets into any field, even with approval.

## Cards created this session

- JUL-307 remediation (Backlog; work is done, Todd's UAT ping check passed).
- JUL-308 preview and smoke test, JUL-309 merge (runner merges after Todd's yes), JUL-310 cleanup, JUL-311 first real card: all Backlog stubs, each with "Before this card starts" items. Acceptance criteria are written at triage.
- JUL-314 Machine access: every credential designed once so Todd never handles one (includes checking 1Password OIDC for the root token, and scrubbing secrets from published comments).
- JUL-299 "Shipping you can trust": rewritten to what slices 1 and 2 delivered and closed Complete; its "Not delivered" section points at the cards above.
- JUL-310 now lists the loose ends found during remediation (key possibly still visible on the second practice pull request, https://github.com/toddwyder/julia-next/pull/407 ; the generic builder-finished ping ends with a terminal command; no check that a criterion tests the change and not a live service; practice cards and pull requests to delete).

## Unverified, check before relying

- The builder says it posted test output (46 of 46), a runtime record and a review clock write-up on pull request 409; I could not see them on the page.
- Whether the revoked key is still visible on the pull request 407 comment. The key is dead; the comment is public.
- Why 409's check failed.

## Decisions Todd made this session (his words or a clear yes)

- Solve secrets permanently, not by parking them on a card. He chose client credentials with one paste (option A).
- Remediation includes poteto's root-cause investigation on a second FAIL.
- Remediation and "Shipping you can trust" are peers; the closed card only points to the cards that hold what was not delivered.
- Later to-dos attach to cards that will certainly be built, not to a list nobody reads.
- The model-failure root cause is a separate question; remediation is done without it.

## How to work with Todd

His ten working rules are in the project memory (preferences.md); the full old list is in the project doc `claude/preferences-archive-2026-11-01.md`. The ones broken today: hold the goal he states, discuss before sending anything to an agent, ask one question at a time, never send him evidence to read instead of the result in plain English, never route secrets or commands to him. Load the advisor skill by name before replying (typing /advisor is intercepted as unavailable).

## Tools

- Linear MCP works and can read Todd's inbox (`get_notifications`). Chrome extension is connected now; the built-in browser pane ignored menu clicks, so prefer Chrome.
- GitHub: WebFetch reads pull pages (summaries can miss comments); the API is blocked; `git fetch origin pull/<n>/head` works. The repo clone at `/home/claude/jn/repo` is ephemeral.
- The Mastra program is not installed in my sandbox (npm install crashed), so I cannot run the machine tests myself.
- A task list for the five steps exists in the session; recreate it if the session is new.

## Coach log (route-check "Missed")

- My first remediation prompt didn't say that determinations are public and copy command output, which led to a key printed on a public comment.
- The remediation ping tells Todd to run a terminal command; nothing in code blocks that.
- No check yet that a card's criterion tests the change and not a live service.

## Suggested skills

- `anthropic-skills:advisor`: load first, before replying.
- `anthropic-skills:julia-route-check`: before handing Todd any prompt, card or plan, and before relaying a builder report.
- `anthropic-skills:tighten`: before any card or builder prompt.
- `anthropic-skills:sharpen`: when he asks for a plan or recommendation.
- `anthropic-skills:chrome-browser`: for Linear or GitHub pages that need his signed-in browser.
