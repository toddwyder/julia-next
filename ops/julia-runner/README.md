# Julia runner support boundaries

Delivery starts only through `$init`, which invokes the Mastra workflow in
`ops/mastra-agents/reviewer/src/delivery-workflow.mjs`.

This directory retains one shared process boundary that the workflow still uses:

- `time-limit.mjs` owns bounded child-process execution.
There is no controller, model catalog, worker launcher, sudo adapter, retry
loop, acceptance route, merge route, or delivery entry point in this
directory. The retired JUL-122 orchestration and fixed-model launchers are gone.
