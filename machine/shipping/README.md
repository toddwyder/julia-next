# The shipping machine

One program. It takes a pull request and the card it belongs to, has a fresh
Shipping agent run the card's own commands, and writes the agent's verdict on
the pull request with the commands and results copied out of Mastra's record of
the run.

```sh
node scripts/julia-agents.mjs -- node machine/shipping/run.mjs --pr 401 --card JUL-305
```

`--no-post` writes the determination to `.artifacts/shipping/pr-<n>/determination.md`
instead of commenting. `--model` overrides the model (default is the free Beam
model below). `--force` reviews and posts again when the saved record already
covers that commit; without it a rerun reads `record.json` first and stops, so a
run that died after commenting cannot comment twice.

## What happens, in order

1. `run.mjs` fetches `pull/<n>/head` and adds a detached worktree at
   `.artifacts/shipping/pr-<n>/worktree`, so the agent reviews the pull
   request's code rather than the machine's working copy.
2. It points `MASTRA_OBSERVABILITY_DB_PATH` at a new trace file under the
   traces directory and `MASTRA_DB_PATH` at a state database inside the run
   folder, so the machine's run never shares a writer with an interactive
   session.
3. `workflow.mjs` builds the stock Mastra workflow `shipping` with two steps.
   `gather` reads the card from Linear and takes its criteria. `review` calls
   the stock `subagent` tool with `agentType: "execute"` on
   `commandcode/reflection/beam:free`, giving it the pull request number, the
   commit, the checkout, the card verbatim and the stock Shipping playbook. The
   agent is fresh and is never given the builder's reasoning or evidence.
4. The run stops writing, and `trace-record.mjs` reads the trace back.
5. `determination.mjs` sets the agent's verdict beside each criterion and lists
   every `execute_command` the agent ran with what it returned, both taken from
   the trace. If the record kept a command without its result, the
   determination says so and lists the playbook's own steps instead.
6. `run.mjs` posts the comment, which starts `Shipping agent:`, and writes
   `record.json` beside it.

A failing verdict is a result, not a fault: the run still writes its record and
still posts. Only a run that cannot start writes nothing.

## Where the pieces come from

The Mastra modules are loaded from the installed Mastra Code program
(`MASTRACODE_PROGRAM_DIR`, default `~/.local/lib/mastracode-program`) rather
than from this repository's dependencies, because the machine must run the same
harness that made the code it reviews. The departures from stock pstack and
stock Mastra Code are rows in `docs/pstack-deviations.md`.

Beam is free on Command Code, which this machine reaches through the Command
Code custom provider in the harness settings. A 429 waits 30s, 90s and 240s and
asks the same model again.

## The cards it reads

The card must have a `## Criteria` section with one bullet per criterion. The
machine judges nothing itself: it prints the criteria, hands them to the
Shipping agent, and writes down what came back.
