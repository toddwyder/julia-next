# Server agents command

## Sub-features

Run a keyed command as ubuntu using the copied Julia agents pass and eight
committed references for CommandCode, Linear, Sentry and Axiom. Preserve literal
argv and child exit codes. Missing/unavailable pass refuses before child effects.
Original laptop/control-page references stay unchanged. Account spending findings
are Todd-supplied; CommandCode has no per-key cap. JUL-249 owns the runner cap.

## How to get to it (user POV)

On this server's existing ubuntu connection, open the exact JUL-250 candidate
worktree. Use node scripts/julia-agents.mjs -- followed by the command and argv.
The token remains at /home/ubuntu/.config/julia-agents/service-account-token.
julia-agent stays unused. No lockdown, sudo denial or control-pass denial is
required; these admin/deployed-code risks are accepted by Todd.

## Driving it with the real server op run route

Read the actual candidate commit, source hashes, Node/op versions and token
metadata without outputting its content. Run from that candidate's repository
root, saving stdout/stderr, exit, timestamps and exact source identity outside
the candidate while it is being reviewed:

```sh
git rev-parse HEAD
node --version
op --version
node --test scripts/julia-agents.test.mjs
node scripts/julia-agents.mjs -- node --experimental-strip-types ops/mastra-agents/reviewer/src/mastra/card-admission-check.ts JUL-250
```

For the learning drive, set FRAMEWORK_RUNNER_ROOT and FRAMEWORK_LOCKFILE to the
retained SDK learning installation /home/ubuntu/julia-jul-231/ops/build-runner
and its package-lock.json. Use the retained Beam observation preload in
NODE_OPTIONS, then run the complete thirteen-test suite through op run:

```sh
node scripts/julia-agents.mjs -- node --test --test-reporter=tap --test-concurrency=1 framework/@mastra/code-sdk/*.test.mjs
```

Observable success is all three real-op route tests passing, valid live admission,
the broken admission copy refusing for missing Acceptance criteria, and thirteen
learning tests passing together with zero skipped/inconclusive guard verdicts.
Retain provider HTTP/usage readbacks and Todd's accepted 06:58 Beam $0.0000 evidence;
do not fabricate a dollar field or poll for extra cost proof. The retained
run-learning.mjs drives the required broken/restored guard mutations and full run.

## Gotchas

A model not attempting the expected model-side step is inconclusive with one
rerun, never a guard pass/fail. Framework facts issue public framework calls
without a model. A real model is used only for resolution/refusal/feedback.
No skipped test, local bare-origin push or constructor switch proves production
runner publication or actual observational-memory inference. Keep those JUL-249
Proof obligations on that card. No paid model substitution is allowed for a
learning drive. Never repeat the completed bootstrap-item read.
