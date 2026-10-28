# PR-1 verification checkpoint

## Candidate and scope

The code tested is `9d7257b3fa962ddd49c6a67953e53d131f4e8a7f` in PR [#372](https://github.com/toddwyder/julia-next/pull/372). This follow-up changes proof documents and images only. The base refresh found `origin/main` unchanged at `42f86ae` and the rebase was a no-op.

These are owner self-checks. They do not replace the independent swarm or Todd's UAT. Browser viewports are not phone hardware or tailnet proof.

## Real slow connection

The isolated production server on `127.0.0.1:3102` ran with a Node preload that delayed the real `api.linear.app` DNS lookup by 4,000 ms. It returned no substitute response. The server log records that lookup.

Loading appeared at 379.6 ms with no Start links. The real cards appeared at 4,803.3 ms, matching a separate fresh Linear read of JUL-280, JUL-279, and JUL-276. Loading disappeared and no browser console or page errors occurred.

`slow-loading.png` and `slow-ready.png` show the transition. The video and rerunnable `prove-slow.mjs` are retained in `/home/ubuntu/verifications/jul-276/program/owner-1`. The delay belonged only to that server process. The server was stopped and port 3102 was released afterward.

## Production performance

Verdict. The approved absolute TTFB ceiling passed. This is not a comparative speedup claim.

The clean Next 16.3.5 production server on `127.0.0.1:3101` used the existing optimized build and real Linear credentials through `scripts/julia-agents.mjs`. The uninstrumented probe ran five sets of ten sequential curl requests. The first three sets implement the approved two-of-three acceptance rule. The two extra sets check reproducibility.

Median TTFB by set was 10.863, 9.063, 7.9875, 8.227, and 8.3785 ms. All five sets were below the 1,500 ms ceiling. Across 50 requests, the median was 8.8115 ms and the range was 6.868 to 18.904 ms.

Streaming TTFB measures the shell before the Linear read finishes. It is not time to usable cards. Median full-response times by set were 132.1495, 116.9595, 109.083, 108.337, and 113.2375 ms. Across all requests, the full-response median was 116.9595 ms and the range was 98.482 to 799.577 ms.

The same timed response was checked for HTTP 200, all three real Ready identifiers, card headings, and absence of a rendered failure alert. All 50 responses passed. Fresh Linear reads before and after matched. The previous `perf.mjs` checked a separate untimed response. That weaker evidence remains preserved but is superseded by `perf-validated.mjs` and `perf-validated.json`.

The server had four cores and a load average of 0.32 before the run. Separate profiling requests used pidstat and direct upstream timing. The server averaged 7.88 percent of one CPU during the eight-second observation, had zero measured disk throughput, and no major page faults. Direct Linear reads took 104.6 to 268.2 ms. Full dashboard responses in that separate run took 110.4 to 437.7 ms after the initial request. Combined with the causal delayed-DNS check, this supports network-bound card completion, not CPU or disk saturation. The shell TTFB is mainly local request and render work. No bandwidth or capacity claim follows from a single sequential client.

Raw samples are in `perf-validated.json`. Profiling logs, machine observations, scripts, and the pre-run claim are in the durable owner evidence directory. No profiler ran during reported samples. The clean server was stopped and port 3101 was released after the fresh live browser checks.

## CI discrepancy

Both original runs used exact head `9d7257b3fa962ddd49c6a67953e53d131f4e8a7f`.

The push run [40750694353](https://github.com/toddwyder/julia-next/actions/runs/40750694353) failed repository hygiene. At 19:02:52 UTC, `check-branch-pr.mjs` reported this branch without an open PR. PR #372 was created at 19:02:56 UTC. Package tests and web passed. The final checks job failed because hygiene failed.

The pull-request run [40750746006](https://github.com/toddwyder/julia-next/actions/runs/40750746006) passed all four CI jobs. At 19:03:12 UTC, the same hygiene script confirmed every non-main branch had an open PR. This is a PR-creation race, not an unexplained flaky test. Both raw hygiene logs are retained. No failing check was disabled or dismissed.

The GitHub integration also created a Vercel preview for the existing root app. The owner issued no deployment command and did not deploy the separate dashboard. That preview is not PR-1 dashboard proof.

## Review and remaining gates

The implementation and test diff was reread against the base. The no-comments pass found no added code comments or suppressions in the scoped application, tests, config, or CLI changes. It deleted zero comments, restored none, and left no MUST KILL or REVIEW findings. No children were launched.

The inherited root Commander load failure and no-key assertion failure remain documented in `test-failure-investigation.md`. Fresh owner gates and exact final-head CI are recorded in the durable `status.md`, rather than inferred from prior passes.

Empty-list verification remains BLOCKED by unrelated Ready JUL-276. It was neither moved nor filtered. JUL-279 and JUL-280 remain Ready under the exclusive PR-1 reservation for independent verification. No mutations occurred during this checkpoint. Their eventual cancellation belongs after JUL-276 completes, under the program cleanup rule.

The retained UAT package includes phone and desktop screenshots and a 35-second list, Start, and Back video. Independent swarm, 200 percent zoom verification, real phone over Tailscale, and Todd's UAT yes remain unclaimed. No merge or deployment is authorized.

The regenerated scorecard remains program-wide. It selects earlier PR #371 rather than PR-1 #372. It has unpriced usage and missing ping receipts. Its priced subtotal is not the total program cost, and no UAT yes is recorded.
