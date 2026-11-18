---------------------------- MODULE TwoWriters ----------------------------
\* A model of the two-writers rule for Studio's observability trace file
\* (`trace.duckdb`) across Studio (`src/mastra/index.ts`) and the CLI runner
\* (`machine/flow/run.mjs`, `machine/flow/start.mjs`).
\*
\*   SingleWriter: at most one OS process ever holds `trace.duckdb` open for
\*   writing, and no process attempts to open it while another holds it.
\*
\*   NoSidecar: no `trace-resume-<pid>.duckdb` sidecar file is ever created.
\*
\*   SpansInStudioTrace: every completed resume writes its spans into
\*   `trace.duckdb`, the one trace file Studio shows.

EXTENDS Naturals, FiniteSets

CONSTANTS OpenTraceDbWhileStudioRuns, \* broken: runner ignores Studio API and opens trace.duckdb directly
          UseSidecarTraceFile         \* broken (PR #558): runner opens trace-resume-<pid>.duckdb

VARIABLES studioState,          \* "stopped" | "running"
          traceWriters,         \* subset of {"studio", "runner"} holding trace.duckdb
          lockError,            \* TRUE if a process attempted to open trace.duckdb while held
          sidecarCount,         \* number of trace-resume-<pid>.duckdb files created
          runnerState,          \* "idle" | "checking" | "resumed"
          runnerSawStudio,      \* result of fetchStudioRun(studioUrl, runId)
          resumedSpansLocation  \* "none" | "trace.duckdb" | "sidecar"

vars == <<studioState, traceWriters, lockError, sidecarCount, runnerState, runnerSawStudio, resumedSpansLocation>>

Init ==
  /\ studioState = "stopped"
  /\ traceWriters = {}
  /\ lockError = FALSE
  /\ sidecarCount = 0
  /\ runnerState = "idle"
  /\ runnerSawStudio = FALSE
  /\ resumedSpansLocation = "none"

StudioStart ==
  /\ studioState = "stopped"
  /\ traceWriters = {}
  /\ runnerState # "checking"
  /\ studioState' = "running"
  /\ traceWriters' = traceWriters \cup {"studio"}
  /\ UNCHANGED <<lockError, sidecarCount, runnerState, runnerSawStudio, resumedSpansLocation>>

StudioStop ==
  /\ studioState = "running"
  /\ runnerState # "checking"
  /\ studioState' = "stopped"
  /\ traceWriters' = traceWriters \ {"studio"}
  /\ UNCHANGED <<lockError, sidecarCount, runnerState, runnerSawStudio, resumedSpansLocation>>

RunnerCheckStudio ==
  /\ runnerState = "idle"
  /\ runnerState' = "checking"
  /\ runnerSawStudio' = IF OpenTraceDbWhileStudioRuns \/ UseSidecarTraceFile
                        THEN FALSE
                        ELSE (studioState = "running")
  /\ UNCHANGED <<studioState, traceWriters, lockError, sidecarCount, resumedSpansLocation>>

RunnerResumeViaStudio ==
  /\ runnerState = "checking"
  /\ runnerSawStudio = TRUE
  /\ studioState = "running"
  /\ runnerState' = "resumed"
  /\ resumedSpansLocation' = "trace.duckdb"
  /\ UNCHANGED <<studioState, traceWriters, lockError, sidecarCount, runnerSawStudio>>

RunnerResumeDirect ==
  /\ runnerState = "checking"
  /\ runnerSawStudio = FALSE
  /\ IF UseSidecarTraceFile
     THEN /\ sidecarCount' = sidecarCount + 1
          /\ resumedSpansLocation' = "sidecar"
          /\ runnerState' = "resumed"
          /\ UNCHANGED <<traceWriters, lockError>>
     ELSE /\ IF traceWriters # {}
             THEN /\ lockError' = TRUE
                  /\ traceWriters' = traceWriters \cup {"runner"}
                  /\ runnerState' = "resumed"
                  /\ resumedSpansLocation' = resumedSpansLocation
                  /\ UNCHANGED sidecarCount
             ELSE /\ lockError' = lockError
                  /\ traceWriters' = traceWriters
                  /\ runnerState' = "resumed"
                  /\ resumedSpansLocation' = "trace.duckdb"
                  /\ UNCHANGED sidecarCount
  /\ UNCHANGED <<studioState, runnerSawStudio>>

RunnerReset ==
  /\ runnerState = "resumed"
  /\ runnerState' = "idle"
  /\ runnerSawStudio' = FALSE
  /\ UNCHANGED <<studioState, traceWriters, lockError, sidecarCount, resumedSpansLocation>>

Next ==
  \/ StudioStart
  \/ StudioStop
  \/ RunnerCheckStudio
  \/ RunnerResumeViaStudio
  \/ RunnerResumeDirect
  \/ RunnerReset

Spec == Init /\ [][Next]_vars

SingleWriter ==
  /\ ~lockError
  /\ Cardinality(traceWriters) <= 1

NoSidecar == sidecarCount = 0

SpansInStudioTrace ==
  (runnerState = "resumed") => (resumedSpansLocation = "trace.duckdb")

=============================================================================
