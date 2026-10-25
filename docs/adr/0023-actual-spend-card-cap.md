# 0023. One ten-dollar card cap counted from settled actual usage

Date: 2026-10-25

Status: Accepted by Todd on 25 October 2026.

The card cap counts settled actual usage at published API prices. A request reserves nothing against the cap before dispatch. The ledger still records the request's configured maximum for an unresolved outcome, but that maximum no longer refuses a request. The card stops once settled spend exceeds the cap, and later requests are refused. The request that crosses the cap completes and records its actual cost. The cap is $10 per card across every role, retry and run, including subscriptions at published API prices. Unpriced or unbounded requests are still refused before dispatch. An unknown outcome still retains its recorded maximum and blocks further priced work until reconciled.

## Context

JUL-252's first real build never dispatched. The 113,059-byte Opus request carried a UTF-8 estimate of 230,214 input tokens, so its worst-case reservation was $2.005552, above the whole $2 cap before the $0.140036 planning spend. The pre-dispatch gate refused it.

Counting with the bundled tokenizer admitted the request. Eight requests then settled at $1.223852 in actual usage. The next worst-case maximum exceeded the $0.776148 remaining, so the gate stopped the build before the agent wrote its checklist. Todd reviewed that measured usage and decided the gate should be actual spend, not a worst-case maximum.

## Consequences

A card can spend up to the cap in real usage, even when a single request's worst-case maximum is larger. The over-cap request completes; the stop applies to later work. The recorded maximum remains useful only for an unknown outcome's final charge. The dashboard's remaining balance is counted from settled spend, not held maxima. The default cap is $10, and the ledger and tests use that number. ADR 0022's subscription connection and settlement rules remain; its $2 cap and pre-request reservation gate are superseded.
