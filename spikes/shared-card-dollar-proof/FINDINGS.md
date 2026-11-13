# Shared card dollar proof

The test values subscription usage at API prices. No paid API key or Linear credential is used. Run ceilings below are written before the corresponding runs. A ceiling reserves the card limit plus three maximum calls, one for the lead and two concurrent helpers. This over-reserves the solo case.

The conservative maximum for Luna is $0.3585 per call: 1,050,000 input tokens at the long-context cache-write rate of $0.25 per million, plus 128,000 output tokens at the long-context $0.75 per million. For Haiku it is $1.32: 1,000,000 input tokens at the long-context one-hour cache-write rate of $1 per million plus 128,000 output tokens at $2.50 per million. These bounds conservatively count both maximum input and maximum output even if they share a context window. Prices and limits are from the [Luna model page](https://developers.openai.com/api/docs/models/gpt-6-luna) and [Haiku model page](https://platform.claude.com/docs/en/models/haiku-5-5/overview), accessed 2026-11-13. The fixture does not enable premium service tiers.

The initial card limit for every case is $0.002. The initial pre-run ceilings are $1.0775 for Luna and $3.962 for Haiku, including three maximum calls. These are upper bounds, not expected charges.

The first Luna helper attempt, run `e462c693-43c5-4321-aec3-4535c2c12776`, ended voluntarily after five calls and $0.00162070, below the limit. It does not test the stop. The next fixture requires a tool call using Mastra’s stock `toolChoice` setting. The same pre-run ceilings and limit above apply to the repeat and to each remaining case.

The first Haiku helper attempt, run `2a68b443-4505-4772-97f5-cf13d33dd25c`, crossed $0.002 after only two calls. The lead was then blocked before it could start another helper. It does not meet the multi-call helper test. Before the repeat, its card limit is raised to $0.0032 and its ceiling is $3.9632, using the same three-call reservation above.

The second Haiku helper attempt, run `e3832e50-22f4-4214-96af-9e40d351d4b3`, counted ten calls, including five helper final answers, and blocked the lead after the fifth helper crossed the limit. It did not exercise a helper blocked on its first call. Before the next attempt the Haiku helper limit is $0.003 and the ceiling is $3.963.

The initial fixtures created separate instances of the same processor for input and output, sharing the same ledger. Before subsequent runs the fixture uses one processor instance per agent for both hooks, as requested. The original per-run ceilings still apply unless changed above.

The first Haiku parallel attempt, run `94d86c15-0905-4de1-9f62-39a214bdf36c`, crossed $0.002 in its first lead call, so it does not meet the several-call requirement. Before repeating it, the Haiku parallel limit is $0.003 and its ceiling is $3.963.

The price calculation now distinguishes five-minute and one-hour cache writes. All Claude writes observed so far were one-hour writes. The missing-price case removes the selected model from the local price table without selecting another model. The same pre-run ceilings apply to repeats with this correction.

## Results

The passing rows below use the corrected one-processor setup. The calls column counts completed model responses. The missing-price case has no model response by design. Each JSON file retains the per-call rows, the shared total, the saved Studio metrics, and span records.

| Model | Case | Result | Studio run ID | Calls | Total USD | Ceiling USD |
| --- | --- | --- | --- | ---: | ---: | ---: |
| Luna | Lead alone | Pass | `a2dad3de-c9b1-454f-91cf-edd7c221685b` | 8 | 0.002144 | 1.0775 |
| Luna | New helpers | Pass | `9a6680bc-00e1-46d8-826c-a0bc201efd99` | 13 | 0.00246826 | 1.0775 |
| Luna | Six helpers in one step | Pass | `12f51059-4923-4e4a-8ac3-5e4041c5540d` | 15 | 0.0030835 | 1.0775 |
| Luna | Missing price | Pass | `f2628003-32a0-4ed0-8df9-7348bfa91d46` | 0 | 0 | 1.0775 |
| Haiku | Lead alone | Pass | `fbf96776-9f9f-4b89-be39-7738a9f78a9f` | 11 | 0.00206383 | 3.962 |
| Haiku | New helpers | Pass | `586ed419-817e-4fa7-86ae-4b156562ba63` | 9 | 0.00303266 | 3.963 |
| Haiku | Six helpers in one step | Pass | `2428f790-2229-4868-80d0-c2cf1d282dfa` | 8 | 0.00331024 | 3.963 |
| Haiku | Missing price | Pass | `22a1fd34-53e2-4da7-a924-594cd8d5b4a6` | 0 | 0 | 3.962 |

In the helper runs, the output hook counted each helper's final answer. After a lead response crossed the limit, the next helper's input hook blocked its first model call. In each parallel run, the lead requested six helpers in one step. The ledger shows the first two helper inputs before either finished, and the third helper input only after one finished. The saved token rows reconcile with the ledger for each completed run, including the setup attempts. The ceilings are deliberately much larger than the observed totals because they use each model's largest possible call rather than the small calls in these fixtures.

## Method and reproduction

Each command starts a disposable Studio server with one test lead and its helpers, sends one agent request to that Studio server, saves the stream and Studio trace, then stops the server. These are real Studio agent runs using subscription connections. They are not full `card-path` workflow runs. Each process owns one ledger, so these fixtures do not test two independent card runs in the same server process.

Install the locked dependencies in an isolated worktree. Sign in to the two subscription providers. No Julia secrets wrapper is needed or used. Run one fixture at a time, for example:

```sh
node spikes/shared-card-dollar-proof/run.mjs openai solo
node spikes/shared-card-dollar-proof/run.mjs claude helpers
```

Use `openai` or `claude` and `solo`, `helpers`, `parallel`, or `unpriced`. The unpriced case removes the chosen model from the fixture's price table. It does not select or call another model. Studio prints the run ID and artifact directory. Set `PROOF_PORT` if necessary. Raw streams and databases can contain sensitive information and should not be published without review.

To extract safe token and span evidence and reconcile it:

```sh
node spikes/shared-card-dollar-proof/report.mjs <artifact-directory> <output.json>
node spikes/shared-card-dollar-proof/check.mjs <output.json>
```

The committed JSON files contain the per-call input, output, cache read and cache write counts, the ledger after each hook, and Studio's saved token metrics and relevant span records. The checker recalculates cost from the call rows, compares it with both the shared total and Studio's token cost rows, and checks the recorded ceiling. The actual observed Claude cache writes in this experiment are one-hour writes. These runs do not establish behavior when a provider omits usage, or when a request fails after incurring cost without producing a completed response. The model calls use standard service; the ceiling does not cover premium pricing or paid tools.
