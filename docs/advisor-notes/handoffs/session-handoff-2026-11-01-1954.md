# Handoff, 1 Nov 2026, 19:54 PT (advisor to Todd)

Supersedes `claude/session-handoff-2026-11-01-0742.md` where they differ. Everything not mentioned here still stands.

## Goal and where we are

Todd's steps: remediation, preview and smoke test, UAT, merge, cleanup. Where each ended up this session:

- **Remediation:** done and merged (https://linear.app/julia-next/issue/JUL-307). Free reviewer model (Beam) occasionally loses a round because our side drops its "thinking" text on one earlier message; the runner already retries; no wrong verdict has come from it. Todd's call: keep Beam, change nothing.
- **Preview and smoke test (JUL-308): dropped.** Todd: machine cards need no preview and no UAT; they go review, then merge. Card canceled with a comment. The builder's pull request https://github.com/toddwyder/julia-next/pull/415 was closed unmerged; Linear's GitHub link closed it automatically one second after the card was canceled (unexpected side effect, verified from GitHub's API).
- **Merge and cleanup (JUL-310):** merge card (JUL-309) folded in and canceled. Criteria approved by Todd and saved: https://linear.app/julia-next/issue/JUL-310/merge-and-cleanup-the-machine-merges-records-the-metrics-runs-the . The builder was given a no-stop instruction and is building it. Its pull request, https://github.com/toddwyder/julia-next/pull/416, was open at 19:52 PT (updated 03:52Z). Shipping verdict, CI state and the builder's own report on it were not seen by me.
- **Hardening card (JUL-315)** created, ordered after JUL-310, holding the loose ends (leaked revoked key on a public comment, practice cards and pull requests to delete, the ping that ends with a terminal command, no check that a criterion tests the change not a live service, the six remediation loop tests that skip on GitHub): https://linear.app/julia-next/issue/JUL-315/hardening-the-loose-ends-found-while-building-the-machine-are-fixed

Observed on main (git log, 19:10 PT): the new merge machine already appears to have landed practice work and written "Record how the card went" records (commits 237e63c, e1e8038, 90e27da, i.e. pull requests 420, 419, 417). I read pull request 420's description only. Treat as unverified evidence that the merge machine runs.

## Decisions Todd made this session (his words or a clear yes)

- Machine proofs only. A machine card has no preview and no UAT; review then merge. The machine merges, not the builder. "We know it will merge," so no yes from him on machine cards. I recorded my earlier worry once (a bad machine change could weaken later checks); his call stands.
- No guard "changed code goes back through review" for machine cards ("you are building protections for imagined things"). It stays in the plan for cards with a UAT wait.
- "I don't care about green lights": criteria are evidence you can see, not "checks green."
- Cleanup = hygiene sweep: stray files, unused tests, stray branches, code that does nothing or was written for a failed attempt, cost rows kept. It is not my list of loose ends. Acting on retro findings is outside the machine (people decide).
- Loose ends go on the hardening card, which comes after cleanup.
- The retro: the machine runs it and reflects when a card failed. Nothing more.
- Skipped tests: "no test may skip silently where it should run" (his decision, now on the hardening card).
- Tester Army (AI-driven browser test tool): looked at, parked; "not a criteria."
- Keep Beam; change nothing about the lost-round problem.

## Verified vs unverified

Verified by me this session: remediation merge commit on main; card JUL-307 Complete; CI run green on the preview pull request's last commit (before it was dropped); closing of pull request 415 and its timestamp (GitHub API); JUL-308 and JUL-309 canceled, JUL-310 and JUL-315 saved (Linear read-backs); the runner is a GitHub App with pull request and contents write (docs/agents/server-runbook.md).

Not verified: anything about pull request 416 beyond "open"; whether the runner can merge into the protected main; whether the scorecard records time and rounds (I found it records cost, tokens, stops, success only).

## Parked, not decided

- **The first real card** is the Start screen's account-status slice (JUL-290, "Slice 4b", sitting in UAT in Linear). It is a dashboard change, so Todd needs a way to try it before merge. Options I gave: a second dashboard copy on its own address (the plan's design; the dropped pull request 415 had a version of it) or merge then try it on the live dashboard. Not answered; Todd said we are not done with the machine, so I stopped discussing it. JUL-311 (first real card) still lists preview and UAT in its outcome, which is right for dashboard and Julia cards.
- Dashboard health page fails (Linear 401, one run record, jul-279.json, does not parse). Predates this work.
- Leftover branches on GitHub from the preview work (`feat/jul-308-preview-smoke-test`, `practice/preview-*`) belong to the cleanup sweep / hardening card.

## Environment facts

- ssh to the server timed out at 15:07 PT, worked again at 15:22 PT; cause unknown (a temporary block is my guess). The server's Tailscale showed connected, and the dashboard answered on its Tailscale address throughout.
- OVH sign-in costs Todd one one-time backup code each time because his authenticator fails. Avoid any OVH login. Fixing that is parked (likely phone clock drift).
- The Claude in Chrome extension never connected this session (empty list of browsers). The Claude app's built-in browser works on his Tailscale network but needs request_access per page load.
- GitHub: the gh command is blocked in my sandbox (needs add_repo); api.github.com via WebFetch works and is authoritative; github.com page fetches were sometimes stale (they said open when the API said closed). `git fetch` over https works; the clone at /home/claude/jn/repo is ephemeral.
- Linear MCP works. `node scripts/check-agent-brief.mjs <file> --root <repo>` checks a card's text (no implementation words, negations, model names, or text copied from repo docs).

## How to work with Todd (his words today)

- Trace every card line to his words before showing it; anything not his or not a repo rule is labelled mine for him to cut. This session I wrote cards from the plan and my own safety ideas and he had to correct me repeatedly.
- One question at a time, plain English, no jargon (he did not know what a retro was in my wording). Answer the size he asked.
- Do the checking myself; don't hand him evidence or commands.
- He wants to stay in discussion before anything is sent to the builder; "I think" statements are soft, confirm.
- Never route a secret or a command to him; he cannot be asked to run anything.

## Coach log (route-check "Missed")

- My first preview instruction said "practice card" without saying real card and posting on, so three criteria had no real proof.
- The preview card carried a dashboard copy and a live-records rule I invented from the plan; he never asked for them.
- I understated the Shipping review ("nothing would catch it"); he corrected me.
- I did not predict that cancelling a card closes its linked pull request.

## Next steps

1. Verify pull request 416 yourself: state, CI, Shipping determination, the builder's report and its evidence links. Do not relay the builder's word.
2. The builder's one allowed stop is "ready to merge" for its own pull request; confirm with Todd how that one merges (the new merge step cannot merge itself).
3. After JUL-310: the hardening card (JUL-315), then the first real card with the dashboard-preview question above.

## Suggested skills

- `anthropic-skills:advisor`: load before replying to Todd.
- `anthropic-skills:julia-route-check`: before handing him any prompt, card or plan, and before relaying a builder report.
- `anthropic-skills:tighten`: before any card or builder instruction.
- `anthropic-skills:sharpen`: when he asks for a plan or recommendation.
- `anthropic-skills:chrome-browser` / `anthropic-skills:built-in-browser`: only if a page needs his signed-in session.
