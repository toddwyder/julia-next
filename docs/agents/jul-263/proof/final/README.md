# Final proof — skipped checklist steps

A Beam practice build through the Tailscale Start page, with the dashboard showing
skipped steps as their own state.

| | |
|---|---|
| Card | JUL-267 |
| Run | `jul-267-ecc8a6659f46657442c219729c2ea95e` |
| Start page | `https://ovh.tail91f394.ts.net/julia-control` |
| Roles | Beam (`reflection/beam:free`) for orchestrator and coder |
| Result | `ready-for-review` |
| Candidate | `63d2dbfa3dc4a436c7e369fd85e4ae0fd9e2ec02` |
| Base | `e23d702aac4613ec55b67ef13eb019c63e2800ee` (the skipped-state build) |
| Change | `JUL-263-START-PRACTICE-4.txt` only, 31 bytes: `Julia live view practice four.\n` |
| Spend | $0. 135 settled Beam requests at the published $0 price; ledger spent and held are both zero. |

## Screenshots

- [start.png](start.png) and [start-card.png](start-card.png):
  `JUL-267 · running`, **0 finished, 5 skipped, 3 pending**. Five steps carry
  the skipped marker and badge; three wait with the open marker.
- [middle.png](middle.png) and [middle-card.png](middle-card.png):
  `JUL-267 · running`, **2 finished, 6 skipped**. Two steps have ticked.
- [end.png](end.png) and [end-card.png](end-card.png):
  `JUL-267 · ready-for-review`, **3 finished, 5 skipped**. The page itself shows
  the finished build, its candidate `63d2dbf`, the three ticked steps, the five
  skipped steps, and the saved result.

`screenshots.json` records the page heading and the counts at each shot.
`checklist.jsonl` is the two-second timeline, including the jump to
`ready-for-review`. `final-job.json` is the saved job and ledger.

## How the end shot was taken

The driver waited for the run's own card heading to read `ready-for-review`
before capturing. Two runs of JUL-267 both read `ready-for-review`, so the wait
filters by this run's ID rather than the page-wide heading. The start and middle
shots come from the same run; the end shot is the same run after the page showed
its finished state.
