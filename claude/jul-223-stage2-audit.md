# JUL-223 stage two: off-the-shelf audit for Todd

The short answer is that Mastra should own the agent loop, validation of tool
inputs, step and time ceilings, and the delivery sequence. Small custom pieces
are still necessary where Julia's promises are stronger than Mastra's stock
ones: a call must be refused before it can overspend, accepted evidence must
survive a killed process, the exact provider exchange must be retained without
a database, and a review must be tied to an immutable commit. No paid call was
made.

| Piece | What it does | Ready-made choice checked | Verdict | Why |
| --- | --- | --- | --- | --- |
| Building the report | Builds a complete review from small, checked pieces and saves each accepted piece immediately. | Guided answers and automatic correction. | **stock plus a small custom part** | The ready-made checks help, but they save only the final answer; Julia must preserve each accepted piece through a crash. |
| Spending and time brake | Refuses the next paid request before it could exceed the review's money or time allowance. | Limits on turns, each request's duration, total time, length, and estimated cost. | **stock plus a small custom part** | Use the ready-made limits. Before sending, Julia must still check the worst-case price and duration of the next request against what remains. |
| Conversation record | Keeps one bounded copy of every question, reply, action, and usage count without risking the verdict. | Built-in activity records and completion notices. | **keep custom** | The supplied choices either keep everything in memory until the end or miss the original reply before checking; neither gives the required crash-safe record. |
| Delivery sequence and final states | Runs the review steps and ends exactly once as pass, fail, inconclusive, or system error. | Built-in step-by-step jobs, outcomes, retries, and recovery. | **stock plus a small custom part** | Use the ready-made sequence, but Julia must preserve the meaning of its four outcomes and protect an already-saved verdict. |
| Exact quotation check | Proves every quoted passage occurs word for word in the named, frozen source. | Guided answers and response checks. | **keep custom** | No ready-made choice finds the named frozen source and compares the quotation exactly. |
| Original reply capture | Saves the service's reply before any checking or cleanup can change it. | Connection and completion notices. | **stock plus a small custom part** | A ready-made connection notice exposes the reply, but Julia must save it in order and tie it to the right run and candidate. |
| Interruption evidence | Preserves accepted work and an explicit incomplete state after a crash or kill. | Built-in recovery records. | **keep custom** | The ready-made recovery record is made only at planned pauses and needs a separate store; it does not save every accepted piece immediately. |
| Price calculation | Turns validated usage counts into a conservative charge at the published rates. | Built-in usage and estimated-cost totals. | **keep custom** | Julia needs the service's time-banded prices and exact returned counts; the ready-made estimate is delayed. |
| Reading the candidate | Lets the reviewer inspect only the exact candidate, its difference, and named sources. | Built-in read-only working-area access. | **stock plus a small custom part** | The ready-made reader follows whatever is currently on disk; Julia must read the frozen candidate and reject escapes or writes. |
| Number of turns | Allows every required read, report item, correction, and submission without an arbitrary constant. | Built-in turn limit. | **stock plus a small custom part** | The ready-made limit enforces a number; Julia must calculate that number from the promised work. |
| Answer-length ceiling | Bounds the largest possible next charge. | Built-in answer-length limit. | **use stock** | Set the approved 4,096-unit ceiling through the ready-made setting and remove Julia's request rewriting. |
| Fixed rules and completeness | Supplies the standing rules and requires coverage of the candidate and acceptance criteria. | Built-in instructions and answer checks. | **stock plus a small custom part** | The ready-made parts carry and check the answer; Julia owns the rules, exact coverage, evidence meaning, and consistency. |
| Starting and authorizing | Accepts only the narrow review command and records Todd's permission and spending choice. | Built-in approval before an automated action. | **keep custom** | The review begins before the automated worker and must bind Todd's permission to this card, candidate, identities, and limits before any action starts. |
| Freezing the candidate | Resolves the requested change to one unchanging version and prepares an isolated reading area. | Built-in working areas. | **keep custom** | The ready-made area does not resolve a pull request, prove the exact version, or prepare a detached copy of it. |
| Required checks | Confirms the hosting service's required checks passed for that same candidate. | A purpose-made step inside the built-in sequence. | **stock plus a small custom part** | The sequence can place this step, but Julia must ask the hosting service and bind the answer to the frozen candidate. |
| Cleaning up | Removes the temporary reading area even after failure. | Built-in finish notices and error handling. | **keep custom** | Finish notices are allowed to fail without changing the result, so Julia must keep its guaranteed final cleanup of the exact temporary area. |
| Publishing once | Sends one final result to the right card or change and never duplicates it. | A purpose-made step inside the built-in sequence. | **stock plus a small custom part** | The sequence can place and retry the step; Julia must choose the destination, avoid duplicates, and preserve the saved result if publishing fails. |
| Safe run records | Writes verdict, progress, permission, and evidence without exposing a half-written replacement. | Built-in saved job and activity records. | **keep custom** | The ready-made choices need a separate store; Julia's local run record remains the authority and must survive interruption on its own. |

Mastra 1.75.0 is installed. The current stable release is 1.76.0. Its relevant
addition is stronger ownership fencing for durable-agent recovery, which is
useful only with supporting workflow and memory stores; it does not remove any
of the gaps above. Stage three should not upgrade as part of this work.
