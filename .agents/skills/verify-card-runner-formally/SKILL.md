---
name: verify-card-runner-formally
description: "Check the card runner's one-review, kept-answer and Todd-pause promises against every order of review, crash, post, repost and restart, using a TLA+ model and the TLC checker. Use when changing ops/card-runner/src/workflow.mjs, ops/card-runner/src/prompts.mjs, ops/card-runner/run.mjs, or anything about how many Shipping reviews a run starts, where the judge's answer is kept, or when a run leaves the approval pause."
---

# Verify the card runner formally

Three promises the runner makes, and what breaking each costs:

- **One review.** A run starts at most one Shipping review, however the process dies and restarts. Broken, a restart pays for a second review, and the card can get two different verdicts.
- **Kept answer.** The judge's answer is kept the moment it is written and never removed, so a crashed step reuses it and a failed post is sent again from it. Broken, a lost post costs another paid review.
- **Pause.** A Shipping PASS stops the run at the approval step and stays suspended until Todd says yes. A FAIL or an unusable answer ends without asking. Broken, a card reaches UAT without his yes.

Unit tests in `ops/card-runner/test/workflow.test.mjs` check the orders someone thought to write down. These promises are about every order of review, crash, post, repost and restart, so they are checked with a model in `formal/card-runner/CardRunner.tla` and TLC, which visits every reachable state.

## Run it

```
node scripts/check-card-runner-model.mjs
```

Four lines come back, and the run only exits 0 when all four are `ok`:

```
ok   shipped.cfg                      the runner starts one review, keeps the answer and waits for Todd: one review, kept answer and pause hold in every reachable state
ok   second-review-on-restart.cfg     a restart that starts another review is caught: OneReview catches it
ok   delete-answer-after-post.cfg     deleting the answer after posting is caught: AnswerKept catches it
ok   resume-without-todd.cfg          approving a paused run without Todd is caught: NoApprovalWithoutYes catches it
```

The three broken configurations are the point of lines two to four: each models one regression of the runner, and the run fails if the checker ever stops catching it. The checker (java and `tla2tools.jar` 1.8.0, pinned by sha256) downloads once into `formal/.tools/`, which is git-ignored. Java is already on the server; elsewhere install any JDK 21. A run takes about ten seconds.

Read a failing run with the pstack `/statechart` skill. It turns the checker's trace into the shortest path of steps in plain words, so you can see which crash, post or restart put the run in the bad state.

## What is checked, and what is not

Checked over every reachable state: a run that starts a review, writes PASS, FAIL or unusable, crashes before or after the answer lands, posts or fails to post, reposts, pauses, is approved, is refused, or restarts at any of those points.

Assumed, and therefore outside the model:

- Mastra storage keeps the workflow snapshot across a crash, and `start()` re-runs only the step that was interrupted. Measured with a libsql probe on 31 Oct 2026: steps a, b, c, b exited mid-step, the restart re-ran b and did not re-run a.
- A Shipping session is atomic from the model's point of view: it either writes the answer file or it does not.
- `postUntilItLands` retries a post three times before the record step reports `postError`; the model does not count the attempts.
- Two runs of the same card at once are not modelled. Each run has its own run id, and the CLI starts one run.
- The model is written by hand from the code. Nothing generates it, so "true to the code" is maintained by hand too, using the coverage record below.

## Coverage record

Confirmed to describe these files at commit `2e78496`.

| Model part (`formal/card-runner/CardRunner.tla`) | Code it stands for |
| --- | --- |
| `StartReview`, `marker` | `src/workflow.mjs` shipping step: `writeFileSync(markerPath, ...)` before `deps.runSession`, and `verdictPathFor`/`markerPath` |
| `StartAnotherReview` under `SecondReviewOnRestart` | broken variant only: a re-entry that starts a session even though the marker exists (the old free-attempt loop, or a restart that ignores the marker) |
| `WriteAnswer` | `src/workflow.mjs` shipping step: the session writes the verdict file, and `parseVerdict`/`validateVerdict` decide whether it is usable |
| `Crash`, `LeaveShipping` | `src/workflow.mjs` shipping step: an existing `verdictPath` is reused; an existing marker with no answer returns the "starts no second review" error |
| `PostAnswer`, `PostFails`, `PostNoAnswer` | `src/workflow.mjs` record step: card and pull comments through `postUntilItLands`, `postError` captured instead of thrown, and the "no usable verdict" comment |
| `Repost` | `run.mjs` `repostVerdict`: reads the run record or the kept verdict file and posts again with no session |
| `WaitForTodd`, `Approve`, `FinishWithoutApproval` | `src/workflow.mjs` approval step: `suspend` on a PASS, `resumeData.approved` on resume, and the immediate `approved: false` for anything else |
| `OneReview` | `.started.json` marker written before the one session |
| `AnswerKept` | verdict files under `<runDir>/verdicts/` are written once and never deleted |
| `FailedPostKeepsAnswer` | `postError` in the run record plus `run.mjs --repost`, which needs the answer file |
| `NoApprovalWithoutPass` | approval step guard `if (inputData.verdict?.verdict !== 'PASS')` |
| `NoApprovalWithoutYes` | approval step `suspend`/`resume` and `approveRun` requiring a suspended run |

## Scratch breaks

The broken configurations in `formal/card-runner/*.cfg` are the model's own breaks, not the code's. Two code breaks were confirmed by hand on 31 Oct 2026 and reverted:

- Removing the `existsSync(markerPath)` branch in the shipping step (so a restart with a marker starts a session) fails "a run whose review already started and wrote nothing starts no second review" in `ops/card-runner/test/workflow.test.mjs` with 1 review where 0 is wanted.
- Treating a missing `resumeData` as approval in the approval step fails "one run publishes the build, gates on evidence, and gets exactly one Shipping verdict" with status `success` where `suspended` is wanted.

The model run itself is the cheap check; the unit tests pin the same behaviour to the actual functions.

## When the check fails

1. Read the trace with `/statechart`, then find the step in the code listed above.
2. If the code is wrong, that is a bug: fix the code, not the model.
3. If the code changed on purpose, change the model in the same commit so it states the new design, and confirm the broken configurations still fail. A rewritten property that no configuration can break is a property that proves nothing.
4. If a configuration reports the wrong invariant, or the checker stops catching a break, the model has drifted from the code. Fix the mapping before trusting a pass.

## What this does not cover

Mastra's own storage and resume behaviour (measured separately, assumed here), the model's judgement about a change, the price catalogue and cost arithmetic, Linear and GitHub posting, the build and evidence-gate steps, and the text of any comment.
