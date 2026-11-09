---
name: verify-slice-latch
description: "Verify JUL-360 stop-latch admission when changing budget controller stop, clear, slice admission, retry or crash recovery. Exhaust a finite interleaving model, reproduce races against real code, and prove real-code guard mutation is caught."
disable-model-invocation: true
---

# Verify the slice stop latch

A published stop latch must prevent any new slice admission or retry until an attributed clear removes it. A violation allows another process to begin work after the run has stopped.

## Review the coverage first

Read `machine/budget/formal/README.md` and `machine/budget/control.mjs`. Coverage includes `createSliceControl`, `assertStart`, `begin`, `stop`, `clear`, `finish` and the durable lock helpers. Each model action maps to source lines in that README. The model separates stop-latch publication from record publication and separates the clear protocol's filesystem operations.

Last synchronized on 9 November 2026 against base commit `8da32d352c678aa63f560b784fd0c290ed76a879` **plus the uncommitted JUL-360 budget implementation**. The base lacks that implementation; `machine/budget/formal/result.json` pins the actual checked module by SHA-256. Move the sync commit forward only after reviewing the model against the new code. Do not treat the base commit as proof of synchronization with future changes.

Done means the source-to-model mapping still describes the current code, or the check is reported stale instead of trusted.

## Run the check

From the repository root, with Node.js v24.14.1:

```sh
node machine/budget/formal/verify.mjs
```

No secrets, provider access, TLC install, or production state are required. Disposable records and the real-code mutant live under `~/.local/state/julia-scratch` and are removed. JSON includes bounds, exhaustive state count, shortest counterexample, real-code findings, mutation detection, and source hash. It exits nonzero on a finding. A state-resource bound throws instead of reporting success.

The current expected result is **PASS**: a shared latch lock (`latch.lock`) synchronizes admission with stop publication so that once `stop.lock` is published, no admission may persist `slice_start`. The real two-process reproduction and the explicit-state model checker both pass with zero counterexamples.

Done means the full JSON has been inspected, not merely that the command ran.

## Confirm mutation sensitivity

The same command checks a disposable real-code mutant with the admission latch checks removed. It must record `mutantPropertyPass: false` while the original sequential latch/refusal/reconstruction checks pass. No production file is mutated. If source guard matching fails, update the mapping and mutant deliberately; do not suppress the failure.

The finite explicit-state Node checker explores two contenders, one external stop, one attributed clear, one retry, and at most one crash per contender. It assumes atomic exclusive create and atomic rename on a local filesystem and abstracts failed metadata reads as refusal. It is not a general JavaScript proof or a complete concurrent source refinement. The README states the remaining bounds and assumptions.

Done means the same property rejects the actual broken code copy, then the unchanged original is checked again.

## Read and act on findings

Tell the shortest counterexample in the code's nouns. If the model fails but the real reproduction passes, investigate a model mismatch before changing product code. If both fail, retain the finding until the synchronization protocol is corrected. Rerun the current-source reproduction after any fix and revise the model to match, without weakening the invariant.

Token accounting, in-flight overspend, memory drainage, provider requests, paid proof, clear-actor authorization and process termination are outside this proof. Use `/maintain-formal-verification-skill` to restore the mapping after changes. TLA+ is the default interleaving tool; this verification instead uses the finite dependency-free checker because TLC was not installed locally. If migrating it to TLA+, read every result with `/statechart` and retain the real-code reproduction and mutation test.
