# Handoff, 1 Nov 2026, 21:30 PT (advisor to Todd)

Supersedes `claude/session-handoff-2026-11-01-1954.md` where they differ.

## Done this session (verified)
- Pull request 416 (merge machine) merged by Todd as 140dc74 on main at 20:03 PT. The pull request page still read "open" through the GitHub API; the commit on main is the evidence. Card JUL-310 set to Complete with a comment naming the commit (read back).
- Hardening card JUL-315 rewritten with Todd's decisions and six acceptance criteria (checker passes: `node scripts/check-agent-brief.mjs`). Still in Backlog, not yet given to a builder.

## Todd's decisions on JUL-315 (his words or a clear yes)
- Drop the leaked-key item (key revoked).
- Delete the builder-finished ping; he has nothing to do with it.
- Look into a pre-tool hook against secrets reaching a public comment (scrubbing is the access card JUL-314).
- Delete practice cards/pull requests/branches and old stray files; make it permanent.
- Six remediation loop tests: put them on GitHub's checks; if that fails, find another way to verify the same on GitHub. No skips.
- Cost: fix it; runner should record cost as it works.
- Shipping runs only the tests that prove the card's criteria, not the whole repository.
- "Check that a criterion tests the change, not a live service": NO, dropped ("imaginary problems").
- Recordings folder: say what must happen (clear finished records), not a 15 GB number.

## Findings (verified from the repo)
- The six tests skip because they load Mastra from the installed server program (docs/pstack-deviations.md row 10, Todd-approved 31 Oct). So GitHub's checks must install that same release; a second copy in the repo would drift.
- The recordings "fold" (scripts/trace-store.mjs) runs only when a new builder session launches; it copies cost rows to an archive then deletes the recording; it runs out of memory on the current folder (19.2 GB, 7.9 GB free).
- Unverified: whether the runner's GitHub access may edit GitHub's check settings (needed for the six tests); who starts the merge machine (machine/merge/run.mjs) for a real card.

## Next
1. Give JUL-315 to a builder (Todd said yes). Prompt is in the reply; one paste by Todd.
2. Then the first real card (JUL-290 Start-screen account status) with the preview question: second dashboard copy on its own address, or merge then try on the live dashboard. Unanswered.
3. Dashboard health page failure (Linear 401, one run record jul-279.json does not parse) predates this work.

## How to work with Todd (reinforced tonight)
- ONE question per message. I broke this twice (eleven items at once; a re-ask of something he had agreed to). Do not ask what he has already agreed.
- When he asks "why", look it up first; do not ask him for a decision to avoid checking.
- Every criterion needs a stated way to see it is true; no vague catch-alls, no invented numbers.

## Coach log (route-check "Missed")
- Suggested moving to the first real card before the hardening card was built (order in my own notes said hardening first).
- First draft of the card's proof had four statements Todd could not judge (a catch-all, a vague cleanup, an invented 15 GB figure, an unmeasurable review rule). The "done means are outcomes Todd could check" rule would have caught all four.
- Walked him through eleven items in one message right after he asked for one at a time.
