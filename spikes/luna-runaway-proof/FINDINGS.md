# Luna runaway proof

The decision is whether stock Mastra can bound runaway agent spending before a paid model is enabled. The following limits were written before any run.

Each fixture has a 256 token output cap and at most three Lead steps and two helper steps per helper. For budgeting, reserve 1,000,000 input tokens at $0.20 per million and 256 output tokens at $0.50 per million per call, or $0.200128. This deliberately uses twice the normal input rate and a million input tokens, exceeding the 272,000-token short-context boundary used in the earlier proof. It assumes no retries. A solo run has a $0.600384 ceiling (3 calls). A delegated run with at most one helper per Lead step has a $1.801152 ceiling (3 Lead calls plus 6 helper calls). The latter is conditional on there being at most one helper invocation per Lead step; a model can potentially request multiple tool calls in one step, so it is not yet a demonstrated hard ceiling. The guard experiment uses the same delegated ceiling and a $0.00000001 guard threshold.

Correction during the experiment: the actual context window is 1,050,000 tokens, and the long-context output rate is $0.75 per million. The first budget understated the largest call. Using the conservative full window for input and the full output cap, one call is at most $0.210192 at those rates. Three calls are $0.630576; nine calls are $1.891728. See [OpenAI's Luna model page](https://developers.openai.com/api/docs/models/gpt-6-luna). The earlier figures remain above as the pre-run record; runs started before this correction cannot meet the requested pre-written ceiling condition and must be repeated.

Further conservative budget before any subsequent run: cache writes cost up to $0.25 per million above the long-context threshold. Reserving the entire 1,050,000 input tokens at that rate plus 256 output tokens at $0.75 gives $0.262692 per call. The solo ceiling is $0.788076 for 3 calls. The delegated conditional ceiling is $2.364228 for 9 calls. No evidence is claimed that the subscription provider actually bills cache writes, and these are Mastra estimates, not an invoice.

## Result

**The whole-run spending ceiling is not proven.** The three-helper run stayed below its written conditional ceiling, but the prompt's request for one helper at a time is not an enforced stock limit. A model step can request multiple tool calls. The experiment therefore does not establish that nine calls are the most this setup can make. Do not use this result to approve a paid model. The fixture also omits the build agent's actual instructions, workspace, exploration gate, and observational memory. It exercises the requested factory, stock subagents, step limits, and guard, but is not a complete reproduction of the planned build agent. Memory can make additional model calls, so its spending is not covered by these ceilings.

| Case | Result | Studio run | Recorded USD | Written ceiling |
| --- | --- | --- | ---: | ---: |
| One looping agent | **Pass in fixture.** Three calls, then persisted `limit / max_steps`. | `3745b1f8-e1d8-4471-a6a5-a8b49b60998b` | 0.0000990 | 0.788076 |
| Repeated fresh helpers | **Not proven as a hard whole-run ceiling.** Three helper runs each stopped after two calls. The Lead reached three calls and stopped, but the ceiling assumes one helper per Lead step. | `b24da9be-5ddb-4f4f-8aa3-dcacfe86b2cb` | 0.0005550 | 2.364228 conditional |
| Guard across agents | **Pass in fixture.** The completed helper spent $0.0000828. The guard then blocked the Lead, with a threshold of $0.00000001. | `5fdd4665-8640-4b85-a153-804c20ea832f` | 0.0001797 | 2.364228 conditional |
| Recorded totals | **Pass against the listed numerical amounts for these three runs.** A comparison with an assumed ceiling does not establish a hard ceiling. | All three above | 0.0008337 combined | See above |

The guard did not stop the helper mid-loop. It observed the completed helper after that helper reached its step limit. The final cost exceeded the guard threshold because the threshold is a tripwire, not a spending cap. Studio saved `blocked / guardrail` and the `token-cost-control` tripwire. The solo guard was set to $10 so that the step limit, rather than the guard, was the test. The repeated-helper guard was also $10; the guard case used $0.00000001. The artificial `again` tool only returns `continue`; it does not fix or intercept the agent.

## Recorded rows

These are the saved total-input and total-output metric rows, not a reconstruction of individual call prices. Each generation may contain multiple calls. The full sanitized rows, metric ids, helper run ids, inference span ids, and guard metadata are in [evidence.json](evidence.json). All 15 inference spans identify `gpt-6-luna`; the saved dollar rows identify provider `openai`. No model substitution was used.

| Case | Owner | Generation span | Input tokens | Input USD | Output tokens | Output USD |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| solo | Lead | `8df708a548ea869c` | 780 | 0.0000780 | 42 | 0.0000210 |
| helpers | helper 1 | `f4565526f58fda09` | 664 | 0.0000664 | 28 | 0.0000140 |
| helpers | helper 2 | `d0ea444c275bb580` | 664 | 0.0000664 | 46 | 0.0000230 |
| helpers | helper 3 | `7908028becdceaec` | 664 | 0.0000664 | 28 | 0.0000140 |
| helpers | Lead | `f8f81e6021704527` | 1608 | 0.0001608 | 288 | 0.0001440 |
| guard | helper | `8d32ee79fcbe5db3` | 688 | 0.0000688 | 28 | 0.0000140 |
| guard | Lead | `4cf3c2afd27f77d1` | 429 | 0.0000429 | 108 | 0.0000540 |

Mastra 1.82.0's installed price table lists $0.10 input, $0.50 output, $0.01 cache read and $0.125 cache write per million tokens, with a higher tier above 272,000 input tokens. The reservation above conservatively applies the higher rates to the whole context and assumes all input is cache write. Costs are recorded estimates under the existing ChatGPT subscription provider, not a credit-card invoice.

## Reproduce

Install the repository's locked dependencies in a disposable worktree with the existing subscription login, then run `node spikes/luna-runaway-proof/run.mjs run`. It starts Studio 1.38.0 on port 4198, sends real Luna requests, stops Studio, and exports the saved rows under the printed `.artifacts/flow` directory. Set `PROOF_PORT` to use a different port. Run `node spikes/luna-runaway-proof/run.mjs query <artifact-directory>` to re-read the saved rows without model calls. Raw traces and stream data may contain request contents and provider headers. Do not publish them without reviewing them. The script asserts core version, model identity, and presence of cost rows. Results still need human assessment against the conditions above because models need not follow the loop instructions.

An initial setup attempt produced solo run `75c9fe76-1cb3-4a6d-9b65-027c52bfcc62` and a helper HTTP 500 because the fixture supplied the helper factory in the wrong shape. A later three-run trial used the corrected fixture but preceded the final conservative budget above. Both attempts are excluded from the result table. The final three runs began after that budget was written.
