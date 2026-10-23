# PR316 generic workflow completion feedback review

Contract from the supplied user requirements: pstack chooses its own playbook and work process. The host provides the saved card and poteto-mode instruction, neutral exact-model helpers and evidence retention. A passing machinery run must show actual saved-coder work, the pstack-authored checklist and decision log, then a review handed to a different model and refused by the connection core at $0. A fixed host coder/reviewer/cap-check sequence is forbidden. This review covers the dirty worker and driver changes relative to `605fbfd`, plus the unchanged evidence inspector caller contract.

## Spec

The continuation preserves the intended ownership. It sends the observed missing-evidence reason and asks the same pstack session to complete its selected playbook. It does not name a helper, specify helper order, or generate the checklist/decision log for the model. `adapter.run` reuses the supplied thread ID. The worker keeps both receipts and feedback prompts; the proof driver copies them. Existing failed-run-5 evidence reports `missing successful pstack coder task`; its raw events contain no helper starts, so rejection was supported.

The source remains insufficient by itself to establish substantive coder work. An executed counterexample gives a Beam task named `Implement the requested marker file` a successful result stating that the parent already implemented the file and no changes were needed. With no coder tool events at all, followed by a correctly ordered DeepSeek review refusal, `inspectPstackRun` accepts `hasCoder:true`. See `/tmp/pr316-feedback-counterexamples.json`. In a feedback run, this could be a retroactive nominal handoff after the parent already built the marker. A final passing proof must inspect the actual helper task and successful write/edit/command results and attribute the marker implementation to the saved coder, or strengthen the inspector against this demonstrated counterexample. A task label alone is inadequate.

The second executed scenario places the review refusal before coder completion. The inspector now rejects it with `missing distinct-model review handoff`, confirming the chronology repair.

Verdict is INCONCLUSIVE for overall acceptance. No fixed-workflow violation was found in the feedback change. The new real drive was still running when reviewed, so its substantive helper work, actual checklist/log contents, single-thread receipts and final browser evidence remain unverified.

## Standards

1. Unit tests: all three pstack-session tests pass. The added event-return and chronology assertions discriminate the earlier defects. They do not test the worker's new continuation path; the running real drive is necessary integration evidence.
2. Service/provider integration: source trace confirms the same thread ID is passed on continuation. Actual two-receipt single-thread execution is unverified pending the live run.
3. End-to-end: unverified. Earlier failures are correctly retained and not presented as acceptance evidence.
4. Browser console: unverified for the pending completed drive. The driver captures browser console, page errors and network failures for later review.
5. Logging: feedback prompts and complete receipts are written in the worker finally block and added to proof copies. Existing event/request/ledger retention remains. No credential content was observed in the inspected records.

Commands executed read the exact dirty diff, adapter.run implementation and failed-run-5 report/events; ran `node --test ops/build-runner/test/pstack-session.test.mjs` (3 pass); and executed both inspector scenarios against the actual imported module. No source, Git, tracker or service mutations were made.
