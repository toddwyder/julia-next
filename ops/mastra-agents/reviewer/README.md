# Julia Mastra reviewer

JUL-223 stage three is rebuilding paid reviewer execution from the proven
stage-one seams. Paid execution remains disabled until the separately
authorized model-specific opt-in gate passes.

Retained code provides:

- immutable read-only Git tools for the pinned candidate;
- durable small-piece report recording and deterministic assembly;
- exact changed-file and evidence-quote checks;
- raw provider-response capture before parsing; and
- interruption progress that records accepted report pieces.

The stage-three offline runtime now adds:

- stock Mastra turn, output, per-request, and 20-minute total bounds;
- a durable pre-dispatch `$0.50` cost and elapsed-time reservation ledger;
- one bounded provider-boundary journal for requests, exact raw replies, and
  validated usage; and
- one shared atomic run-file writer for the recorder, budget, journal, and raw
  response evidence.

Removed code provided semantic recall, saved reviewer messages, message
history, vector storage and embeddings, internal-span export, a paid warn-only
prompt-injection classifier, a DuckDB-backed cost brake, machine-wide usage
reconciliation, shared trace retention, live format probes, and the direct
single-shot CommandCode reviewer route. Their 10-12 October incident record
remains in Git history and `claude/mastra-agents-design.md`; Todd's later 12 Oct
decision deleted the disposable reset backup and artifacts. None remains as an
executable fallback.

Run the offline package suite with:

```powershell
npm test
```

The `review` script still exits locally with the reset-disabled reason. It must
not be used for delivery until the model-specific opt-in gate passes.
