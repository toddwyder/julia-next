# JUL-251 — Narrow Shape and triage

The three SDK answers and evidence were pushed in [a4538e2](https://github.com/toddwyder/julia-next/commit/a4538e2). Work stayed on `hybrid/pstack-trial`; model spending was $0 and inference dispatches were zero. No build, PR, or merge was started.

1. **No unconditional usage guarantee.** All three source types share the stock per-step usage interface when counts are supplied: `promptTokens`, `completionTokens`, `totalTokens`, with optional reasoning/cache counts and `raw`. Stock custom-provider streaming does not request usage, so some sources can omit it. [Exact fields for each source and evidence](narrow-shape.md#a-per-request-token-usage).
2. **Yes, unattended subscription use and refresh after authorization.** The installed SDK reads saved ChatGPT credentials and uses the refresh-token grant without keyboard interaction. Initial authorization and recovery from a rejected refresh still require account authorization. This is established from installed source, not a live subscription test. [Evidence](narrow-shape.md#b-unattended-subscription-use-and-renewal).
3. **Yes, functional credential isolation is possible through stock runtime sources.** Default local storage is plaintext app-data `auth.json` (0600); custom-provider `settings.json` can also hold keys, and local bootstrap can export them. The adapter must keep secret-bearing storage away from builder files and filter child environments; the SDK offers runtime credential/provider sources. Todd's accepted admin risk is unchanged. [Storage paths, caveat and evidence](narrow-shape.md#c-credential-storage-and-builder-isolation).

Question for Todd: Stock routing does not guarantee token usage from every custom provider. To keep every request within the $1 ceiling, should a source that omits usage be refused, with further card requests blocked while its usage is unknown?

Pocock triage replaced [JUL-251](https://linear.app/julia-next/issue/JUL-251/hybrid-trial-model-neutral-connection-core-with-a-dollar1-card-ceiling)'s description from JUL-249 item 1, the three findings and Todd's supplied dated decisions. It remains **Triage**, with its existing **related** link to JUL-249. No source-card text was changed. [Actual card readback](evidence/narrow-shape/linear-after.json), [verification receipt](evidence/narrow-shape/triage-readback.json), [description as written](card-brief.md).

## Acceptance criteria as written

1. The runner uses Mastra's stock model routing, and Todd can change which model serves each role through settings without changing core code.
2. Every request contributes its tokens at the configured published API rates to the same durable card total, including subscription, retry and memory requests; free requests contribute $0, and restarting or concurrent work does not reset or evade the total.
3. A model without a price is refused, and the next request that could take the card past $1.00 is refused before it is sent.
4. Builder commands and builder-readable files contain neither provider keys nor subscription sign-in credentials.
5. Mastra's stock Auto memory is active with observational memory on.

## Verification

Maker self-check, not independent review: three new public-interface learning tests passed together; no inference reached the network. The request-inspection test stops the actual SDK-built custom-provider request before dispatch and fabricates no provider response. The credential tests use synthetic markers in owned temporary directories and delete them. Renewal and returned live token usage are source-backed findings, not claimed live account behavior. [Test output](evidence/narrow-shape/learning-tests.txt), [numbered source with hashes](evidence/narrow-shape/installed-source.md), [version/lockfile preflight](evidence/narrow-shape/preflight.json).

Triage redundancy search: the trial has no `ops/build-runner`; existing `scripts/commandcode-requests.mjs` and reviewer budget code are provider/role-specific and do not supply the requested neutral core. There is no `.out-of-scope/` rejection knowledge base on this branch. Existing Feature and needs-triage labels are consistent and retained. Todd explicitly instructed description replacement and Triage status, so the skill's recommendation wait was already answered by the task. The 14:05 description was retained only as historical intake evidence, not used as requirements.

The branch rulebook already says framework facts use installed packages/version-matched docs and that learning tests stay green; no QA scheduling criterion was added. The only test-authoring fault found was strict comparison of Node's special process.env object to an ordinary object; comparing its plain value snapshot fixed the assertion. No SDK or production implementation was changed.
