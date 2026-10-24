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

## Attempts 2 and 3: the plan-only turn

Attempt 2 (JUL-265, medium both roles) finished with the checklist ticking
2 of 8, then 6 of 6, then 7 of 7. Its middle screenshot landed on the same tick
count as the start, so it is kept for the record rather than used as the proof.

Attempt 3 failed closed before delivering a build. The plan-only turn still
exposed `mastra_workspace_*` tools, and Beam read files during planning, so the
builder boundary refused the turn. Two later runs showed the same attempted
`execute_command` refusal. Raw events are under
[proof/planning-tool-attempts](proof/planning-tool-attempts).

Fix, test first:
- Plan-only mode now disables the workspace tools as well as the dynamic and
  built-in tools.
- The boundary fails on a tool call that actually ran. A call the runtime
  refused before running (`Tool "..." not found.`) executed nothing and no
  longer fails the turn. A subagent start still fails it.
- A malformed plan gets one retry before the run stops.

## Attempt 4: request_access

JUL-266's plan passed, but the build turn then searched for a git remote and
GitHub credentials and called `request_access`. The runtime granted access to
`/home/ubuntu`, the session suspended and then aborted, and the build stopped
before writing its checklist. The failed screenshots and job are under
[proof/attempt-4-request-access](proof/attempt-4-request-access).

Fix, test first:
- A real build no longer has `request_access`; the builder stays inside its
  contained filesystem.
- The host instructions now say the host owns git remotes, branches, publishing,
  pull requests and GitHub credentials, and the build must not search for them.

## Proof

The Beam practice build on JUL-267 passed: `ready-for-review`, candidate
`63d2dbfa3dc4a436c7e369fd85e4ae0fd9e2ec02`, the 31-byte marker as the only
change, and $0 spent. The dashboard showed **0 finished, 5 skipped, 3 pending**
at the start, **2 finished, 6 skipped** in the middle, and **3 finished, 5
skipped** at the end. The end shot is the page showing the finished build itself,
with its candidate and saved result. See [proof/final](proof/final/README.md).

Attempt 7 is the earlier JUL-266 proof before the skipped state. Attempt 8 is a
JUL-267 run where Beam compressed its checklist to four steps, so it proved the
counts but not skipped steps. Attempt 6 is kept as a flake: Beam ran the
machinery self-check with direct commands instead of a subagent, so the
structural check refused it.

`proof-drive.mjs` drives `https://ovh.tail91f394.ts.net/julia-control`, selects
the practice card and Beam for both roles, clicks Start, and captures screenshots
when the checklist first appears, when its tick count moves, and when the build
ends. Output goes to `proof/final/` by default; `PROOF_OUT` changes it.
