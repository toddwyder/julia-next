# JUL-263 live view

Card: [JUL-263](https://linear.app/julia-next/issue/JUL-263/live-view-the-running-builds-pstack-checklist-on-the-dashboard).

## What the dashboard does

The build runner reads the checklist the build writes at
`<worktree>/.builder-home/pstack/checklist.md` and returns it on every job record.
After the run it falls back to the retained `pstack-checklist.md` beside the job.
The control page renders the steps in its Build checklist section and polls every
two seconds, so a step shows finished as the build ticks it.

A build whose orchestrator and coder are both the configured machinery model is
recorded as a practice run. Practice runs use Beam.

## Attempt 1 found the real format

The first Beam practice build (JUL-264, run `jul-264-1b51b4084d0b8a82f7af3c722d5f7896`)
finished `ready-for-review` on candidate `c804215da3db6d739ab3981a74238d7d4eac8c7e`
with $0 spent. It wrote its checklist as numbered steps with `done:` markers:

```
5. Verify on the matching surface. — done: od shows 26 bytes single newline...
```

The first parser accepted only `- [x]` checkboxes, so the dashboard showed no
checklist even though one existed. The first run's screenshots, job and browser
record are under [proof/attempt-1](proof/attempt-1).

Fix, test first: `reads the numbered checklist the build actually writes` failed
against the old parser and passes after it learned numbered steps and the same
`done:` marker the build runner already requires. Headings and plain bullets stay
out, so a throughput-checkpoint bullet is not counted as a step.

## Proof

`proof-drive.mjs` drives `https://ovh.tail91f394.ts.net/julia-control`, selects
the practice card and Beam for both roles, clicks Start, and captures screenshots
when the checklist first appears, when a tick moves, and when the build ends.
Output goes to `proof/final/` by default; `PROOF_OUT` changes it.
