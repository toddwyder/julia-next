# 0013. Incremental small-piece tool recording for reviewer reports

Date: 2026-10-12

Status: Proposed

## Context

Generating a comprehensive adversarial review in a single structured JSON output is fragile:
large reviews risk token truncation, malformed JSON recovery discards all completed analysis,
and process interruption or model crash loses all progress.

## Decision (Agent Design Choice)

The reviewer records its evaluation incrementally through Mastra tools (`record_piece`,
`replace_piece`, `remove_piece`, `show_missing`, `submit_report`):

1. The reviewer agent submits individual report components (header, axis verdicts, per-file
   findings, acceptance criteria checks, counterexamples, test audit).
2. Each accepted piece is fsynced and atomically renamed into the run folder immediately.
3. If an input is malformed or invalid, the tool returns a corrective error for the model to fix.
4. Final assembly and schema validation (`envelopeFor` and `checkedReview`) occur deterministically
   in repository code upon submission.
5. Incomplete runs retain a durable failure sidecar identifying all accepted keys.
6. Every started run ends in exactly one of four outcomes: `PASS`, `FAIL`, `INCONCLUSIVE`, or
   `SYSTEM_ERROR`. `INCONCLUSIVE` is a completed review, not a failure. If a worker exits without
   a terminal record, the runner records `SYSTEM_ERROR` from the exit or timeout and the durable
   progress sidecar. Once a validated verdict is saved, later logging or telemetry failures may
   add warnings but never replace that verdict.

## Consequences

- Reviewer progress survives transient crashes or interruptions.
- Model output parsing is bounded to small discrete units.
- Report assembly logic is kept deterministic in repository code rather than delegated to LLM JSON generation.
