# 0026. One stock Mastra workflow carries a card along the whole path, on stand-in work

Date: 2026-11-04

Status: Accepted (JUL-336).

## Context

The path in [path-forward](../plans/path-forward.md) runs as a Mastra workflow, built one step at a time, and each later card replaces one stage with its real behaviour. Before that starts, the machine's shape has to exist once in stock Mastra: a card goes build, Shipping, Todd's acceptance, land, live smoke test, retro, cleanup, with Remediation after a Shipping FAIL, one shared FAIL count, and a cost record. Every stage here does stand-in work — the agent stages ask the free model to write one throwaway line, the deciding stages are fixed rules — so the shape is proved without any real card moving.

The point of the card is what the flow is made of, not what it does. Flow logic may exist only as workflow and agent definitions, and every piece of order, state, retry, FAIL count and wait has to be a setting Mastra documents, cited at a line. A previous attempt at this (JUL-334) is the negative control: its build step reached for the machine's own harness instead of the workflow engine, which is why it does not count as the pattern.

## Decision

`machine/flow/` holds it, and nothing imports `@mastra/code-sdk` or the machine's harness:

| File | What it is |
| --- | --- |
| `schema.mjs` | one `flowData` shape every stage takes and returns, plus `cardState`, the saved state |
| `agents.mjs` | four plain agents on the free model — build, shipping, remediation, retro — with no tools |
| `steps.mjs` | the stages: agent stages, the fixed rules that decide, the wait, and the cleanup |
| `workflow.mjs` | the graph: two loops, the branch points, one FAIL count |
| `mastra.mjs` | the Mastra instance, the two stores, and the span processor that stamps every span with the card |
| `trace.mjs` | reads the run back out of the trace store and totals each stage |
| `start.mjs` | assembles a run, starts it, and resumes it |
| `run.mjs` | the command line: `start`, `resume`, `status`, `cost` |

Each piece of flow logic and the Mastra feature that carries it:

| Flow logic | Mastra feature | Where |
| --- | --- | --- |
| Stage order | `.then()` | `workflow.mjs` throughout |
| Choose remediation, a stop report, land, or the wait | `.branch()` with mutually exclusive conditions | `workflow.mjs` |
| Rounds of Shipping and of live smoke, and the whole card | `.dountil()` | `workflow.mjs` |
| One FAIL count across Shipping and live smoke | workflow state (`stateSchema`, `setState`) | `schema.mjs`, `steps.mjs` |
| The FAIL count survives a wait and a resume of the same run | state is part of the saved snapshot | `docs-workflows-workflow-state.md` |
| Waiting for Todd, and continuing on his answer | `suspend()` / `resume()`, `suspendSchema`, `resumeSchema` | `steps.mjs` `acceptance` |
| A run killed while it waits comes back at the same stage | snapshot stored per run in the state store | `docs-workflows-snapshots.md` |
| A stale answer, or another run's answer, is refused | the stage re-suspends while `resumeData.request` differs | `steps.mjs` `acceptance` |
| Two retries of a model-call stage | step `retries: 2` | `reference-workflows-step.md:245` |
| Each stage start and end nested under the one run | `tracingContext` passed into `generate()` | `reference-agents-generate.md:199` |
| Every model call carries the card | `spanOutputProcessors` | `reference-observability-tracing-interfaces.md:1254` |
| Cost: each model call once, run total and per-stage share | trace spans and `metric_events` | `trace.mjs` |
| Watching a run | Mastra Studio | `src/mastra/index.ts` |

## Decisions made along the way

These are the choices the card left to the builder, with the fact each rests on.

**The wait sits two levels deep, not three.** Todd's acceptance began inside `attempt → deliver → acceptance`. Resuming a suspension that deep restarts the outermost suspended step: the run went back to build, took a new request, and asked its question again. A suspension one level deeper (`attempt → acceptance`) resumes where it stopped, and a probe showed the position survives the process dying. So `deliver` was deleted and land and smoke moved after the loop.

**The stage after a branch unfolds the branch's output.** `.branch()` hands on an object keyed by the id of every arm (`docs-workflows-control-flow.md:316`), including the arms that did not run, whose keys are undefined. The `unwrap` stage takes the arm that produced card data. Without it every later stage failed its own input check.

**A second FAIL from either part gets its own branch arm.** Stopping is decided by the FAIL count, and both Shipping arms are false at that count, so `.branch()` produced nothing for `unwrap` to read. Each decision point now has an arm that leads to the stop report, so exactly one arm is always true.

**The stop report is written by the stage that stopped.** A report is part of that stage's result, not a later step's job, so the wording lives in one helper and both stopping points use it.

**The cost record is written after Mastra has flushed.** Mastra's exporter buffers spans, and the first runs ended with a trace that lost the last stages and a cost record that counted fewer model calls than the run made. The command line now shuts the instance down and only then totals the trace. A run killed while it waits never reaches that point, so its cost is totalled when the run is resumed.

**Agent stages retry; deciding stages do not.** A re-run of a deciding stage would count a FAIL twice, so `retries` sits only on the four model-call stages, not on the workflow as a whole.

**Nothing is priced, and the record says so.** The free model has no published price, so Mastra's own cost estimation reports `no_matching_model` and the record prints the run cost as unknown with that reason. Tokens are counted per call, once each.

**Studio is reached from a standard folder.** `src/mastra/index.ts` registers the same workflow against the same state store, so `FLOW_DIR=... npx mastra dev` shows a run that the command line started, and starts its own.

**The credential wrapper supplies the key under the name the registry reads.** `@mastra/core`'s model registry looks for `CMD_API_KEY`, so `scripts/julia-agents.env` maps it to the same 1Password item and `scripts/julia-agents.mjs` lets it through.

## What proves it

- Twelve tests in `machine/flow/*.test.mjs`, one per outcome: a pass, a Shipping FAIL then a pass, two Shipping FAILs, a live smoke FAIL then a pass, two live smoke FAILs, Todd's no then yes, a machine card, a refused stale answer, a model call counted once, an unknown price, and a run record read from a real trace file.
- A product card and a machine card through `scripts/julia-agents.mjs`, with the free model answering in both.
- A run killed with `kill -9` while it waited, then resumed in a fresh process at the same stage and the same question.
- The same workflow run from Mastra Studio, by HTTP and in its run view.

## Consequences

- The stages are stand-ins on purpose. A later card replaces one stage's stand-in and leaves the rest of the graph alone.
- The free model is the only model here, so the cost record proves counting, not pricing. A priced model makes the same record report dollars.
- The acceptance wait cannot move deeper into the graph without losing its place. A card that needs a wait deeper than two levels has to bring the work that follows it back up to the same level.
