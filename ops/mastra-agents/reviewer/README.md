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
- a measured 15-second stock per-step bound;
- a durable pre-dispatch `$0.50` cost and elapsed-time reservation ledger;
- a 2 GiB free-disk preflight, 768 MiB sampled RSS ceiling, and 128 MiB
  disk-growth reservation;
- one bounded provider-boundary journal for requests, exact raw replies, and
  validated usage; and
- one shared atomic run-file writer for the recorder, budget, journal, and raw
  response evidence.

The scripted four-file/eight-criterion maximum fixture makes all 70 calls through
the installed `Agent.generate()` path. Two 14-second replies produced a 14.253-
second maximum complete agent step. The configured 15-second bound is below the
17.143-second per-step share of the 20-minute total and leaves 150 seconds for
agent/tool overhead. RSS sampling every 10 ms across complete agent steps found
a 22,519,808-byte maximum within-step increase. The active sampler aborts at
736 MiB (the 768 MiB ceiling minus the 32 MiB next-power-of-two reserve), and
the same guard refuses pre-dispatch. This is offline
evidence for the bound and library plumbing, not proof
of CommandCode latency; the paid route remains disabled until the separately
authorized model-specific probe confirms the real service.

The same offline suite proves step, elapsed, cost, evidence, RSS, disk-growth,
and free-disk refusals end as `SYSTEM_ERROR` with saved progress. The retained
measurement is `claude/jul-223-stage3-offline-proof.json`.

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
