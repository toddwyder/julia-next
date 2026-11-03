# Can one stock Mastra workflow run the build agent and show its cost in one trace?

JUL-325. One real run on the server answered this, and every answer below is
quoted from that run's own trace file.

## What ran

- Script: `spikes/stock-workflow-proof/run.mjs` (throwaway).
- How: `node scripts/julia-agents.mjs -- node spikes/stock-workflow-proof/run.mjs`
- Model: `commandcode/reflection/beam:free` — the same model `machine/remediation/workflow.mjs`
  hands the build agent today (`BUILDER_MODEL = FREE_MODEL`).
- Shape: one stock `createWorkflow` with one stock `createStep`. The step calls the same
  `subagent` tool the Shipping and Remediation machines call, with `agentType: "execute"`
  and a trivial task: read `.agents/skills/poteto-mode/SKILL.md`, then write one line to a
  scratch file.
- It stopped itself, no timeout: 12.8 seconds, `"status": "success"`, `"timedOut": false`,
  `"estimateUsd": 0`. The file
  `.artifacts/stock-workflow-proof/scratch/proof.txt` holds exactly
  `stock workflow step ran the build agent`.
- The workflow run id: `fbd233eb-5b63-40d2-b9a1-433678ce585d`.
- One trace file for the whole run:
  `/home/ubuntu/julia-builder/.artifacts/stock-workflow-proof/trace-2026-11-03T05-03-24-635Z.duckdb`
  (9 MB). It sits in `.artifacts/`, which git ignores, so it is not in this pull request.
- One state file: `/home/ubuntu/julia-builder/.artifacts/stock-workflow-proof/state-2026-11-03T05-03-24-635Z.db`

To check any answer below, run these two commands on the server:

```
node spikes/stock-workflow-proof/query.mjs .artifacts/stock-workflow-proof/trace-2026-11-03T05-03-24-635Z.duckdb
node spikes/stock-workflow-proof/probe-status.mjs .artifacts/stock-workflow-proof/state-2026-11-03T05-03-24-635Z.db stock-workflow-proof
```

`query.mjs` prints the SQL above each answer. `probe-status.mjs` makes no model calls.

### One quirk to know before reading any number

Mastra writes every span's start row twice: once with the span's attributes, once with the
string `"null"` in the attributes column. Unfiltered, every count and sum comes out doubled.
Query Q0 shows it:

```
{"spanType":"model_inference","n_rows":16,"n_spans":8}
{"spanType":"tool_call","n_rows":14,"n_spans":7}
```

Every query below filters `attributes <> 'null'`, so counts are real.

## 1. Do the agent's model-call spans sit under the workflow run's span?

**No.** They are a second, separate root trace inside the same file.

The workflow run span (Q1a):

```
{"spanType":"workflow_run","name":"workflow run: 'stock-workflow-proof'","spanId":"b474540a1667be7f","parentSpanId":null,"traceId":"d17ff6397778900bf8d6b28b0421da2c","runId":"fbd233eb-5b63-40d2-b9a1-433678ce585d"}
```

The agent run span (Q1b):

```
{"spanType":"agent_run","name":"agent run: 'subagent-execute'","spanId":"34f20b8d7b348774","parentSpanId":null,"traceId":"7c2caf67030a391554f1923b2788de81","runId":"5c95c701-319c-4945-95b6-ac458bc574f4"}
```

Different `traceId`, different `runId`, and `parentSpanId` is null on both — the agent run
has no parent. The workflow run span has exactly one child (Q1c):

```
{"spanType":"workflow_step","name":"workflow step: 'build'","parentSpanId":"b474540a1667be7f"}
```

Walking up from a model call stops at the agent run (Q1d):

```
{"depth":3,"spanType":"agent_run","name":"agent run: 'subagent-execute'","spans":216}
{"depth":2,"spanType":"model_generation","name":"llm: 'reflection/beam:free'","spans":72}
{"depth":1,"spanType":"model_step","name":"step: 0","spans":3}
{"depth":0,"spanType":"model_inference","name":"inference: 0","spans":1}
```

The chain is `model_inference → model_step → model_generation → agent_run`, and stops.
The workflow run is not above the agent run.

No stored field ties the two together (Q1e searches every span's input, attributes and
output for the workflow run id):

```
(no rows)
```

The gap is structural, not a wiring mistake in this script: the stock `subagent` tool runs
the agent in its own trace context, so the workflow cannot name its builder from the trace.

## 2. Do those spans carry token counts and a cost estimate?

**Tokens: yes, twice over. Cost: no.** The model's cost estimate is null because the model
is free, so Mastra has no price for it.

Token counts on the model calls, read from each call's own span (Q2a):

```
{"model":"reflection/beam:free","calls":8,"input_tokens":132095,"output_tokens":675,"cache_read_tokens":111616}
```

The same numbers again as Mastra metrics (Q2b):

```
{"name":"mastra_model_total_input_tokens","value":132095,"estimated_cost":null,"costUnit":null}
{"name":"mastra_model_total_output_tokens","value":675,"estimated_cost":null,"costUnit":null}
{"name":"mastra_model_input_cache_read_tokens","value":111616,"estimated_cost":null,"costUnit":null}
{"name":"mastra_model_input_text_tokens","value":20479,"estimated_cost":null,"costUnit":null}
{"name":"mastra_model_output_text_tokens","value":360,"estimated_cost":null,"costUnit":null}
{"name":"mastra_model_output_reasoning_tokens","value":315,"estimated_cost":null,"costUnit":null}
{"name":"mastra_model_duration_ms","value":12494,"estimated_cost":null,"costUnit":null}
```

Every cost column is empty. The trace cannot show what the run cost in dollars; it can show
what it spent in tokens. That matches what the scorecard already does on this repo: it prices
traced tokens itself rather than trusting a cost field. So "show its cost" means the scorecard's
own pricing, applied to these metrics — not something the trace provides.

Second gap: every `metric_events` row in a per-run trace file has `threadId` null. The
scorecard finds a card's cost by joining on `threadId`, so on a per-run trace file that join
finds nothing. Cost would have to be looked up by trace or run id instead.

## 3. Does the trace show the poteto-mode skill being read?

**Yes.** The agent read the skill file with the stock `view` tool (Q3a):

```
{"name":"tool: 'view'","path":".agents/skills/poteto-mode/SKILL.md","offset_from_top":1}
{"name":"tool: 'view'","path":".agents/skills/poteto-mode/SKILL.md","offset_from_top":200}
{"name":"tool: 'view'","path":".agents/skills/poteto-mode/SKILL.md","offset_from_top":null}
```

The full tool list for the run is short, and the read is in it (Q3b):

```
{"name":"tool: 'view'","input":"{\"path\":\".agents/skills/poteto-mode/SKILL.md\",\"offset\":200,\"limit\":300}"}
{"name":"tool: 'view'","input":"{\"limit\":200,\"offset\":1,\"path\":\".agents/skills/poteto-mode/SKILL.md\"}"}
{"name":"tool: 'execute_command'","input":"{\"command\":\"mkdir -p /home/ubuntu/julia-builder/.artifacts/stock-workflow-proof/scratch && printf 'stock workflow step ran the build agent\\\\n' > /home/ubuntu/julia-builder/.artifacts/stock-workflow-proof/scratch/proof.txt\"}"}
{"name":"tool: 'execute_command'","input":"{\"command\":\"cat /home/ubuntu/julia-builder/.artifacts/stock-workflow-proof/scratch/proof.txt\"}"}
```

The file also holds 8 `skill_action` spans, all `skill:inject` — that is the harness putting
skill text into the prompt, which is separate from the agent opening the file itself. Both
are recorded.

## 4. While it runs, does Mastra's stock way of listing active runs show it, and what status after?

**During: yes, it shows the run id. After: the run drops off the active list, and its status
sits in the stored snapshot, not on a status method.**

`run.mjs` polls `workflow.listActiveWorkflowRuns()` every 2 seconds while the run is going.
All six polls found it (`record-2026-11-03T05-03-24-635Z.json`):

```
"activeDuring": [
  {"at":"2026-11-03T05:03:29.760Z","total":1,"runs":[{"runId":"fbd233eb-5b63-40d2-b9a1-433678ce585d"}]},
  ... five more polls, same single runId ...
],
"activeAfter": {"total": 0, "runs": []}
```

The listing gives the run id and nothing else — no status on the entry. `run.getStatus()` is
not a method on a stock run; it returns undefined.

Status lives in the stored record, inside `snapshot.status`, which `probe-status.mjs` prints
after the run:

```
listActiveWorkflowRuns(): 0 active
listWorkflowRuns(): 1 total
  keys: workflowName, runId, snapshot, resourceId, createdAt, updatedAt
  {"workflowName":"stock-workflow-proof","runId":"fbd233eb-5b63-40d2-b9a1-433678ce585d","snapshot":{"runId":"fbd233eb-5b63-40d2-b9a1-433678ce585d","status":"success", ... "result":{"answer":"I wrote \"stock workflow step ran the build agent\" to ...","modelId":"commandcode/reflection/beam:free"} ...},"resourceId":null,"createdAt":"2026-11-03T05:03:27.753Z","updatedAt":"2026-11-03T05:03:40.523Z"}
```

So a machine that wants to watch a card's run live can poll the active list for the run id,
and read `snapshot.status` from storage for how it ended. Note `resourceId` is null, so a
listing scoped to a user or resource would not find it.

## 5. Does everything land in one trace file, with no second store?

**One trace file, yes. One store, yes — but the file holds two traces, not one.**

Q4a — two trace ids in the single file:

```
{"traceId":"d17ff6397778900bf8d6b28b0421da2c","spans":6,"first_span":"2026-11-03T05:03:27.757Z"}
{"traceId":"7c2caf67030a391554f1923b2788de81","spans":289,"first_span":"2026-11-03T05:03:27.793Z"}
```

Q4b — what the file holds across both traces:

```
{"spanType":"processor_run","spans":24}
{"spanType":"model_chunk","spans":23}
{"spanType":"workspace_action","spans":14}
{"spanType":"model_inference","spans":8}
{"spanType":"skill_action","spans":8}
{"spanType":"model_step","spans":8}
{"spanType":"tool_call","spans":7}
{"spanType":"mapping","spans":7}
{"spanType":"workflow_run","spans":1}
{"spanType":"workflow_step","spans":1}
{"spanType":"agent_run","spans":1}
{"spanType":"model_generation","spans":1}
```

Q5 — the workflow's answer came back out of the stock step:

```
{"name":"workflow run: 'stock-workflow-proof'","eventType":"end","output":"{\"answer\":\"I wrote \\\"stock workflow step ran the build agent\\\" to /home/ubuntu/julia-builder/.artifacts/stock-workflow-proof/scratch/proof.txt.\",\"modelId\":\"commandcode/reflection/beam:free\"}"}
```

Nothing is written anywhere else. The state DB beside the trace holds the run record
(`mastra_workflow_snapshot`, one row) and one thread; it holds no spans
(`mastra_ai_spans` is empty), so the trace is the only place spans live.

## What this means for one workflow, one store, one trace per card

- A stock Mastra workflow step can run the same build agent the machine runs today, and the
  workflow gets the agent's answer back as its own output. That part works as hoped.
- One DuckDB file per run can hold both the workflow and the agent, and no second store is
  needed.
- The gaps: the agent's trace is a separate root that no stored field ties to the workflow
  run, so "which builder ran for card JUL-n" needs the run id carried by hand (the run
  record's `context` and `result` hold the input and answer, so a card id can live there);
  cost in dollars is not in the trace for a free model, and per-run traces have no `threadId`,
  so the scorecard's current join would not find them; and run status is read from
  `snapshot.status` in storage, not from `run.getStatus()`.

Verdict: partly, and here is the gap — one stock workflow step does run the build agent and
its tokens land in one trace file, but the agent's spans form their own root trace with
nothing linking them to the workflow run, and the trace carries tokens rather than a dollar
cost for the model the machine builds on.
