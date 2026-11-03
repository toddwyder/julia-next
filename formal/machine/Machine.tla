----------------------------- MODULE Machine -----------------------------
\* A model of the promise machine/watch.mjs makes about a card run that stops
\* (JUL-329, JUL-331).
\*
\*   watchOnce (machine/watch.mjs) — one pass over the run store. A run whose
\*   process is gone keeps its last heartbeat, so once the record's own idle
\*   limit has passed the pass marks the in-flight step failed, records
\*   pingedAt/pingedReason and tells Todd. The mark is written before the ping
\*   is sent (store.stall in machine/parent/store.mjs), and a run that already
\*   carries a ping is skipped, so however often the timer runs, and however
\*   many passes see the same dead run, Todd hears about that run once.
\*
\* The model checks the order of the watcher's own steps, not the clock and not
\* the network. It assumes, and therefore does not check here:
\*   - A run's heartbeat stays fresh while its process is alive and stops the
\*     moment the process is gone, so "quiet past the idle limit" and "the
\*     process vanished" are the same state here.
\*   - store.stall's read-then-write is one step; the timer never runs two
\*     passes at the same time on the same record.
\*   - One run is watched. Pings are counted per run, so one run's count is
\*     "one ping per run, ever".
\*
\* Each broken variant is a regression of machine/watch.mjs that the checks must
\* catch, so a passing run also proves the checks can fail.
EXTENDS Naturals

CONSTANTS PingOnEveryPass, \* broken: drop the pingedAt check and ping on every pass
          MarkFinishedRuns \* broken: treat a finished run as quiet and mark it stalled

VARIABLES run,   \* the run: "alive" (process beating), "vanished", "finished"
          step,  \* the in-flight step: "running", "succeeded", "failed"
          marked, \* the record carries pingedAt and pingedReason
          pings  \* pings sent to Todd for this run, counted up to two

vars == <<run, step, marked, pings>>

Init ==
  /\ run = "alive"
  /\ step = "running"
  /\ marked = FALSE
  /\ pings = 0

\* The process behind the run dies. Nothing writes to the record again, so its
\* heartbeat ages past the run's own idle limit.
RunDies ==
  /\ run = "alive"
  /\ run' = "vanished"
  /\ UNCHANGED <<step, marked, pings>>

\* The run finishes its work. A finished run is no longer watched.
RunFinishes ==
  /\ run = "alive"
  /\ run' = "finished"
  /\ step' = "succeeded"
  /\ UNCHANGED <<marked, pings>>

\* A pass that finds nothing to do: the run is still beating.
PassWhileBeating ==
  /\ run = "alive"
  /\ UNCHANGED vars

\* A pass over a run that has already finished: shownStatus is the stored
\* status, not "stalled", so the pass sends nothing.
PassAfterFinish ==
  /\ run = "finished"
  /\ UNCHANGED vars

\* A pass over a vanished run that already carries a ping: watchOnce skips it.
PassAlreadyPinged ==
  /\ run = "vanished"
  /\ marked
  /\ UNCHANGED vars

\* A run past its idle limit that the pass treats as stalled. The shipped code
\* only gets here for a vanished run and only while pingedAt is empty; each
\* broken flag removes one of those two guards.
Stallable ==
  \/ run = "vanished"
  \/ MarkFinishedRuns /\ run = "finished"

\* The pass that pings Todd: store.stall marks the in-flight step failed and
\* records pingedAt/pingedReason, then the ping is sent.
WatchPass ==
  /\ Stallable
  /\ IF PingOnEveryPass THEN TRUE ELSE ~marked
  /\ step' = "failed"
  /\ marked' = TRUE
  /\ pings' = IF pings < 2 THEN pings + 1 ELSE pings
  /\ UNCHANGED <<run>>

Next ==
  \/ RunDies
  \/ RunFinishes
  \/ PassWhileBeating
  \/ PassAfterFinish
  \/ PassAlreadyPinged
  \/ WatchPass

\* The timer runs the watcher again and again, and a pass that could ping is
\* not put off forever.
Spec == Init /\ [][Next]_vars /\ WF_vars(WatchPass)

\* At most one ping per run, ever: a second pass over the same dead run finds
\* pingedAt written and sends nothing.
PingOnce == pings <= 1

\* A finished run is never marked stalled: it never carries a ping, and its
\* in-flight step is never failed by a pass.
NoStallOnFinish == run = "finished" => /\ ~marked
                                     /\ step /= "failed"

\* A vanished run is eventually pinged: it is the only state a pass stalls, and
\* a pass that stalls keeps its ping.
VanishedEventuallyPinged == (run = "vanished") ~> marked

=============================================================================
