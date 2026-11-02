# The merge machine

One program. It takes a pull request and the card it belongs to, merges the
change when Shipping's published verdict covers the commit that is on the
branch, waits for main CI on the merge commit, records how long the card took
and how many review rounds it ran beside the card's scorecard, runs the retro
(and a reflection when the card failed), and sweeps what the card left behind.

```sh
node scripts/julia-agents.mjs -- node machine/merge/run.mjs --pr 420 --card JUL-310
```

`--no-post` does everything except write to Linear: the merge still happens, and
the completion comment is kept at `.artifacts/merge/pr-<n>/card-note.md` instead
of being posted. `--card-file <path>` reads the card from a JSON file instead of
Linear. `--model` overrides the retro's model (default is the free Beam model).
`--force` ignores a saved record; without it a run that already finished stops
before touching the forge again.

## What happens, in order

1. `run.mjs` reads the card, the pull request, and the pull request's comments,
   and points `MASTRA_OBSERVABILITY_DB_PATH` at a new trace file per run and
   `MASTRA_DB_PATH` at a state database inside the run folder.
2. `workflow.mjs` builds the stock Mastra workflow `merge` with eight steps.
   `gather` decides the gate, `checks` waits for the pull request's own checks,
   `land` merges, `ci` waits for main, `metrics` writes the landing facts,
   `retro` writes the retro, `sweep` removes the leftovers, `complete` moves the
   card.
3. Every step saves the run record before it hands on. A crash leaves the
   finished steps in `record.json`, and a rerun continues from there instead of
   merging twice.

## The pull request's own checks

Branch protection refuses a merge until the pull request's checks are done, and
a refusal reads like a fault. So `checks` reads the rollup first and waits:
`SUCCESS`, `NEUTRAL` and `SKIPPED` are green, a `FAILURE` is named and stops the
run before anything merges, and a check that never finishes stops it after
fifteen minutes. The merge is left to the forge so branch protection stays the
thing that enforces the checks.

## The gate

The machine does not judge the change and does not trust a local artifact. It
reads the pull request's own comments and takes the newest one that starts
`Shipping agent:` for this card and this pull request. It lands only when that
verdict is `PASS` or `PASS+NOTES` **and** the commit it judged is the commit the
branch points at now. A verdict that judged an older commit refuses the merge,
because the branch moved after the review.

`gate.mjs` is that rule, and it is the only place it lives.

Rounds are counted from the same comments: every `Shipping agent:` determination
for this card and pull request is one round, so `FAIL` then `PASS` reads as two.

## Landing

`land.mjs` runs `gh pr merge <n> --squash --delete-branch
--match-head-commit <head>`, so the forge itself refuses when the branch moved
after the verdict. It then reads the pull request back until the state is
`MERGED` with a merge commit, and checks the base was `main`.

`ci` polls `gh run list --commit <sha>` filtered to `main` for about ten
minutes. Green means every run on that commit finished `success`, `skipped` or
`neutral`. Red ends the run: the reason goes on the card, the stop is recorded,
and the card stays in progress for remediation. The machine does not merge
behind a red main.

## The metrics

`docs/scorecards/<CARD>.md` is generated from Mastra's records by
`scripts/scorecard.mjs` and would overwrite anything appended to it, so the
landing facts go beside it in `docs/scorecards/<CARD>.landing.json`: how long
the card took (first commit on the branch, or the pull request's creation time
when the branch has one commit, up to the merge), and the review rounds with
their verdicts in order. The same numbers are in the merge comment on the card,
which is the copy a person reads.

## The retro

`retro.mjs` starts a fresh `execute` subagent in the `main` worktree at the
merge commit and gives it the repo's own correction skill
(`.agents/skills/correct/SKILL.md`) plus every Shipping determination for the
card. It must write `docs/retros/<card>.md` and end with `RETRO: written
<path>`; anything else is a failed retro, not a passed one.

When the card failed at least one review, the retro must also carry a section
headed `## Reflection: why the card failed`. That heading is checked, not
trusted.

The retro and the landing facts are committed straight to `main`, because a pull
request for the documentation would need its own merge and its own retro. A
push that is refused is fetched, rebased once, and retried.

## The sweep

`sweep.mjs` removes only what this card left behind: the branch the merge
deleted locally or on the remote, the `.artifacts/*/pr-<n>` run folders and
worktrees belonging to this pull request, and changed test files whose imports
point at modules that are not on main. It never touches `main`, never touches a
branch whose commits main does not hold, refuses anything under
`docs/scorecards/` so the cost rows stay, and never removes its own run folder.
Anything it recognised as the card's but would not remove goes on the noticed
list in the run record.

## The completion

`complete` writes one comment on the card naming the merge commit, the Shipping
verdict and the metrics, then moves the card to `Complete` and reads the issue
back to confirm the state. A comment already carrying that commit is not
written twice.

The Mastra modules are loaded from the installed Mastra Code program
(`MASTRACODE_PROGRAM_DIR`, default `~/.local/lib/mastracode-program`) for the
same reason the Shipping machine does. The departures from stock pstack and
stock Mastra Code are rows in `docs/pstack-deviations.md`.
