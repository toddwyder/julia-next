# Final proof — JUL-263 live view

A Beam practice build through the Tailscale Start page, with the pstack checklist
on the dashboard ticking while it ran.

| | |
|---|---|
| Card | JUL-266 |
| Run | `jul-266-a3207dc745f39cb952b983776715a2ef` |
| Start page | `https://ovh.tail91f394.ts.net/julia-control` |
| Roles | Beam (`reflection/beam:free`) for orchestrator and coder |
| Result | `ready-for-review` |
| Candidate | `12a9643530cc8ca91d8bf97bf8b44d08f5f3860e` |
| Base | `6cfe443eec779e0a7eb60fc15a43b0714d7887e8` |
| Change | `JUL-263-START-PRACTICE-3.txt` only, 32 bytes: `Julia live view practice three.\n` |
| Spend | $0. 69 settled Beam requests at the published $0 price; ledger spent and held are both zero. |

## Screenshots

- [start.png](start.png): `JUL-266 · running`, 2 of 8 steps finished.
- [middle.png](middle.png): `JUL-266 · running`, 3 of 8 steps finished. The third
  tick arrived while the build was still running.
- [end.png](end.png): `JUL-266 · ready-for-review`, 3 of 8 steps finished. Steps
  4, 5 and 6 are finished; steps 1–3 and 7–8 were skipped and stay unticked.

[start-selected.png](start-selected.png) shows Beam chosen for both roles before
Start. [running.png](running.png) is the first frame after the job appeared.
`screenshots.json` records the exact checklist items and counts at each shot.
`checklist.jsonl` is the two-second tick timeline. `final-job.json` is the saved
job and ledger.

## What was fixed to get here

Attempts 1–6 are recorded beside this directory. The live view fixes were the
checklist parser (numbered steps and `done:` markers), the tool-free plan turn,
and keeping a real build contained and out of publishing. The final run is the
one where Beam used a subagent for both the coding and the machinery self-check.
