# Diagnosis: JUL-252's first build was refused before dispatch

> 25 October follow-up: Todd replaced the $2 cap and the pre-request worst-case
> reservation gate with a $10 cap counted from settled actual usage
> ([ADR 0023](../../adr/0023-actual-spend-card-cap.md)). The tokenizer fix in
> this document remains. The reservation figures below record the old policy.

Run: `jul-252-04db241d9dbeda4fc7d58701cd7b66d2`
Observed: `session not completed`, no checklist, Claude Opus 5.5 orchestrating and DeepSeek V4.1 Flash coding.

## Cause

The build session's first Anthropic request was refused by the card ledger before it reached HTTP. The worker only saw `Error: session not completed`; the saved `events.jsonl` carries the folded `Request ledger refused operation` from `transport.mjs:175`, and the ledger probe shows the underlying message is `Card cost ceiling exceeded`.

The request was priced by a padded local estimate of **113,059 UTF-8 bytes × 2 + 4,096 = 230,214 input tokens**. At the configured one-hour cache-write rate of $8 per million and the 8,192-token output bound at $20 per million, the reservation is:

```
230,214 × $8/M + 8,192 × $20/M = $2.005552
```

That is above the whole $2 card ceiling before counting the $0.140036 the planning turn had already spent. The reservation was therefore refused, `runner.run()` returned `status: "error"`, the worker threw `session not completed`, and no checklist was written because the first build turn never dispatched.

The estimate was the anomaly, not the card cap: the bundled `js-tiktoken` o200k_base tokenizer counts **26,881 tokens** for the same serialized request. Keeping the deliberate 2× padding and 4,096 framing tokens gives 57,858 input tokens and a **$0.626704** reservation. With the planning spend the card would be at $0.766740 of $2, leaving room for the build.

## Evidence

- `job.json`, `events.jsonl`, `requests.json`, `receipts.json`, `ledger.json`: the failed run's saved artifacts.
- `requests.json`: the planning request to `https://api.anthropic.com/v1/messages` returned 200; the next request to the same model and URL carries `refusal: "Request ledger refused operation"` and no status.
- `receipts.json`: the planning turn settled at 140,036,000 nano-dollars; the build receipt is `status: "error"` with the same refusal.
- `numbers.json`: the old and new estimates and reservations.
- `verify-real-body.mjs`: replays the captured 113,059-byte request through the fixed transport against a copy of the card ledger.

The build request was captured offline from the run's own settings, snapshot, plan and workflow skill with a fake upstream, so no model request was spent to measure it.

## Red first

The regression test is `a real-sized Claude build request reserves below the two-dollar card after planning` in `ops/build-runner/test/catalogue.test.mjs`. On the old estimator it fails with the run's exact symptom:

```
$ node --test --test-reporter=spec --test-name-pattern="real-sized Claude build request|prices, bounds and wire endpoints" ops/build-runner/test/catalogue.test.mjs
✖ a real-sized Claude build request reserves below the two-dollar card after planning
  Error: Request ledger refused operation
      at ledgerCall (transport.mjs:175:65)
      at guardedFetch (transport.mjs:235:31)
```

`red.txt` and `green.txt` hold the full outputs.

## Fix

`ops/build-runner/catalogue.mjs`: Anthropic models use the bundled local tokenizer (`o200k_base`) with the unchanged 2× multiplier and 4,096 framing tokens. The estimate remains local, free, labelled, padded, and settled against reported usage; only its input count becomes realistic. `README.md` records the new method.

## Hypotheses rejected

1. Subscription sign-in or token refresh failed. Falsified: the planning request on the same Claude route returned 200 and settled.
2. The shared ledger was locked or corrupt. Falsified: the planning reservation and settlement succeeded; the probe reproduces the ceiling refusal on a copy.
3. The model route or wire model was wrong. Falsified: `requests.json` names the same Opus model and URL, and the route resolved before the ledger call.
4. The whole request exceeded the remaining balance because of the cap. Confirmed as the mechanism; the estimator was the defect.
5. The duplicated workflow skill text was the only cause. It contributed bytes, but the estimator was already 5.9× the planning turn's reported input and 8.6× the build request's tokenizer count. Fixing the estimator is the high fix; removing skill text alone would not keep later turns inside the cap.
