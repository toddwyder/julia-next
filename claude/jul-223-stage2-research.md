# JUL-223 stage-two stock-feature audit

Research date: 12 October 2026. This is an audit, not an implementation plan or
authorization to make a provider call. No paid call was made.

## Bottom line for Todd

| Piece | What it does | Stock option checked | Verdict | Why |
| --- | --- | --- | --- | --- |
| Incremental report recording | Saves a long review safely in small checked pieces and assembles the final decision | Structured output, tool schemas, and output processors | **Stock plus a small custom part** | Keep stock tool schemas and the stock correction loop, but stock structured output is only a final object and does not durably save accepted pieces or run the repository-specific checks. |
| Final report shape | Produces the exact decision and evidence packet the runner accepts | Structured output | **Keep custom** | The shape, exact inventory, evidence rules, and decision mapping are Julia's contract; a generic schema validates shape but does not supply those rules. |
| Pre-call spending and time brake | Refuses the next paid request before it can exceed the review's limits | Step caps, token limiting, stock timeouts, and stock cost control | **Stock plus a small custom part** | Use stock step and time limits, but keep the reservation ledger: stock cost control is approximate, database-backed, delayed, and can fail open. |
| Model-event log | Keeps every provider prompt, response, tool call, and usage record once without jeopardizing the decision | Mastra observability, file-capable test exporter, provider hooks, and finish callbacks | **Keep custom** | Stock spans can expose the data, but the supplied file exporter buffers in memory and writes only when explicitly asked; it is not the durable provider-boundary journal required here. |
| Review orchestration | Runs the review and gives every started run one of four terminal outcomes | Mastra workflows, result statuses, callbacks, suspension, and snapshots | **Stock plus a small custom part** | JUL-196 should use workflows for sequencing, step results, retries, and lifecycle callbacks. Julia must still map workflow outcomes to its four states and atomically protect an already-saved verdict. |
| Pausing and recovery | Recovers interrupted orchestration | Workflow suspension, resumption, and snapshots | **Keep custom for this reviewer** | Durable stock suspension requires configured database storage, while this route says run files own state and has no human-in-the-loop pause. JUL-196 may use ordinary workflow execution without making snapshots the evidence authority. |
| Exact quote check | Proves every quoted fragment occurs word for word in the immutable source | Tool schemas, output processors, and regex filtering | **Keep custom** | No stock feature resolves a named Git source at a pinned commit and checks an exact substring there. |
| Raw answer before parsing | Saves the provider bytes before Mastra or a schema can reject them | Traces, finish callbacks, and the OpenAI-compatible provider's fetch/metadata hooks | **Stock plus a small custom part** | Use the stock custom-fetch seam, but the atomic write-before-parse behavior and response/run identity are custom requirements. |
| Interruption evidence | Preserves accepted work and an incomplete technical-failure record after process death | Workflow snapshots and callbacks | **Keep custom** | Callbacks cannot run after an uncatchable kill, and durable snapshots require database storage; immediate atomic run-file writes are still needed. |
| Price calculation | Converts validated provider usage into a conservative charge | Stock cost metrics and usage totals | **Keep custom** | Mastra does not contain Command Code's time-banded prices, and its stock cost threshold is explicitly approximate. |
| Read-only repository access | Lets the reviewer inspect only the pinned candidate | Stock tools and tool hooks | **Stock plus a small custom part** | `createTool` supplies schemas and execution plumbing; immutable Git commands, path rules, commit pinning, and the no-write policy remain application logic. |
| Step allowance | Gives the reviewer enough model turns for every required piece plus correction attempts | `maxSteps` and stop controls | **Stock plus a small custom part** | Use stock `maxSteps` to enforce the result, but retain the domain formula that derives the number from files, criteria, and mandatory report sections. |
| Output-token ceiling | Bounds the pending request so its maximum price can be reserved before dispatch | Built-in generation output limit | **Use stock** | Stage three should configure the approved 4,096-token ceiling through Mastra and delete request-body cap scrubbing. |
| Fixed rules, configuration, and exact-file check | Applies the standing policy, selected connection/model, and exact candidate inventory | Agent instructions and request context | **Stock plus a small custom part** | Put fixed text in stock agent instructions, but Julia's authorization/configuration mapping and exact-set comparison remain custom policy. |

## Version finding

The installed reviewer declares `@mastra/core: ^1.75.0` and currently resolves
to **1.75.0**. Its bundled documentation identifies itself as 1.75.0 in
[`dist/docs/SKILL.md`](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/SKILL.md).
On 12 October 2026 the npm registry's stable `latest` tag was **1.76.0**
([npm package](https://www.npmjs.com/package/@mastra/core/v/1.76.0)); 1.77 had
only prereleases. A downloaded 1.76.0 package was compared with the installed
docs for every page cited below. The relevant structured-output, token limiter,
cost-control, workflow error/suspend/snapshot, and console-exporter pages were
unchanged. The pertinent 1.76 changes were client-tool documentation, an
additional default unsupported-file error processor, sampler typing, and
workflow recovery concurrency. None changes a verdict here. Do not upgrade in
this stage.

`@mastra/observability` 1.18.4 and `@ai-sdk/openai-compatible` 2.0.81 are
physically present, but `npm explain` reports the observability package as
extraneous and the reviewer does not declare it. Stage three must not treat an
unlocked leftover installation as an owned dependency.

## Technical findings

### 1. Recording engine and report adapter

Mastra 1.75 supports validated `response.object`, tool-enabled structured
output, native `response_format`, prompt-injected JSON, a separate structuring
model, and a `prepareStep` split when a provider cannot combine tools and
structured output. The docs explicitly say provider support varies and that a
separate structuring model makes a second paid call. See the installed
[structured-output guide](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-agents-structured-output.md)
and [generate reference](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-agents-generate.md).

The committed offline stand-in in
[`audit/jul-223-stage2-stock.test.mjs`](../ops/mastra-agents/reviewer/audit/jul-223-stage2-stock.test.mjs)
uses the installed real `Agent.generate()` and `createOpenAICompatible()`. It
makes a tool call on step one and returns a schema-validated object on step two.
Because native structured output is deliberately disabled, both requests keep
the tool schema, omit `response_format`, and carry Mastra's inline JSON
instructions. This proves the documented fallback combines the tool loop with
final structured validation. It does **not** prove that Command Code's current
DeepSeek endpoint accepts native `response_format` together with tools.
Command Code says its endpoint follows the OpenAI Chat Completions schema and
supports client tool arrays, but its provider page does not make a
model-specific structured-output promise
([Command Code Provider API](https://commandcode.ai/docs/provider)). Resolve
that ambiguity only in the later authorized, model-specific opt-in probe; it
cannot be settled by a free offline server.

Even if that probe succeeds, structured output does not replace the recorder.
It validates a final object after generation. The requirement here is to fsync
each accepted piece, retain it across a kill, allow replace/remove/show-missing,
verify evidence against immutable sources, assemble deterministically, and
call the existing `checkedReview` boundary. Output processors can inspect the
final result and token/tool data and can request a retry, but their documented
state lasts only for one `generate()`/`stream()` request and is not durable.
See [processors, “Transform output messages”, “Validate each response”, and
“Persist data across chunks and steps”](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-agents-processors.md).

The existing use of stock tool schemas is correct. Mastra validates
`inputSchema`; a malformed call becomes a tool error visible to the model. If
an `outputSchema` fails, Mastra returns a validation error object that the
model may retry. See [tools, “Define schemas” and “Handle output validation
failures”](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-agents-tools.md).
The repository's existing offline `recorded-review.test.mjs` already proves
the real loop repairs malformed JSON, rejected schema values, bad quotes, and
early submission.

**Verdict:** retain the custom durable engine and Julia report adapter; keep
using stock `createTool` schemas and the stock tool-error loop. Structured
output may be added as a redundant final validation only after the
model-specific probe, but it is not a deletion justification and a separate
structuring model would violate the minimum-call design.

### 2. Pre-call cost and time limit

Stock `maxSteps` caps sequential LLM calls (default five); it does not estimate
the next call's tokens, dollars, or elapsed duration. A final-step tool call can
also leave an empty response, which Mastra documents as requiring a processor
reminder if a final prose response matters. See [generate, “Using maxSteps”](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-agents-generate.md)
and [processors, “Ensure a final response with maxSteps”](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-agents-processors.md).

`TokenLimiterProcessor` enforces a prompt size immediately before each call,
or limits output after generation. Its normal input behavior trims messages;
it throws only if no valid prompt remains. Its output behavior truncates or
aborts generated content after the paid request. It is a context/output guard,
not a cumulative pre-call spending ledger. See the installed
[TokenLimiterProcessor reference](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-processors-token-limiter-processor.md).

`TokenCostControl` checks before each call, but the same page states that it
queries observability storage, receives asynchronously persisted metrics, may
allow fast agents to exceed the limit, and fails open on query errors. All
scopes require observability storage with `getMetricAggregate`. That directly
fails the exact requirement. See the installed
[TokenCostControl reference](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-processors-token-cost-control.md),
especially “Approximate cost control”, constructor/scoping behavior, and the
metric-persistence-delay note.

Mastra accepts an `AbortSignal`, which is useful once a deadline fires, but it
cannot predict that the next provider call would finish after the deadline.
See [generate, `abortSignal`](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-agents-generate.md).

**Verdict:** stock plus a small custom part. Use stock `maxSteps` and
`modelSettings.timeout.totalMs` as independent loop and time bounds, with the
runner's process timeout as the ultimate elapsed-time stop. Keep a custom,
durable per-run ledger and conservative next-call reservation check. The custom
`reviewStepBudget` formula stays because Mastra only consumes the numeric
answer. `TokenCostControl` and database metrics stay out.

### 3. Model log

Mastra observability can disable internal spans, exclude span types, filter
spans, and bound serialized strings, depth, arrays, and object keys. See
[observability configuration](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-observability-tracing-configuration.md)
and [span filtering](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-observability-tracing-span-filtering.md).
The stock `ConsoleExporter` writes formatted events to a logger, not a run file
([ConsoleExporter](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-observability-tracing-exporters-console-exporter.md)).
The installed observability package also exports `TestExporter` (deprecated
alias `JsonExporter`), whose first-party type documentation says it collects
all events **in memory** and offers an explicit `writeToFile()` snapshot. It is
described as primarily for testing/debugging, not an incremental durable file
sink: [`@mastra/observability` TestExporter declaration](../ops/mastra-agents/reviewer/node_modules/@mastra/observability/dist/exporters/test.d.ts).

An offline two-call tool run with internal spans disabled produced one agent
span, one generation span, two model-step spans, two model-inference spans,
three model-chunk spans, and one tool-call span (37,870 JSON bytes). The model
inference spans carried replies/tool calls and usage; the tool span carried
arguments and result. This proves stock tracing has the data, but also proves
that `includeInternalSpans: false` does not mean “model-level only”; explicit
filtering is required. It does not make the in-memory exporter crash-durable.

The observability event bus catches synchronous and asynchronous exporter
errors so one failing handler does not break other handlers; this is visible in
the installed first-party implementation at
[`@mastra/observability/dist/index.js`](../ops/mastra-agents/reviewer/node_modules/@mastra/observability/dist/index.js).
That protects agent execution, but an explicit end-of-run `writeToFile()` can
still happen too late to preserve evidence from a killed process.

`onStepFinish` exposes text, tool calls/results, finish reason, and usage, but
the generate reference says it is only available without structured output.
`onFinish` receives the completed aggregate, so neither is a raw
response-before-parse hook. The installed OpenAI-compatible provider instead
documents a custom `fetch` middleware and `metadataExtractor` for
provider-specific response data in
[`@ai-sdk/openai-compatible` declarations](../ops/mastra-agents/reviewer/node_modules/@ai-sdk/openai-compatible/dist/index.d.ts).

**Verdict:** keep the provider-boundary journal custom, built on the stock
custom-fetch/metadata seams. Append/atomically publish each bounded request,
raw reply, parsed tool call, and validated usage exactly once. Do not restore a
storage exporter. Observability can remain an optional diagnostic later, but
it is not the authoritative model log.

### 4. Runner and four terminal states

Workflow results are a discriminated union with `success`, `failed`,
`suspended`, `tripwire`, and `paused`, and always expose step results. Workflow
`onFinish` runs for any status, `onError` for failure/tripwire, and callback
errors are caught and logged without changing the workflow result. See
[workflow overview, “Workflow result type”](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-workflows-overview.md)
and [workflow error handling](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-workflows-error-handling.md).
These are good stock primitives for JUL-196.

They do not supply Julia's terminal vocabulary. `PASS`, `FAIL`, and
`INCONCLUSIVE` are three valid model submissions inside a successful workflow;
`SYSTEM_ERROR` is the mapping for workflow failure, tripwire, timeout/process
death, or success without a validated report. That mapping, atomic run-file
terminal record, and “a later logging failure cannot replace a verdict” rule
remain custom.

Suspension automatically snapshots complete workflow state and resume restores
it. The same docs explicitly say snapshots persist in configured storage and
the snapshot guide describes the database `workflow_snapshots` table. See
[suspend and resume](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-workflows-suspend-and-resume.md)
and [snapshots](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-workflows-snapshots.md).
That conflicts with “run files own execution state” if used as the reviewer's
authority, and this reviewer has no human-in-the-loop pause.

**JUL-196 boundary:** use stock workflows for deterministic sequencing,
validated step inputs/outputs, retry policy, result inspection, and lifecycle
callbacks. Retain custom authorization, immutable candidate identity,
process containment/timeout, run-file recovery, terminal-state mapping,
checked-review publication, and atomic verdict precedence. Do not adopt
database snapshots merely to replace existing run files.

### 5. Smaller pieces and remaining custom code

- **Word-for-word quote checking — keep custom.** Stock processors transform or
  validate model messages; none opens a named source from a pinned Git commit
  and performs the exact substring check. `RegexFilter` is a message-content
  filter, not a source-of-truth verifier (processor catalogue in the installed
  [processors guide](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-agents-processors.md)).
- **Raw answer and interruption evidence — keep custom on stock seams.** The
  fetch middleware is the earliest stock interception point. Atomic local
  persistence, run/commit identity, accepted-piece sidecar, and kill survival
  remain custom. Workflow callbacks and end-of-run exporters cannot prove the
  same ordering.
- **Cost arithmetic — keep custom.** Command Code's official pricing page
  publishes time-banded DeepSeek V4.1 Flash input/output/cache rates
  ([Pricing & Limits](https://commandcode.ai/docs/resources/pricing-limits));
  Mastra has no Command Code tariff calculator. Continue failing closed on
  missing/invalid provider usage. Recheck rates immediately before stage-three
  implementation because prices are external and time-varying.
- **Read-only Git tools — stock plus custom.** `createTool` and its input schemas
  stay stock; the exact `git diff/show` commands, path rejection, candidate
  commit pin, buffer choice, and no-write surface stay custom. Tool hooks are
  useful for audit logging but do not confer read-only behavior; see
  [tools, “Run logic around tool calls”](../ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/docs-agents-tools.md).
- **Derived `maxSteps` — stock plus custom.** Keep the formula; pass its output
  to stock `maxSteps`. A processor can disable tool choice on the last step,
  but cannot infer Julia's required report units.
- **Exact changed-file inventory and checked-review adapter — keep custom.** A
  schema can constrain members and length, but Julia must compare the immutable
  set, reject duplicates/unexpected files, and preserve the runner envelope.
- **Fixed instructions — use stock configuration with small custom policy.**
  `Agent.instructions` is the stock home for the six rules. Their text and the
  model/connection authorization mapping remain repository policy.
- **Output cap scrubber — delete.** The generate API has the stock
  `modelSettings.maxOutputTokens` option. Stage three should configure the
  approved 4,096-token ceiling there so the pending call's maximum price is
  actually bounded. Delete `requestWithoutOutputCap()` and the request-body
  rewrite in `checkedFetch`; retain `checkedFetch` only for the bounded provider
  journal and raw usage capture.
- **Durable write helper — keep custom or centralize.** Mastra's stock file
  exporter does not provide the write/fsync/atomic-rename contract needed by
  verdicts, accepted pieces, and raw answers. Stage three may consolidate the
  duplicate helper into one module, but should not weaken its behavior.

## Stage-three deletion and replacement list

No whole current reviewer source file is justified for deletion by the stock
audit. In particular, do **not** delete `recording-engine.mjs`,
`reviewer-report.mjs`, `quote-check.mjs`, or `commandcode-cost.mjs`.

Delete only the custom output-cap scrubber:

1. Remove `requestWithoutOutputCap()` from `contract.mjs` and its focused
   assertions.
2. Remove the `init.body` rewrite that calls it from `checkedFetch()`.
3. Replace it with stock `modelSettings.maxOutputTokens: 4096`; do not inject
   legacy provider-body `max_tokens` or `max_completion_tokens` fields.

Adopt/configure these stock parts in stage three:

1. Keep `createTool` input schemas and Mastra's tool-error-to-model correction
   loop for report pieces and read tools.
2. Pass the retained custom formula to stock `maxSteps`; optionally use the
   documented last-step reminder/`toolChoice: 'none'` pattern, provided it does
   not turn an incomplete report into a verdict.
3. Keep using the OpenAI-compatible provider's custom `fetch` and metadata
   seams, but make the custom journal bounded and durable per response.
4. Leave workflow adoption to JUL-196. There, replace custom sequencing with a
   Mastra workflow, not the four-state/domain mapping or run-file authority.

## Ambiguities that still require offline or later authorized probes

1. **Command Code + DeepSeek structured output with tools.** The installed
   route works against an offline compliant endpoint, and the provider claims
   OpenAI Chat Completions compatibility, but no primary model-specific page
   found promises `response_format` plus tools. Only the later authorized
   model-specific opt-in call can settle this. It is not required to retain the
   recorder.
2. **Filtered observability payload size.** If JUL-196 later wants optional
   tracing, run a free offline worst-case fixture with only the proposed span
   types and measure incremental bytes. Do not infer bounded total size from
   per-field serialization limits.
3. **Workflow operation without durable snapshots.** Before JUL-196 commits to
   workflows, prove on the laptop that the selected workflow configuration
   neither creates an unwanted fallback database nor competes with run-file
   recovery. The offline observability probe printed a warning that a Mastra
   instance without configured storage falls back to an in-memory store; that
   is another reason to make storage behavior explicit.
4. **Current Command Code rates.** The 11 October constants match the official
   page observed during this audit, but pricing can change independently of
   code. Stage three must fetch/check the official page and update the dated
   tariff fixture before enabling paid execution.
