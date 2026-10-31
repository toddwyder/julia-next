---------------------------- MODULE CardRunner ----------------------------
\* A model of the three promises the card runner makes about one review.
\*
\*   One review (ops/card-runner/src/workflow.mjs, shipping step) — a run starts
\*   at most one Shipping session. The started marker is written before the
\*   session starts, and a re-run of the step reads the kept answer or stops
\*   with a reason instead of starting another review.
\*
\*   Kept answer (same step, record step, run.mjs --repost) — the answer file is
\*   written once and never removed, so a crashed step reuses it, a failed post
\*   can be sent again, and no second review is needed to do either.
\*
\*   Pause (approval step, run.mjs --approve) — a PASS stops the run at the
\*   approval step and stays suspended until Todd resumes it with a yes. A FAIL
\*   or an unusable answer ends the run without asking.
\*
\* Assumed, and therefore not checked here:
\*   - Mastra storage keeps the workflow snapshot across a crash, and start()
\*     re-runs only the step that was interrupted (measured with a libsql
\*     probe on 31 Oct 2026: steps a, b, c; b exited mid-step; restart re-ran b).
\*   - The Shipping session itself is atomic from the model's point of view:
\*     it either writes the answer file or it does not.
\*   - A post that fails can be retried by hand with the same kept answer; the
\*     model does not count the three automatic attempts.
\* The model checks the order of the runner's own steps, not Mastra's internals.
EXTENDS Naturals, TLC

CONSTANTS SecondReviewOnRestart, \* broken: a restart with only the marker starts another review
          DeleteAnswerAfterPost, \* broken: posting removes the answer file
          ResumeWithoutTodd     \* broken: a restart at the pause approves the run itself

VARIABLES step,        \* the step being executed: "shipping", "record", "approval", "done"
          marker,      \* the started marker file exists
          answer,      \* the answer file: "none", "PASS", "FAIL" or "unusable"
          kept,        \* the first answer ever written, kept to compare against
          reviews,     \* Shipping sessions started by this run
          session,     \* a Shipping session is running right now (lost on a crash)
          posted,      \* the answer reached the card: "none", "ok" or "failed"
          waiting,     \* the run is suspended at the approval step
          approved,    \* Todd said yes
          toddSaidYes, \* an Approve action happened
          everWaited   \* the run reached the pause at least once

vars == <<step, marker, answer, kept, reviews, session, posted,
          waiting, approved, toddSaidYes, everWaited>>

Init ==
  /\ step = "shipping"
  /\ marker = FALSE
  /\ answer = "none"
  /\ kept = "none"
  /\ reviews = 0
  /\ session = FALSE
  /\ posted = "none"
  /\ waiting = FALSE
  /\ approved = FALSE
  /\ toddSaidYes = FALSE
  /\ everWaited = FALSE

\* Starting the one review. The marker lands before the session, which is what
\* makes a restart after a crash unable to start a second one.
StartReview ==
  /\ step = "shipping"
  /\ ~session
  /\ ~marker
  /\ answer = "none"
  /\ reviews < 2
  /\ marker' = TRUE
  /\ session' = TRUE
  /\ reviews' = reviews + 1
  /\ UNCHANGED <<step, answer, kept, posted, waiting, approved, toddSaidYes, everWaited>>

\* Broken regression: a restart that finds the marker but no answer starts
\* another review instead of stopping with a reason.
StartAnotherReview ==
  /\ SecondReviewOnRestart
  /\ step = "shipping"
  /\ ~session
  /\ marker
  /\ answer = "none"
  /\ reviews < 2
  /\ session' = TRUE
  /\ reviews' = reviews + 1
  /\ UNCHANGED <<step, marker, answer, kept, posted, waiting, approved, toddSaidYes, everWaited>>

\* The session writes its answer file, then returns. The first answer is kept.
WriteAnswer(v) ==
  /\ step = "shipping"
  /\ session
  /\ answer = "none"
  /\ session' = FALSE
  /\ answer' = v
  /\ kept' = IF kept = "none" THEN v ELSE kept
  /\ UNCHANGED <<step, marker, reviews, posted, waiting, approved, toddSaidYes, everWaited>>

\* The process dies mid-step. The session is lost; the marker, the answer file
\* and the workflow snapshot are not.
Crash ==
  /\ session
  /\ session' = FALSE
  /\ UNCHANGED <<step, marker, answer, kept, reviews, posted,
                 waiting, approved, toddSaidYes, everWaited>>

\* Coming back to the Shipping step: the answer file is reused when it exists;
\* the marker with no answer takes the stop-with-a-reason branch. Either way the
\* step ends without starting anything.
LeaveShipping ==
  /\ step = "shipping"
  /\ ~session
  /\ (answer /= "none" \/ marker)
  /\ step' = "record"
  /\ UNCHANGED <<marker, answer, kept, reviews, session, posted,
                 waiting, approved, toddSaidYes, everWaited>>

\* The record step posts the answer. The answer file stays put.
PostAnswer ==
  /\ step = "record"
  /\ answer /= "none"
  /\ posted' = "ok"
  /\ step' = "approval"
  /\ answer' = IF DeleteAnswerAfterPost THEN "none" ELSE answer
  /\ UNCHANGED <<marker, kept, reviews, session, waiting, approved, toddSaidYes, everWaited>>

\* The post fails after its automatic retries. The answer file is what makes a
\* later --repost possible.
PostFails ==
  /\ step = "record"
  /\ answer /= "none"
  /\ posted' = "failed"
  /\ step' = "approval"
  /\ answer' = IF DeleteAnswerAfterPost THEN "none" ELSE answer
  /\ UNCHANGED <<marker, kept, reviews, session, waiting, approved, toddSaidYes, everWaited>>

\* No answer to post: the card still gets the "no usable verdict" comment.
PostNoAnswer ==
  /\ step = "record"
  /\ answer = "none"
  /\ posted' = "ok"
  /\ step' = "approval"
  /\ UNCHANGED <<marker, answer, kept, reviews, session, waiting,
                 approved, toddSaidYes, everWaited>>

\* Sending the kept answer again with --repost. No session starts.
Repost ==
  /\ posted = "failed"
  /\ answer /= "none"
  /\ posted' = "ok"
  /\ UNCHANGED <<step, marker, answer, kept, reviews, session,
                 waiting, approved, toddSaidYes, everWaited>>

\* A PASS stops at the approval step and suspends.
WaitForTodd ==
  /\ step = "approval"
  /\ answer = "PASS"
  /\ ~waiting
  /\ waiting' = TRUE
  /\ everWaited' = TRUE
  /\ UNCHANGED <<step, marker, answer, kept, reviews, session, posted,
                 approved, toddSaidYes>>

\* Todd says yes: the run resumes and finishes.
Approve ==
  /\ step = "approval"
  /\ waiting
  /\ waiting' = FALSE
  /\ approved' = TRUE
  /\ toddSaidYes' = TRUE
  /\ step' = "done"
  /\ UNCHANGED <<marker, answer, kept, reviews, session, posted, everWaited>>

\* Todd says no, or no answer was ever approved.
FinishWithoutApproval ==
  /\ step = "approval"
  /\ (waiting \/ answer /= "PASS")
  /\ waiting' = FALSE
  /\ approved' = FALSE
  /\ step' = "done"
  /\ UNCHANGED <<marker, answer, kept, reviews, session, posted, toddSaidYes, everWaited>>

\* Broken regression: a restart at the pause treats the run as approved without
\* Todd answering.
AutoApproveOnRestart ==
  /\ ResumeWithoutTodd
  /\ step = "approval"
  /\ waiting
  /\ waiting' = FALSE
  /\ approved' = TRUE
  /\ step' = "done"
  /\ UNCHANGED <<marker, answer, kept, reviews, session, posted, toddSaidYes, everWaited>>

\* A finished run stays finished.
Terminate ==
  /\ step = "done"
  /\ UNCHANGED vars

Next ==
  \/ StartReview
  \/ StartAnotherReview
  \/ \E v \in {"PASS", "FAIL", "unusable"} : WriteAnswer(v)
  \/ Crash
  \/ LeaveShipping
  \/ PostAnswer
  \/ PostFails
  \/ PostNoAnswer
  \/ Repost
  \/ WaitForTodd
  \/ Approve
  \/ FinishWithoutApproval
  \/ AutoApproveOnRestart
  \/ Terminate

Spec == Init /\ [][Next]_vars

\* One review per run, however the run crashes and restarts.
OneReview == reviews <= 1

\* The judge's answer is kept the moment it is written and never removed.
AnswerKept == kept = "none" \/ answer = kept

\* A failed post can be sent again from the kept answer, with no new review.
FailedPostKeepsAnswer == posted = "failed" => answer /= "none"

\* Nothing is approved that did not pass Shipping.
NoApprovalWithoutPass == approved => kept = "PASS"

\* The pause ends only when Todd says yes.
NoApprovalWithoutYes == approved => toddSaidYes

\* A run that paused, paused.
PausedAtLeastOnce == waiting => everWaited

=============================================================================
