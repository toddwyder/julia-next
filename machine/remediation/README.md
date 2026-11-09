# The remediation machine

One program. It has a fresh Shipping agent review a pull request, and when that
review fails it hands the failure back to the session that built the change,
waits for the fix, and has another fresh Shipping agent review what came back.
Two failures in a row get a root cause instead of a third try.

```sh
node scripts/julia-agents.mjs -- node machine/remediation/run.mjs --pr 412 --card JUL-307
```

`--no-post` writes every determination, the card note and the stop into
`.artifacts/remediation/pr-<n>` instead of commenting, which is how the practice
runs are made. `--model` sets the Shipping model (default is GPT-6 Luna),
`--builder-model` the model a fresh builder or the investigation gets.
`--force` starts the loop again when the saved record says it already stopped.
`--card-file <path>` reads the card from JSON instead of Linear, for a machine
whose Linear key is gone. `--review-timeout-min <n>` sets how long one review may
run before it is ended (default 20).

## What happens, in order

1. `run.mjs` fetches `pull/<n>/head` into `~/.local/state/julia-scratch/remediation/pr-<n>/worktree`
   and reads `record.json` from the last attempt. Rounds that already posted are
   carried forward, so a crash between two reviews cannot post the first
   determination twice.
2. `workflow.mjs` builds the stock Mastra workflow `remediation`, one straight
   chain: `gather`, `review1`, `remediate`, `review2`, `investigate`, `finish`.
   Each step reads the record and returns it unchanged when it does not apply, so
   a first review that passes walks the chain without waking anybody.
3. `reviews.mjs` runs one review: a fresh Shipping agent, the card's criteria,
   the checkout, the commit under review, and the stock Shipping playbook. Its
   determination is posted on the pull request as `Shipping agent: … (review N of
   2)` and appended to the record.
4. `builder.mjs` hands a fail back. `findBuilderThread` reads the session store
   and takes the newest thread in this project whose title or whose own user
   turn names the card, then switches to it and sends the determination with the
   Bug fix playbook. The builder fixes, pushes, and stops before Shipping.
5. If no thread names the card, a fresh builder is started on the same pull
   request with the same determination, and the card gets a comment saying the
   session was missing.
6. A second fail starts one more session on the Investigation playbook, given
   both determinations and told to write down the fault in the work and the
   fault in the process, then `finish` records the stop with the pull request link and the root
   cause. (The stop ping that used to post it to Linear was removed on 7 Nov 2026.)

The review limit is one constant, `MAX_REVIEWS = 2` in `workflow.mjs`. A review
that has not answered after twenty minutes is ended by the clock in
`machine/shipping/workflow.mjs`, its harness is stopped, and the round is written
down as no verdict, which stops the loop instead of failing the card.

## One harness alive at a time

Mastra's observability database takes a process-wide lock, so the machine boots
one harness, stops it, and only then boots the next. A review harness gets its
own LibSQL store under the run folder; the builder harness opens the project's
own store, because that is where the thread that made the change lives. The
workflow's own state lives in a separate LibSQL store, so it survives a crash
without competing with either.

## Where the pieces come from

`machine/shipping` is reused rather than copied: the review prompt and retry
come from `shipping/workflow.mjs`, the criteria parser, verdict parser and
comment renderer from `shipping/determination.mjs`, and the checkout, trace
file, record guard and comment poster from `shipping/run-parts.mjs`. A
determination looks the same on both machines.

**A failing review is a result, not a fault.** The loop only refuses to start
when there is no card or the card names no criteria.

The workflow modules come from the installed Mastra Code program, the same way
Shipping's do, so `workflow.test.mjs` needs that program as well. It runs on the
server; a runner without the program reports those rounds as skipped and names
the packages that are missing.
