## Why

JUL-251 needs one stock Mastra connection core with durable per-card accounting and credentials outside builder commands. The trial remains at $0 while implementing the $1 ceiling.

## What changed

- Add the owning pinned SDK installation, settings-driven stock routing, and one durable request ledger for actor, retry and memory attempts.
- Reserve before dispatch, retain unknown usage across restarts, and isolate direct and nested builder commands from credentials.
- Preserve stock Auto memory and align inherited documentation checks with the approved hybrid rulebook.

## Scope

- Includes the existing hybrid trial rulebook and skill setup on this branch.
- Excludes delivery orchestration, running reviews, JUL-249 changes and household behavior changes. Todd decides the merge after the retro.

## Tradeoffs

Inference responses are buffered until accounting completes. Conservative full-context reservations can refuse affordable paid requests; live paid use remains disabled. Missing response usage is detected after the first response, then later priced dispatches are refused before sending.

## Blast Radius

The new runner is isolated under ops/build-runner. Existing framework tests remain unchanged. Subscription routing uses stock credential sources; no live subscription renewal or paid-provider bounds are claimed.

## Verification

- 36 local behavior tests pass. All 43 selected guard mutations are caught and restored green; disabling stock memory is caught separately.
- All 17 framework learning tests pass. Documentation, path and line-ending checks pass 20 tests; delivery checks pass 33 tests.
- Real free requests, direct and nested credential probes, stock observation/reflection/absent-history recall, memory-off and restart readback pass at $0. Reflection uses a disclosed repeated-observation fixture at unchanged stock thresholds.

[Proof and limitations](proof.md), [decision trail](decisions.tsv), and [retro](retro.md). Review used fresh agents of the configured inherited model. The concurrent-process check passes; transaction-lock removal alone has no deterministic mutation proof.

Closes JUL-251
