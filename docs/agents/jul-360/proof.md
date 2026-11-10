# JUL-360 Proof Runbook: Attributable Slice Costs

This runbook guides the Shipping reviewer (independent model maker per `docs/plans/path-forward.md:61`) in running planted failures and verifying all gates.

## 1. Quick Verification (Run All Tests)
```sh
node --test machine/budget/control.test.mjs
node machine/budget/formal/verify.mjs
node --test machine/flow/budget-integration.test.mjs
node --test machine/flow/exploration.test.mjs
node --test scripts/julia-agents.test.mjs
```
Expected: 156 passing tests (53 + 16 + 61 + 12, from the four `node --test` commands above, run on 2026-11-10 at 09d5c4d); formal verification prints `pass: true`.

## 2. Gate 1 & 2: Planted Failures (Caps & Pricing)
```sh
node --test --test-name-pattern="caps refused before model call" machine/budget/control.test.mjs
node --test --test-name-pattern="unpriced lead refused before provider" machine/budget/control.test.mjs
```
* **Planted missing caps**: Controller throws `missing_or_invalid_caps` before any model call starts.
* **Planted unpriced model**: Controller throws `no_price` before provider admission.

## 3. Gate 3 & 4: Cap Overshoot & Ledger Accounting
```sh
node --test --test-name-pattern="crossed or reached cap latches with trace numbers" machine/budget/control.test.mjs
node --test --test-name-pattern="native card workflow stops on dollar overshoot before Shipping" machine/flow/budget-integration.test.mjs
```
* **Planted dollar and token cap breach**: Slices stop at cap boundary, emit `cap_reached`, and lock against retries.

## 4. Gate 5: Stop Latch Formal Verification
```sh
node machine/budget/formal/verify.mjs
```
* Executes explicit-state BFS model checker (5,655 states) and real two-process concurrent interleaving test.
* Proves that once `stop.lock` is published, no slice admission or retry may persist `slice_start`.
* Includes real-code mutation sensitivity proof (`mutantPropertyPass: false`).

## 5. Gate 6: Graph First Exploration Refusal
```sh
node --test machine/flow/exploration.test.mjs
```
* Verifies planted `grep`, `rg`, `find`, `cat`, and workspace tools are refused and routed to `graphify query`.

## 6. Model Notes
* `moonshotai/Kimi-K3` is in `@mastra/observability`'s pricing table, but `moonshotai/Kimi-K3.1-Pro` has no entry in the price list.
* `AGENTS.md:10` now holds the gates line: "A build slice stops at its caps and exploration gates per JUL-360". It replaces the old "money never stops a card" rule, and `scripts/agent-docs.test.mjs` asserts it. Memory (observation and reflection) runs on `openai/gpt-6-luna`.
