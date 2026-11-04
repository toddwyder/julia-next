# Proof: one stock Mastra workflow can run the build agent and show its cost in one trace

## Goal
The repository holds a finding, backed by one real run, that says whether a stock Mastra workflow step can run the same build agent the machine runs today, with that agent's model calls, token counts, cost and pstack skill use all recorded in the workflow run's own trace. The finding decides whether the machine can become one workflow with one store and one trace per card.

## Steps
1. Add `spikes/stock-workflow-proof/run.mjs`. It boots the installed Mastra Code program through `machine/shipping/harness.mjs`, defines one stock `createWorkflow` with one `createStep`, and the step calls the stock Execute subagent with a trivial task: follow the poteto-mode skill and write a one-line file into a scratch folder. It starts the workflow with `createRun`, writes Mastra's trace for the whole run to one file through `MASTRA_OBSERVABILITY_DB_PATH`, and runs on the model the machine's build uses today.
2. Run it once on the server. The run stops by itself at $0.50 or 10 minutes, whichever comes first.
3. Read the single trace file from that run and answer in `spikes/stock-workflow-proof/FINDINGS.md`, each answer backed by a query or file line quoted from the trace:
   - Do the agent's model-call spans sit under the workflow run's span?
   - Do those spans carry token counts and a cost estimate?
   - Does the trace show the poteto-mode skill being read?
   - While the run is going, does Mastra's stock way of listing active workflow runs show it; after it ends, what status does the run report?
   - Does everything land in one trace file with no second store?
4. End `FINDINGS.md` with one line: `Verdict: yes`, `Verdict: partly, and here is the gap`, or `Verdict: no, and here is why`.

## Acceptance criteria
- The proof run finishes on the server with exit status 0 and leaves one trace record for the whole run.
- `FINDINGS.md` answers every question in step 3, and each answer quotes the evidence that supports it.
- The pull request changes only the `spikes/stock-workflow-proof/` folder, and leaves Mastra and pstack untouched.
- Todd can read `FINDINGS.md` in plain English and see the verdict line.

## Outside check
The Shipping reviewer opens the trace file named in `FINDINGS.md`, re-runs each quoted query, and confirms the answer matches.

## Out of scope
Changing `start-machine`, any machine stage, the scorecard, the retry patch, or pstack. The proof script is throwaway: a later card deletes it when the rebuild is decided.

## Pull request
Name only this card in the pull request title and description. The body carries the verdict line and the cost of the run.
