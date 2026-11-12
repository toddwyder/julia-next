# Per-agent dollar stop proof

Todd needs evidence that each runaway agent stops on its own dollar limit before funding a paid model. These are disposable Studio fixtures, not a change to the machine.

## Budget written before runs

Each agent limit is $0.00000001. The run-wide TokenCostControl limit is $10 except in the guard case, where it is $0.00000001. Each ordinary case reserves $10 for one model call, so each agent's ceiling is $10.00000001. The multiple-helper case reserves $10.00000001 for the lead and each of three helpers, or $40.00000004. The guard case uses the same $40.00000004 reservation. These intentionally generous reservations cover up to one million input and one million output tokens at $5 per million each. This is an assumption about the largest call, not a limit imposed by this fixture. Model context and output bounds must be checked before treating it as a hard ceiling. Retries and additional helpers would also invalidate the reservation.

The CommandCode fixture uses a free model and a hypothetical $1 input and $5 output per million tokens for its per-agent condition. The resulting number is simulated, not spending. Subscription usage is valued at API prices.

Results pending.

Before subsequent runs, the guard fixture's lead limit is $10 so its own condition does not end the run before TokenCostControl gets another chance to inspect completed helper costs. Its guard-case ceiling is therefore $50.00000003 for one lead and three helpers, including four $10 call reservations. The initial OpenAI guard run used the earlier lead limit and is retained as a failed setup observation.

The $10 per-call reservation does not cover 1,100,000 input and 1,100,000 output tokens at $5 per million each, totaling $11. That assumption was too low. For runs after this correction, reserve $12 per call instead. The ordinary per-agent ceiling is $12.00000001, the three-helper run ceiling is $48.00000004, and the guard run ceiling is $58.00000003. Earlier runs retain their original pre-written $10 reservation and cannot use this correction retroactively.

The first Claude fixture used the five-minute cache-write price, but its saved metrics price writes at the one-hour rate. Its condition underestimated those writes. Those runs do not prove the requested condition even where they stopped. Before repeating Claude, the fixture uses the one-hour API rate. The first CommandCode attempt omitted the gateway's `CMD_API_KEY` and produced authentication errors, not a model verdict. Later runs supply the key without requesting a Linear token.

## Results

**The requested proof failed on CommandCode. Do not use this experiment to approve paid models.** The free model did not call a helper in the single-helper or three-helper cases. In the guard case, the lead started 43 helper runs and finished without a guardrail stop. The saved token rows have no dollar estimate for this model, so they cannot show the real run cost crossing the guard threshold. The model is named `thinkingmachines/inkling-2-small:free` in the live CommandCode catalogue. The catalogue did not supply a price field. Its per-agent price below is hypothetical.

The OpenAI and Claude fixtures passed the four observed cases after correcting the test setup. All agent limits in these cases were so low that one call crossed the limit. Thus the runs show the condition firing after a first call, not that accumulation over several calls is correct. A passing observation is not a general hard-spending guarantee. The lead can request any number of helpers in one step, and stock retries can add requests. The written three-helper reservation applies only to the observed three-helper run. The $12 call reservation is conservative for the published context and output limits of the two subscription models, but the free model catalogue did not publish a maximum output count. The free-model ceiling remains an assumption.

| Account and case | Result | Studio run id | Saved total USD | Written ceiling USD |
| --- | --- | --- | ---: | ---: |
| OpenAI lead | Pass, one call | `e02da294-e521-4936-b6b7-056828059e52` | 0.0003675 | 12.00000001 |
| OpenAI helper | Pass, one helper | `ea49c4f3-566a-4671-9beb-94ecf627b010` | 0.0004905 | 24.00000002 for lead and helper |
| OpenAI three helpers | Pass, three in one step | `ae53fc1c-b044-4a2d-8785-28c0eff145ad` | 0.0006882 | 48.00000004 |
| OpenAI whole-run guard | Pass, blocked by guardrail | `21d56ece-0b7d-4bfd-af97-086087b6f8e0` | 0.0004947 | 58.00000003, conditional on at most three helpers |
| Claude lead | Pass, one call | `80c54b7c-78b9-435d-8af2-3adf2645cae2` | 0.0012546 | 12.00000001 |
| Claude helper | Pass, one helper | `e5dce14d-cffb-422c-bafa-cb032e925fde` | 0.0018284 | 24.00000002 for lead and helper |
| Claude three helpers | Pass, three in one step | `bfad4e9e-9160-414c-ab75-7230e00482fe` | 0.0028191 | 48.00000004 |
| Claude whole-run guard | Pass, blocked by guardrail | `612fe576-f892-4572-9f27-9e51a343498a` | 0.00027361 | 58.00000003, conditional on at most three helpers |
| CommandCode lead | Pass with simulated price, one call | `7e0d9f26-84e0-49e2-b241-8d3ce73e0e24` | unavailable | 12.00000001 simulated |
| CommandCode helper | Fail, no helper started | `e8ca2c4f-1407-4b40-be5e-0ce6ddef8eb3` | unavailable | 24.00000002 simulated for lead and helper |
| CommandCode three helpers | Fail, no helper started | `35778960-6d02-4cce-be62-755107c46353` | unavailable | 48.00000004 simulated |
| CommandCode whole-run guard | Fail, no guardrail stop | `7690c82a-f144-4ce8-9d78-5473023d4d37` | unavailable | 58.00000003 conditional, invalidated by 43 helpers |

Each JSON file contains the saved input and output token metric rows, their saved dollar values, generation and agent span ids, stop reasons, tool calls, and the condition's token inputs and computed costs. The free-model rows have `null` dollar estimates, not zero-valued estimates. In each subscription parallel run, the three helper tool calls share one parent span and each helper records `stop_condition`. In both subscription guard runs, a finished helper has recorded cost above the run limit and the lead records `blocked / guardrail`. The lead's still-open cost is included only after it ends.

The [OpenAI model page](https://developers.openai.com/api/docs/models/gpt-6-luna) and [Claude Haiku 5.5 page](https://platform.claude.com/docs/en/models/haiku-5-5/overview) describe the model limits and API prices. Claude's condition values one-hour cache writes at the published rate, matching the saved rows in these runs. The condition selects the published long-context tier for each step. The test does not establish how to price every possible cache duration or missing-usage response.

## Reproduce

Install the locked dependencies in a disposable worktree with Mastra core 1.82.0 and signed-in subscription providers. Run `node spikes/agent-dollar-stop/run.mjs openai` or replace `openai` with `claude`. For CommandCode, provide `CMD_API_KEY` through a secret manager and run the same command with `commandcode`. Use only a model the gateway identifies as free. The script starts Studio 1.38.0, sends four real agent requests, and writes the run data under `.artifacts/flow/agent-dollar-stop`. Set `PROOF_PORT` if port 4198 is in use. It does not run a card. The guard case can run for up to three minutes. Raw traces and streams may contain sensitive data. Do not publish them without review.

Run `node spikes/agent-dollar-stop/report.mjs <artifact-directory> <output.json>` to extract the recorded rows and condition values. Compare the observed stops and helper count with the criteria and the ceilings recorded before a run. The script does not assign pass or fail. The first OpenAI and Claude attempts are retained as `openai-initial.json` and `claude-initial.json`; their setup limitations are stated above.
