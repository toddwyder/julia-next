# The card machine

One way to start a card. It builds the card in a workflow run, then hands the same
run to review and to landing.

```sh
node machine/build/run.mjs JUL-334
```

`--pr <n>` starts from a pull request that already exists. `--dry-run` prints each
step's command and starts nothing. `--model` overrides pstack's choice, for a
diagnosis; the file below stays the one place the build model is set.
`--time-limit-min` overrides the build's hour.

## What happens, in order

1. `run.mjs` names a trace file under the traces directory and boots the stock
   session from `machine/shipping/harness.mjs` in this repository.
2. It reads the build model from `~/.agents/pstack-models.md` (`model.mjs`) and
   builds the workflow `card` (`workflow.mjs`) with four steps.
3. `build` starts the session on the card with the kickoff prompt
   (`agent.mjs`). The session's own records carry the step's span, so the agent's
   runs sit inside the workflow's trace tree rather than beside it. The card is
   also put on the run as a tag, so the build's model calls can be found by card.
4. `pull-request` takes the open pull request that names the card. None, or more
   than one, stops the card.
5. `review` starts `machine/remediation/run.mjs`, and `landing` starts
   `machine/merge/run.mjs`, both with the card and the pull request. They are
   separate processes with their own traces and state, exactly as before.
6. A step that fails throws. The workflow stops, the trace keeps the steps that
   ran, and `run.mjs` writes `.artifacts/build/<card>/record.json` and ends the
   command with the step and the reason on its last line.

The build's limit is a stop, not a kill: when the clock fires the step aborts the
run the way a person pressing stop does, so the record keeps what the build did
before the limit.

## pstack's names, on a plain agent

The build is not a pstack harness of its own. It is the session an interactive
run uses, so pstack's parts map onto stock Mastra Code tools:

| pstack | here |
| --- | --- |
| a skill | a file under `.agents/skills/`, which the agent reads with its own file tools |
| a role (feature, judgment, swarm worker…) | the model each child agent runs on, from `~/.agents/pstack-models.md` |
| a child agent | the stock `subagent` tool: `explore`, `plan`, `execute` |
| a run instruction | the kickoff prompt in `agent.mjs` |
| a fresh verifier | the review step, which starts the existing remediation command |
| a step ceiling | the controller's own 1000 steps for the session; `SUBAGENT_MAX_STEPS` in the harness for each child |

`docs/harness/mastra-code.md` still describes Mastra Code's own harness and is
unchanged by this machine.
