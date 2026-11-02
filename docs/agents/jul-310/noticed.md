# JUL-310: noticed, not built

Things found while building the merge machine. None of them is in this change.

1. **The card's prerequisite is not delivered.** JUL-310 says accurate whole-session cost is
   built with the metrics first. It is not: cache reads have no price in any list, and a
   subagent's usage is not recorded before tracing. The scorecard therefore prints cost as a
   floor. Todd approved the card on 1 Nov 2026, so this build does the four criteria only.
   The prerequisite belongs on the hardening card that follows.
2. **`scripts/scorecard.mjs` had to change to ship this card.** A finished 15 GB trace file
   could not be copied on an 11 GB-free disk, so the scorecard said `Cost incomplete` and
   `check-branch-pr` refused the PR. `readTracing` now opens a finished file read-only where
   it lies and copies only a file a live session still holds. Behaviour is the same for every
   file it could read before; it removes the copy, not the cost. Recorded in the decisions
   log, and the fold's own out-of-memory failure is still open (see 3).
3. **The trace store is over its 15 GB alarm and the fold cannot shrink it.**
   `node scripts/trace-store.mjs status` reports 16.2 GB with 11.1 GB free, and
   `node scripts/trace-store.mjs fold` fails with `Out of Memory Error: failed to offload data
   block ... max_temp_directory_size`. That is the trace store's own limit, not a card's
   business, and it wants its own card.
4. **Other cards' leftovers stay on disk.** `.artifacts/preview` (1.6 GB, JUL-308) and
   `.artifacts/remediation` (JUL-308's practice runs) are not this card's to remove, so the
   sweep leaves them. `verifications/jul-276` (9.5 GB) is the same.
5. **No issued practice card existed, so the practice run creates one.** The sweep and the
   machine both key on a card id; the plan for this card says practice cards and pull
   requests are listed in the pull request that ships the machine.

6. A canceled card's branch was blocking every pull request. JUL-308 was canceled
   and its pull request (#415) closed on 2 November, which left
   `feat/jul-308-preview-smoke-test` pushed with no open pull request, so
   `check-branch-pr` failed `repository-hygiene` for every branch in the
   repository, and the practice run could not land. The 20 commits are kept on
   the tag `canceled-jul-308-preview-smoke` (8246851) and the branch is deleted.
   Nothing of JUL-308's work was changed or thrown away; restoring the branch is
   `git push origin canceled-jul-308-preview-smoke:refs/heads/feat/jul-308-preview-smoke-test`.
7. `gh` colourises its JSON when the terminal forces colour, so the machine's
   first practice merge read `Unexpected token '\u001b'`. `land.mjs` now runs
   `gh` with `NO_COLOR`/`FORCE_COLOR=0`/`CLICOLOR` off and strips the escapes
   before parsing. A `GH_FORCE_TTY` style fix belongs upstream, not here.

## 8. Main refuses a direct push, so the record travels as a pull request

`gh pr merge 417` succeeded and then main's CI ran; the first attempt to record
the landing facts pushed `HEAD:main` and the forge refused it with `GH013:
Repository rule violations found for refs/heads/main ... Required status check
"checks" is expected`. Main is protected by a ruleset, so no process can put a
commit on it without a pull request and a green `checks` run. The machine now
opens its own pull request for the record and the retro, waits for that pull
request's checks, merges it on the commit it opened, and deletes the branch.
