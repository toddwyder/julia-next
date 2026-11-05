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
| Stage order | `.then()` | `workflow.mjs`; `docs-workflows-control-flow.md:18` |
| Choose remediation, a stop report, land, the wait, or the machine card's own way past the wait | `.branch()` with mutually exclusive conditions | `workflow.mjs`; `docs-workflows-control-flow.md:226`, `:316` |
| Rounds of Shipping and of live smoke, and the whole card | `.dountil()` | `workflow.mjs`; `docs-workflows-control-flow.md:503` |
| Reading a branch's output back into the flow | `.map()`, the documented reshape after `.branch()` | `workflow.mjs` `unfold`; `docs-workflows-control-flow.md:316`, `:428`, `:497` |
| One FAIL count across Shipping and live smoke | workflow state (`stateSchema`, `setState`) | `schema.mjs`, `steps.mjs`; `docs-workflows-workflow-state.md:14` |
| The FAIL count survives a wait and a resume of the same run | state is part of the saved snapshot | `docs-workflows-workflow-state.md:14` |
| Waiting for Todd, and continuing on his answer | `suspend()` / `resume()`, `suspendSchema`, `resumeSchema` | `steps.mjs` `acceptance`; `docs-workflows-suspend-and-resume.md:9`, `:58` |
| A run killed while it waits comes back at the same stage | snapshot stored per run in the state store | `docs-workflows-snapshots.md:84` |
| A stale answer, or another run's answer, is refused | the stage re-suspends while `resumeData.request` differs | `steps.mjs` `acceptance` |
| Two retries of a model-call stage | step `retries: 2` | `reference-workflows-step.md:245` |
| Each stage start and end nested under the one run | `tracingContext` passed into `generate()` | `reference-agents-generate.md:199` |
| Every model call carries the card | `spanOutputProcessors` | `reference-observability-tracing-interfaces.md:1254` |
| Cost: each model call once, run total and per-stage share | trace spans and `metric_events` | `trace.mjs` |
| Watching a run | Mastra Studio | `src/mastra/index.ts` |

## Decisions made along the way

These are the choices the card left to the builder, with the fact each rests on.

**The wait sits two levels deep, not three.** Todd's acceptance began inside `attempt → deliver → acceptance`. Resuming a suspension that deep restarts the outermost suspended step: the run went back to build, took a new request, and asked its question again. A suspension one level deeper (`attempt → acceptance`) resumes where it stopped, and a probe showed the position survives the process dying. So `deliver` was deleted and land and smoke moved after the loop.

**A mapper after each branch unfolds its output.** Mastra documents `.map()` for reshaping a branch's output before the next element (`docs-workflows-control-flow.md:428`, `:497`). The docs say the output is keyed by each executed step's id (`:316`); that this object also carries a key for every arm that did not run, with `undefined` under it, is what a probe on the installed engine showed, and it is why `workflow.mjs`'s `unfold` mapper takes the arm that produced card data instead of reading the object directly. Without it every later stage failed its own input check. A `map` is graph wiring rather than a stage, which is why no stage reshapes data for the graph.

**A second FAIL from either part gets its own branch arm.** Stopping is decided by the FAIL count, and both the remediation arm and the pass arm are false at that count, so `.branch()` produced nothing for the mapper to read. Each decision point has an arm of its own that leads to the stop report, so exactly one arm is always true. The live smoke test keeps no stopping rule of its own: it records the verdict, the count, and the part, and the stop is the graph's arm. The count threshold is written once, in the loop's exit predicate; a stage that can record a FAIL never decides anything.

**A machine card leaves the path by a branch, not by an `if` inside the wait.** Which cards wait for Todd is flow logic, so it lives in the graph: three arms at the wait, one for a stop, one for a machine card's own fixed stage, one for the acceptance that suspends. The acceptance stage no longer knows what kind of card it is.

**One stage writes every stop report.** Both stop arms lead there, and the part that failed and the reason are already in saved state by then, so the wording lives in one helper instead of once per stopping point.

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
- The cost record totals a trace file, not a run id: two runs sharing one trace store would be added together. The command line gives each run its own folder, so today they never do.
- The acceptance wait cannot move deeper into the graph without losing its place. A card that needs a wait deeper than two levels has to bring the work that follows it back up to the same level.

## Update (JUL-338): a card begins in Studio, and the build stage is real

The decision above still stands. Two of its stand-ins are now gone, and one way of starting a card
was removed.

A card starts in Mastra Studio's run form and nowhere else. The run form asks for two things, the
card key and the kind, and the first stage of the workflow copies both into saved state and opens
that card's own folder under `FLOW_DIR`. `run.mjs` keeps `resume`, `status` and `cost`; it has no
`start` command, and `scripts/start-machine.mjs`, the launcher that used to begin a card from the
command line, is deleted with its test. Answers to a waiting card still come from the command line,
which reads the card out of the run's saved snapshot instead of a record file.

The build stage is a real agent step. `createStep(agents.build, { retries: 2 })` runs an `Agent` that
holds the repository as a workspace with the pstack skills and a shell, so the build can read the
card, branch, commit and open the pull request; the model is read from the pstack models file's
`feature, refactoring` line. Because the agent step's contract is `{prompt}` in and `{text}` out, two
plain stages sit either side of it: `startBuild` names the card, counts the round, sets the request
id and returns the prompt, and `finishBuild` writes what the agent wrote into the card's folder and
puts the flow data back. Shipping, remediation and retro are still stand-ins.

Every artifact, verdict queue and stop report now lives in that card's folder, so two cards started
from the same Studio server do not share a queue; the state and trace stores stay at the folder the
server opened.

`docs/agents/machine-programs.md` names every program that begins a card or carries a stage, with a
fingerprint, and `node scripts/machine-programs.mjs --check` fails a pull request that changes one
without updating the list or adds a program the list never names. A change to the machine is now a
reviewable diff of that list, not a sentence in a description.
