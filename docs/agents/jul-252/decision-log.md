# JUL-252 decision log

| Time (UTC) | Decision | Why | Evidence |
| --- | --- | --- | --- |
| 2026-10-25T06:15Z | The first build's cause is the pre-dispatch worst-case reservation, not the card's actual spend. | The 113,059-byte Opus request reserved $2.005552 under the UTF-8 estimate, above the whole $2 cap, before the $0.140036 planning spend. | `proof/reservation-2026-10-25/events.jsonl`, `receipts.json`, `numbers.json`, `red.txt`, `green.txt` |
| 2026-10-25T06:55Z | Todd's 25 Oct policy: the cap counts settled actual usage at API prices and stops the card once spent exceeds the cap. Drop the worst-case reservation gate. Raise the cap to $10 per card. | The reservation blocked a real build even though its actual usage was $1.223852 after eight requests; the rerun then stopped before writing its checklist. Todd decided the gate is actual spend. | This task; ledger rows for JUL-252 |
| 2026-10-25T06:55Z | Bugs route through poteto-mode's Bug fix playbook; the diagnosing-bugs skill is retired. | Todd's 25 Oct decision; the playbook already carries reproduce, binary-search, fix and verify. | `.agents/skills/poteto-mode/playbooks/bug-fix.md` |
| 2026-10-25T06:55Z | A request that pushes actual spend over the cap completes and settles; the card stops before the next request. | Todd: "stops the card once spent exceeds the cap". The over-cap request's real usage is recorded; later work is refused. | `ops/build-runner/ledger.mjs` settle path |
