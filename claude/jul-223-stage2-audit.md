# JUL-223 stage two: off-the-shelf audit for Todd

The short answer is that Mastra should own the agent loop, validation of tool
inputs, step and time ceilings, and the delivery sequence. Small custom pieces
are still necessary where Julia's promises are stronger than Mastra's stock
ones: a call must be refused before it can overspend, accepted evidence must
survive a killed process, the exact provider exchange must be retained without
a database, and a review must be tied to an immutable commit. No paid call was
made.

| Piece | What it does | Stock option checked | Verdict | Why |
| --- | --- | --- | --- | --- |
| Report recording and shaping | Builds a complete review from small, checked pieces and saves each accepted piece immediately. | Built-in shaped answers, response filters, and validated tool inputs with correction. | **stock plus a small custom part** | Stock validation and correction work, including with tools, but stock final-answer shaping does not save each accepted piece before the next call or survive a killed process. |
| Spending and time gate | Stops a request before the next model call could exceed the review's money or time allowance. | Built-in call-count, token, time, and cost controls. | **stock plus a small custom part** | Use the built-in call-count and hard timer; the stock cost guard is approximate, database-backed, can fail open, and does not reserve the pending request, so a small file-backed reservation ledger is still required. |
| Model log | Keeps one bounded copy of every prompt, reply, tool call, and usage record without risking the verdict. | Built-in tracing, exporters, and completion callbacks. | **keep custom** | Stock tracing has no incremental durable file exporter, while callbacks do not expose the required pre-parse exchange in this mode; the prior database route also duplicated growing conversations. |
| Delivery sequence and final states | Runs the review steps and ends exactly once as pass, fail, inconclusive, or system error. | Built-in workflows, step results, errors, pausing, resuming, and recovery snapshots. | **stock plus a small custom part** | Workflows should run the sequence, but Julia must map workflow outcomes to its four meanings and keep authorization, immutable-candidate checks, publication, and process timeout in the outer runner. |
| Exact quotation check | Proves every quoted passage occurs word for word in the named immutable source. | Built-in answer schemas and response filters. | **keep custom** | No stock feature resolves a named source at a pinned commit and performs this byte-for-byte evidence check. |
| Raw reply capture | Saves the provider reply before any parser can reject or normalize it. | The connection's request hook and metadata hook. | **stock plus a small custom part** | The hooks expose the boundary, but Julia must perform the ordered atomic file write and attach run and candidate identity. |
| Interruption evidence | Preserves accepted work and an explicit incomplete state after a crash or kill. | Workflow recovery snapshots. | **keep custom** | Stock snapshots are database records made at workflow suspension points; they do not replace immediate run-file writes after each accepted report piece. |
| Price calculation | Turns validated token counts into a conservative charge at the published model rates. | Built-in usage and cost tracking. | **keep custom** | The stock guard uses delayed trace estimates; Julia needs the provider's current peak/off-peak rates and validated raw counts for the hard ledger. |
| Read-only repository access | Lets the reviewer inspect only the exact candidate, its difference, and named files. | Built-in read-only workspace tools. | **stock plus a small custom part** | Use stock tool schemas, but ordinary file reads follow a mutable checkout and cannot read a named Git object or the exact candidate difference. |
| Call ceiling | Gives every required read, report item, correction, and submission enough room without an arbitrary constant. | Built-in maximum-step setting. | **stock plus a small custom part** | Stock enforces a supplied number but cannot derive it from the immutable file and acceptance-criterion inventory. |
| Fixed rules and review contract | Supplies the standing rules and demands complete coverage of the candidate and acceptance criteria. | Built-in instructions and shaped answers. | **stock plus a small custom part** | Stock carries and validates the shape; Julia's rules, exact-set checks, verdict consistency, and evidence meaning are domain policy. |
| Atomic run files | Writes verdict, progress, and evidence without exposing a partial replacement. | Workflow storage and tracing storage. | **keep custom** | The stock persistence options are databases; Julia's run files are the execution record and must remain independent of telemetry storage. |

Mastra 1.75.0 is installed. The current stable release is 1.76.0. Its relevant
addition is stronger ownership fencing for durable-agent recovery, which is
useful only with supporting workflow and memory stores; it does not remove any
of the gaps above. Stage three should not upgrade as part of this work.
