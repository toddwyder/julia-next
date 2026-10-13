# Julia runner support boundaries

Delivery starts only through `$init`, which invokes the Mastra workflow in
`ops/mastra-agents/reviewer/src/delivery-workflow.mjs`.

This directory is retained because the workflow still reuses its narrow worker
support:

- `time-limit.mjs` owns bounded child-process execution.
- `run-tests.mjs`, `run-gemini.mjs`, and `run-codex-builder.mjs` are
  isolated worker boundaries retained for their safety contracts and tests.
- `run-reviewer.mjs` remains a worker wrapper; it does not sequence or start
  a delivery.

There is no controller, card launcher, retry loop, acceptance route, merge
route, or delivery entry point in this directory. The retired JUL-122
orchestration and its sudo adapter were deleted during the JUL-196 Mastra
cutover.
