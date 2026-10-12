# Julia Mastra reviewer

JUL-223 stage one has reset this package to its proven seams. Paid reviewer
execution is deliberately disabled until the later offline build and proof
stages supply the replacement budget and model-event interfaces.

Retained code provides:

- immutable read-only Git tools for the pinned candidate;
- durable small-piece report recording and deterministic assembly;
- exact changed-file and evidence-quote checks;
- raw provider-response capture before parsing; and
- interruption progress that records accepted report pieces.

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

The `review` script currently exits locally with the reset-disabled reason. It
must not be used for delivery until JUL-223's later offline gates pass.
