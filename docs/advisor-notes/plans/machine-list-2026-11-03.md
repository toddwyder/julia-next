# The machine list, 3 November 2026

Todd's priority order (3 Nov, 07:40): get the machine working, get visibility into what it is doing, fix the metrics, so cards process reliably. Everything else waits behind these three.

Source: the overnight investigation report (3 Nov), the evidence report on the first slice, and Todd's Linear inbox. "Measured" items come from agent reports; I have not seen the records myself.

## 1. The machine works
- Nothing starts a Ready card. A person launches it. The machine needs an owner for its queue. Open.
- The reviewer accepted stand-in tests as proof for the first slice. The review must require proof on the real thing. Open. Not in the spec.
- A long review ended with no verdict on 3 Nov at 07:01 because of a model error: the model wants the reasoning of every earlier message sent back. A new cause, not in the investigation. Open. Unknown whether the higher step limit makes it more likely.
- The step limit is raised and landed on main. Done. Its effect on the full 25-criterion card is unproven.
- The machine breaks on its launcher's colour setting. Launch environment must be set by the machine. Open.
- Slice cards use "Done means:" and the parser reads "Acceptance criteria". A fix is open as a pull request, not landed. Open, held.
- A diagnosed machine defect is not turned into work. Every diagnosed defect should become a failing test or a filed card. Open. This is the one that cost the six hours.
- A card-file workaround, the waiting job and the old checklist viewer are leftovers to remove. Open.

## 2. Visibility
- The run page is built in the first slice, under review. It has never been loaded or served. Under review.
- The dashboard has not deployed since 31 October. The updater rejects a run record with status "stopped" that the machine itself wrote. The writer and the reader disagree. Open. Until fixed the page cannot be opened anywhere.
- A stage in flight looks the same as a dead machine, because state is written only when a stage ends. Open. Covered by the spec.
- The stall watcher is not installed and points at a file missing on the server. Open. Covered by the spec.

## 3. Metrics
- The scorecard is not produced from the run alone. Open. Covered by the spec.
- Agent records are not tied to the run's trace tree, and the thread identifier is missing. Open. Covered by the spec.
- Step records do not carry the card. Open. Sent back to the builder.
- Cost per stage on the page. Built, not observed on a real run.

## Later (behind the three priorities)
- Notifications. Todd's stated goal (3 Nov, 07:36): native Windows and Android notifications, the way Claude's own work notifies him, in place of Linear. Todd stated the goal only. Nothing below is decided; each is Claude's proposal for Todd to accept or change:
  - Linear stays as a silent record: machine comments mention nobody and set no reminders.
  - Only a product call, an acceptance check or an account-owner approval notifies him. Machine stops, stalls and completions show on the run page and in one morning summary.
  - The mechanism: two free routes to check on his actual devices (a push service such as ntfy, or notifications from the dashboard page).
  - Spec criteria for this are drafted, not applied.
  Todd's earlier standing principle: alerts must be rare and tied to something irreversible.
- The Linear inbox holds 41 unread items, mostly machine comments and 11 automatic reminders. Clearing them and ending the automatic reminders comes with the notification change.
- The ping fails with an authentication error from a stale dashboard copy. Folds into the notification change.
- Firebase advisories, the Next.js update, and the Renovate setup (Todd chose to build Renovate on 2 Nov). Behind the three priorities.
- Mastra loose ends: upstream report for the retry behavior, two old interactive sessions still on the old version.
