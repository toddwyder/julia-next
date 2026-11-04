# Handoff, 3 Nov 2026, 08:11 PT (advisor to Todd)

Read first: `claude/machine-one-workflow-spec-2026-11-02.md` (the spec, filed as the parent card), `claude/machine-list-2026-11-03.md` (the priority list and the investigation's root causes), `claude/session-handoff-2026-11-02-2159.md` (earlier state and habits). This file does not repeat them.

## Where Todd is
Frustrated and said why, in order: constant patching with no cleanup; Claude acting as a dispatcher who answers the server agent's menus and makes Todd the messenger; recommending approval of work Claude had not verified; "who decided this" when Claude labelled its own proposal as settled. He asked to stop the cycle and do a root-cause investigation (done), then said the priorities are: **get the machine working, get visibility into what it is doing, fix the metrics, so cards process reliably.** His last message: "stop. create a handoff."

Rules Todd enforced this session (do not repeat these mistakes):
- No tables. He said so at 06:51. Use prose and short lists.
- No ticket or pull request numbers in replies to him. He does not know them. Say what the thing is ("the page that shows the machine's runs"). Numbers are fine inside prompts for agents.
- Never call something decided unless he said it. Separate his stated goal from Claude's proposals. Twice he corrected this (notifications; unblocking the dashboard).
- Never recommend approving or merging on a verdict or an agent's summary. Read the primary evidence first, or say it is unproven.
- One step at a time. He said "hold that thought" once; hold means do not write or apply it.
- Do not jump to a prompt or patch before the data is in. He said so twice (07:12, 08:08).
- Prompts to the server agent are one complete block ending `END OF CARD`.

## State (verified by Claude unless marked)
- Parent card JUL-329 (the spec) is in Evidence review. Its first slice JUL-330 is in Evidence review. JUL-331 and JUL-332 are in Ready and have not started. Linear workspace had hit its free issue limit; the server agent archived 85 finished cards and creation works again (agent report).
- Main is at 4f02d41. Landed tonight: the ping reminder fix (a99bc05, PR 434) and the reviewer step limit of 1000 plus a timer stop on teardown (4f02d41, PR 435). The pstack upgrade landed as 1c776ec and its card is Complete.
- PR 433 holds the first slice. Head fcb187d, open, not merged. The builder added the card to every step record and a test that fetches the runs page over HTTP from a real dashboard server. Claude fetched the PR and read that test: it matches the agent's description. Claude has not seen CI results or the review records.
- PR 436 (parser fix so "Done means:" is read as criteria) is open and not landed. Todd called the pattern "patch after patch". Held.
- Everything except the builder's work on 433 is paused at Todd's instruction (07:17).
- The dashboard has not deployed since 31 Oct because the updater rejects a run record the machine itself wrote with status "stopped" (agent report). **Todd has not decided whether to unblock it.** Unblocking deploys about five days of accumulated dashboard changes at once, unchecked. Alternative: show him the new page by screenshot.

## What the evidence for the first slice shows (agent report, Claude has not read the records)
- Proven on the real thing: the runs page lists runs; the detail page shows the three stages with times; a second run appeared in about 8 seconds; every step record carries the card. All with stand-in stages that exit at once.
- Not shown: the "stalled" status over HTTP (unit tests only); any real build, review or merge through the new workflow; the stall watcher is not installed and points at a missing file; nothing starts a Ready card.
- **Concerns Claude raised and Todd has not resolved:** (1) the PASS came from a paid model after the same model first FAILED all five done-means because the review prompt demands a command and the slice done-means are prose; the agent added a command to each and re-ran, so the judged text is the agent's rewrite, not the card as written; Claude has not seen either; (2) the new HTTP test skips itself if the dashboard's own install is missing, and a skip counts as green; nobody has shown it ran in CI; (3) the free review model hit its daily limit (resets 16:00 PT, 3 Nov), so the review ran on a paid model.

## Open items, in the order Claude would take them
1. **Decide how Todd gets the evidence for the first slice.** Two routes were offered and Todd answered neither: (a) the agent writes one file with the primary records copied exactly (all review determinations, the card's done-means as Linear holds them beside what the reviewer was given, the CI output for the test, the review prompt) at `/tmp/evidence-433.txt` on the server; Todd attaches it and Claude reads it; (b) the agent sends Todd screenshots of the runs page and one run page for Todd's acceptance, with Claude checking the records separately. Claude recommended (b) with (a) behind it. Ask which; do not send both.
2. Only after the records are read: recommend or decline the merge of 433. A merge does not make the page openable (see the dashboard item above).
3. Dashboard deploy: Todd's decision, not the agent's, not Claude's.
4. Notifications: Todd's stated goal is native Windows and Android notifications, "the same way you work", in place of Linear. That is all he stated. Claude proposed (undecided): Linear becomes a silent record; only a product call, an acceptance check or an account-owner approval notifies him; stops and completions go to the run page and one morning summary; two free mechanisms to check on his devices (a push service such as ntfy, or notifications from the dashboard page). Spec criteria for this were drafted and **not applied** (Todd said "hold that thought"). His inbox had 41 unread items, none needing his action.
5. Two gaps not yet in the spec: the machine owning its queue (nothing starts a Ready card), and the review accepting stand-ins as proof. A third was found late: a long review failed at 07:01 with a model error asking for the reasoning of every earlier message; the investigation did not list it and it is unexplained. Details are in the list doc.
6. The server agent is working from a task list that includes steps Todd paused (parser PR, starting JUL-331 and JUL-332, the dashboard record edit). Claude told Todd to paste the pause prompt; Todd said he sent the builder prompt but never confirmed the pause was sent. Ask the server agent what it is currently doing before assuming anything is paused.

## Unverified
Everything about the server (processes, logs, unit state, the dashboard worktree, the stop log counts). The 41-unread-notification breakdown is the exception: Claude read it directly from Linear. CI results on fcb187d. Whether the rewritten done-means match the card. Whether the higher step limit makes reviews hit the new model error more often. Whether the free model's quota will last through the next slices.

## Files and places
Cloud container only (disposable): clone `/home/claude/julia-next` at main 4f02d41 with PR 433 fetched as branch `pr433`. The container cannot reach the server or the GitHub API; `git ls-remote` and `git fetch` of public refs work. Linear tools work (create, update, list, notifications). Project docs written this session: the spec, the list, and this handoff.

## Suggested skills
- `anthropic-skills:advisor` before every reply to Todd and before relaying any agent report.
- `anthropic-skills:julia-route-check` before any prompt, card or recommendation, and before calling a card done (the parent card is far from done: the agent counted 18 met, 4 partly, 3 not met against the 25 criteria at the earlier head).
- `anthropic-skills:sharpen` when he asks for a plan.
- `anthropic-skills:tighten` before editing the spec or any card (`node scripts/check-agent-brief.mjs <file>` in the clone).
- `anthropic-skills:julia-retrospective` only if he says "retrospective".
