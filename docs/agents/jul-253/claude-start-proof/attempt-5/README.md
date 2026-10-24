# JUL-262 completed Start proof

The real Tailscale control page at `https://ovh.tail91f394.ts.net/julia-control` admitted JUL-262 and Start ran run `jul-262-7ea95066c8d59015b0515a1edec14860` at source `834be6e35252bcbd059364c42842b4c350365e44`. Playwright selected Claude for orchestration and CommandCode DeepSeek for coding. No route or model response was mocked.

## Result

The build finished `ready-for-review` with candidate `bdcccd2afafd123614255fb051b843cb164e1904`. Its only change is `JUL-253-START-PRACTICE-4.txt`, 39 bytes, sha256 `f357c278e8ff34954f1ec09fdddffddb987bc1f6373af1b78fdd5f0dab23549b`. The worktree was clean before the host added evidence. The marker is not published.

| Role | Model that ran it |
| --- | --- |
| Orchestrator, main session, hardest tasks, judgment, synthesis, reviews | `anthropic/claude-haiku-5-5` (Claude subscription) |
| Coder, feature work, swarm workers, research, second reviewer | `commandcode/deepseek/deepseek-v4.1-flash` |
| Machinery self-check | `commandcode/reflection/beam:free` |

| Model | Settled requests | API-equivalent debit |
| --- | ---: | ---: |
| `anthropic/claude-haiku-5-5` | 115 | $0.268412030 |
| `commandcode/deepseek/deepseek-v4.1-flash` | 100 | $0.113416140 |
| Total | 215 | $0.381828170 |

The card ledger holds zero and retains $1.618171830 of its unchanged $2 ceiling. These are API-price debits, including the subscription, not an invoice assertion.

## Conversions this run needed

1. The plan-only runner constructed an empty `Workspace`, which the installed SDK refuses. It now gets a filesystem contained in `.builder-home` that can write only `pstack/plan.md`, covered by a real Beam test.
2. Claude returned `## Files` and `## Steps`; the check accepted only bare headings. Markdown headings are now accepted.
3. Claude's valid plans measured 1364, 1416 and 1556 bytes, so the 1500-byte bound refused one. The bound is 4000 bytes and a rejected plan is retained for diagnosis.
4. The plan runner cleared `process.env` and never restored it, so the second runner in the same worker lost `COMMANDCODE_API_KEY`. The inherited environment is now restored on close and on the error path.
5. The builder treated the host's Start, browser, server, Tailscale and ledger steps as its own, declared them unreachable from its sandbox, and made only a rehearsal file. The practice card's criteria are now repository-scoped and name those steps as host-owned.

## Evidence

- [Start response](start-response.json), [browser network and console](start-browser.json), [selected page](start-selected.png), [running page](start-running.png), [finished page](start-final.png), [driver](start-drive.mjs).
- [Job summary](job-summary.json), [ledger rows](ledger-summary.tsv), [marker readback](marker-readback.txt).
- [Retained plan](pstack-plan.md), [checklist](pstack-checklist.md), [decision log](pstack-decisions.tsv).

Earlier JUL-262 attempts are retained here: the first attempt (this proof directory) failed the plan format, attempt-2 hit the size bound, attempt-3 lost the credential, and attempt-4 made only a rehearsal file.
