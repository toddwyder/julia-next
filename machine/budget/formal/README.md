# JUL-360 stop-latch verification

**Property:** after `stop.lock` is published, no new slice admission or retry may persist a `slice_start` until an attributed clear removes the latch.

**Harm:** another process can begin work after the run has stopped, defeating the server-wide stop promise.

## Run cold

From the repository root, using Node.js v24.14.1:

```sh
node machine/budget/formal/verify.mjs
```

The command prints machine-readable JSON and exits nonzero for a finding. It never calls a provider or touches the production budget directory. Its disposable copies and records live under `~/.local/state/julia-scratch/jul360-formal-*` and are deleted afterwards. `result.json` records the checked working-tree result, including the source SHA-256. This is evidence, not a permanent assertion that future code passes.

TLA+ is the skill's default for interleaving problems. Java is available, but TLC was not installed or cached in the inspected local tool tree. This target needs only finite-state reachability, so the check uses a dependency-free explicit-state breadth-first model checker in Node, plus a deterministic two-process execution against the actual JavaScript. There is no claim of a JavaScript theorem prover or an unbounded proof.

## Verification outcome

The property is verified and passes across both the real two-process runner and the bounded explicit-state model.

The prior counterexample was resolved by adding a shared latch lock (`withLatchLock`, using `latch.lock`) that synchronizes the final admission check and `slice_start` persistence with `stop.lock` publication. When an external stop is published while a contender is in admission, the contender acquires `withLatchLock`, verifies that `stop.lock` exists, releases `active.lock`, and refuses admission with `slice_stopped`.

Both the real-code interleaving reproduction and the exhaustive 5,655-state model checker pass with zero counterexamples. The mutant model deliberately disables the latch check and fails with the expected counterexample, proving that the check is necessary.

## Coverage and code mapping

All references are to `machine/budget/control.mjs` as checked on 9 November 2026, base commit `8da32d352c678aa63f560b784fd0c290ed76a879` plus the uncommitted JUL-360 implementation. That base commit does not contain the budget module; the JSON source SHA-256 pins the actual checked version.

| Model/check action | Production function and lines |
| --- | --- |
| initial checks | `assertStart`, 92–95 |
| exclusive ownership | `assertStart`, 96–111 |
| post-acquisition checks | `assertStart`, 112–116 |
| persist start | `assertStart`, 120–128 (`withLatchLock`) |
| stop publication then record | `stop`, 75–88 (`withLatchLock`); `atomic`, 54–59 |
| clear lock, validation, record reset, lock/latch deletion | `clear`, 177–201 |
| retry admission | same `assertStart`, used by `begin` 130–132 and `finish` 171–174 |
| restart/refusal | actual reconstruction of `createSliceControl`, 34–49 and `assertStart` |
| crash/interrupted ownership | durable active lock and dead-owner detection, 98–107 |

The checker exhausts a finite abstraction with two admission contenders, one external stop, one attributed clear, one retried admission, and at most one crash of each contender. There is no execution-depth cutoff: deduplicated states are exhausted. A 250,000-state resource limit throws rather than reporting a proof. Each observed latch check and publication is a separate transition. Stop is **not** one indivisible transition. Clear lock creation, record reset, active-lock deletion, stop-latch deletion, and clear-lock deletion are distinct transitions. The model excludes model-provider execution and accounting because the chosen property concerns admission, not token arithmetic.

Filesystem assumptions: exclusive file creation and same-filesystem rename are atomic; completed fsync calls have their documented durability; no malicious file edits, corrupted JSON, PID reuse, disk errors, or network filesystem deviations. Lock metadata creation is abstracted to exclusive ownership. Parse errors during incomplete metadata publication reject rather than authorize admission. JavaScript-local preparation is abstracted into the following publication. `finish` abstracts the successful release path; it is not a proof of all finish error paths. The finite model is an abstraction and not complete source-code refinement. The independently reproduced counterexample does not rely on those abstractions.

## Able to fail

The command also creates a disposable copy of the **real control module**, removes its two stop-latch admission checks and its local stopped-phase guard, and executes the ordinary sequential stop/admission property. The original refuses; the mutant persists `slice_start` after stop. This is a mutation proof against real code, separate from the model's deliberately disabled-guard variant. Guard matching is exact and fails loudly if covered source changes.

Sequential real-code checks also cover retry, a reconstructed controller, refusal of `begin`, and successful admission only after attributed `clear`. These are conformance/regression checks, not exhaustive concurrent source verification.

## Not covered

This does not prove a dollar/token hard ceiling, bound in-flight requests, settle memory work, prove exactly-once trace accounting, validate all filesystem/crash interleavings, prove authorization of clear actors, or exercise a paid model. It does not prove that Studio terminates immediately. A pass of a future fixed model must still be accompanied by the real-code checks and a review of the mapping.

After code changes, use `/maintain-formal-verification-skill` and review this mapping before advancing the sync commit or replacing the recorded result. Never retain the old model solely to obtain a passing result.
