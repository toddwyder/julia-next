# JUL-250 request accounting repair

Todd's 22 October 2026 11:18 PT continuation supersedes the prior receipt blocker.
The supplied 11:12 PT account readback settles all old reservations: DeepSeek
19 requests / $0.4527; Ornith 24 / $0.0297; Beam 126 / $0; Glyph 16 / $0.
Total $0.4824, all monthly allowance. Ornith counts against the same $1 card cap.
The original reservations and receipts remain on evidence branch
`evidence/jul-250-review-cost-20261022`, commit 2fa9be9.

## Cause and repair

The learning fixture (`framework/@mastra/code-sdk/real-route.mjs`) had an
independent `freeModels` list, changed to Glyph and then Ornith by the retained
replacement scripts. Its forwarding call used the captured original fetch.
The Proof preload had a second model assertion admitting Ornith. Neither used
review admission. The fixture's red/green/full-suite drives and reviewer
verification tools therefore sent the 24 Ornith and 16 Glyph requests recorded
in the account. The misleading GOAT free listing did not make Ornith free.

All current learning forwarding and both retained Proof preload entry points
now use scripts/commandcode-requests.mjs. It admits Beam only for machinery
learning/Proof and DeepSeek only for reviewer review. Historical replacement
scripts check that admission before their old request and are refused. They
remain historical evidence; their responses are not rewritten.

One durable card ledger serializes reservation and settlement, includes the
supplied prior settlement, and saves every request's identity, model, purpose,
role, usage, completed cost and pricing provenance before returning its response
to the SDK. Retries are new requests. Unknown paid responses retain their
reservation and refuse another paid dispatch across restart. Reservations cover
the model's full one-million-token input context and the finite output ceiling,
using the highest rate reachable during the enforced five-minute timeout.
A completed charge is recorded even if unexpectedly over its bound; it is never
hidden to preserve a passing total. This is the requested JUL-250 repair;
JUL-249 still owns the production runner adapter.

The real DeepSeek metadata check returned HTTP 200 with response ID, model,
creation timestamp and token usage, but no dollar field or billing header.
CommandCode docs/provider documents terminal stream usage; its
[Pricing & Limits](https://commandcode.ai/docs/resources/pricing-limits) page
publishes DeepSeek input/output/cache rates and UTC peak windows. Boosted
monthly allowance leaves per-token rates unchanged. Cost is calculated at
completion from that response and those rates, including reasoning output and
cache reads. It is labeled calculated provenance, never fabricated as a
provider-reported dollar field. If the response supplies dollars, use them.
No human receipts or later lookup are part of the repaired path.

## Verification

Tracker tests were run red before implementation, then green. They observe
purpose/role refusal, exact response-cost arithmetic, durable settlement across
reopen, unknown-cost refusal across restart, and cap refusal. Actual Beam
resolution and refusal-feedback checks passed with zero skips through the
shared tracker. Full broken/restored suite and exact-candidate machine Proof
are retained in the final evidence; neither is called independent review.

`npm run lint:framework` and the targeted tracker lint pass. For completeness,
applying that tool's production-only no-file-write configuration to the entire
historical learning/evidence tree flags ten existing fixture/output file writes;
these create owned temporary Git/test fixtures and retained test evidence, not
hand-built progress state. Those extra broad invocations do not indicate a
provider or guard failure and are not substituted for the required lint command.
