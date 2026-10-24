No code blocker found in the focused Claude stock-cache compatibility change.

Static trace:
- `ops/build-runner/transport.mjs: unsupportedPaidContent(value, cacheWriteTtl)` recurses arrays and `Object.values`, so the configured TTL is preserved through nested system/message/tool structures.
- It compares `(value.cache_control.ttl ?? '5m') !== cacheWriteTtl`. With `cacheWriteTtl: '1h'`, literal stock middleware output `{type:'ephemeral',ttl:'1h'}` is accepted; the same request under a `5m` config is rejected as `Unsupported paid request shape`. Missing implicit TTL correctly defaults to `5m`.
- `configuration()` spreads `spec`, preserving `cacheWriteTtl`; `guardedFetch` passes `spec.cacheWriteTtl ?? '5m'`.
- Haiku settings use base `cacheWrite: 0.20`, `output: 0.50`; `totalCharge()` yields 10 × 0.20/MTok = 2000 nano plus 1 × 0.50/MTok = 500 nano, total 2500 nano.
- Reservation uses `spec.maximumPrice` from the max across base and tiers. Settlement selects the tier by `input + cacheRead + cacheWrite` and charges that tier.

No static trace shows a mismatch/default/TTL-preservation, reservation-tier, or settlement-tier defect in this focused change. Stock auth and real subscription proofs remain UNVERIFIED; overall acceptance remains INCONCLUSIVE. This is static review, not executed proof.
