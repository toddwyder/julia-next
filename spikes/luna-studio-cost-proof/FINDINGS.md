# Studio records the tested costs and stops both delegated runs

Todd needs to know whether Studio accounts for the whole build agent's model spending and whether Mastra stops it at a cost limit before paid models run cards.

| Question | Current build agent | Same configuration through `createCodingAgent()` |
| --- | --- | --- |
| Is every tested model call included in recorded dollar cost, including the helper, observer, and reflector? | **Yes.** | **Yes.** |
| Does Mastra's cost guard stop the deliberately over-limit delegated run? | **Yes.** | **Yes.** |

The guard is not a hard spending ceiling. It stopped each run after the helper finished, before the Lead could make its second call. Its cost reading omitted the Lead's still-open model generation. Do not interpret either yes as proof that a single agent looping without finished helpers will stop at its limit. The installed implementation and the existing `machine/flow/cost-guard.test.mjs` document that separate limitation. This experiment did not change or fix it.

## Six real Studio runs on 12 November 2026

Every model call used `openai/gpt-6-luna`. No mock, free model, fallback, or model substitution was used. These are Studio agent run ids, not workflow ids. All six tasks asked the Lead to delegate string reversal to exactly one `how explorer` helper. This measures accounting and stopping, not the quality of its answer.

| Test | Studio run id | Persisted outcome | Recorded total USD |
| --- | --- | --- | ---: |
| current-normal | a36cc4f5-df0d-4672-b2a5-63299cf6df68 | success | 0.00320574 |
| current-stop | 5a7e3948-0e85-4deb-aa77-48b4d53c6ad8 | blocked, guardrail | 0.00303740 |
| current-memory | 009213a7-d4b0-40cd-8044-6d6bca9916d2 | success | 0.00742436 |
| coding-normal | b856bf63-2f78-4e62-b54b-5706b8a5b5ad | success | 0.00337012 |
| coding-stop | 6033e456-cf1d-4d61-bcc1-8314e702b072 | blocked, guardrail | 0.00323090 |
| coding-memory | 06dbfece-1e05-42a4-96af-8f42628d49c8 | success | 0.00602174 |

The six runs total $0.02629026 in recorded estimates. There were 27 completed model calls, grouped into 22 model-generation records. Mastra records dollars on a generation's token metrics. A generation can contain several calls. Each call's tokens remain separately recorded in its inference span. The report reconciles every inference against its generation and the generation's dollar rows. It never invents a separate recorded dollar value for an individual inference.

The stop limit was $0.00000001 for both agents. The current agent's guard reported $0.00166610, the helper's completed cost. Its final recorded total, including the Lead, was $0.00303740. The coding agent's guard reported $0.00182740 and its final total was $0.00323090. Both persisted roots say `outcome=blocked` and `stopReason=guardrail`. Both stream records name `token-cost-control`, `retry=false`, `threshold=hard`, and `maxCost=1e-8`. The human-readable tripwire message rounds that tiny limit to `0`; the structured metadata retains the exact limit.

## Exact recorded dollar rows and price comparison

Every row below is model `gpt-6-luna`, priced under provider `openai`. Input includes cached input. Cached input must be subtracted before applying the ordinary input rate. Output includes reasoning tokens. There were no cache-write tokens.

The independently calculated cost is `(input - cached) × $0.10 / 1,000,000 + cached × $0.01 / 1,000,000 + output × $0.50 / 1,000,000`. These are the installed Mastra rates and the [official Luna standard rates](https://developers.openai.com/api/docs/models/gpt-6-luna) checked on 12 November. Every context was below 272,000 tokens. No rate for another model was used.

The two recorded USD columns are exact saved `mastra_model_total_input_tokens` and `mastra_model_total_output_tokens` rows, displayed to eight decimals. Their sum equals the independent price column for every generation. [evidence.json](evidence.json) preserves the original numeric values, metric ids, child run ids, trace ids, usage, inference spans, and stop metadata. Detail token metrics repeat these costs, so adding those again would double count.

| Test | Owner | Generation span | Input | Cached input | Output | Recorded input USD | Recorded output USD | Tokens times price USD |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| current-normal | flow-build | c8518be4e5aa278e | 26829 | 13184 | 85 | 0.00149634 | 0.00004250 | 0.00153884 |
| current-normal | pstack-how-explorer-1 | a89c60d5ad584dba | 16629 | 0 | 8 | 0.00166290 | 0.00000400 | 0.00166690 |
| current-stop | flow-build | 1a715c81e3b971b0 | 13368 | 0 | 69 | 0.00133680 | 0.00003450 | 0.00137130 |
| current-stop | pstack-how-explorer-1 | 0afec8b7a2d7c430 | 16621 | 0 | 8 | 0.00166210 | 0.00000400 | 0.00166610 |
| current-memory | flow-build | 5a7fe7c5c7549b3b | 30161 | 14848 | 87 | 0.00167978 | 0.00004350 | 0.00172328 |
| current-memory | observational-memory-observer | 1035067d7464c474 | 5293 | 0 | 343 | 0.00052930 | 0.00017150 | 0.00070080 |
| current-memory | observational-memory-reflector | ca996ac9978b4e04 | 6188 | 0 | 223 | 0.00061880 | 0.00011150 | 0.00073030 |
| current-memory | observational-memory-reflector | cbbdce5055026f91 | 6220 | 0 | 213 | 0.00062200 | 0.00010650 | 0.00072850 |
| current-memory | observational-memory-reflector | 3df18a848726ee46 | 6239 | 0 | 211 | 0.00062390 | 0.00010550 | 0.00072940 |
| current-memory | observational-memory-reflector | bb6a36e87277f39e | 6292 | 0 | 208 | 0.00062920 | 0.00010400 | 0.00073320 |
| current-memory | pstack-how-explorer-1 | 6c4f99c1878859ef | 36487 | 18048 | 109 | 0.00202438 | 0.00005450 | 0.00207888 |
| coding-normal | flow-build | 1aa79f62c129955d | 27015 | 13312 | 77 | 0.00150342 | 0.00003850 | 0.00154192 |
| coding-normal | pstack-how-explorer-1 | 418e133cd68584eb | 17692 | 0 | 118 | 0.00176920 | 0.00005900 | 0.00182820 |
| coding-stop | flow-build | cbfb8c9c8ae15afa | 13465 | 0 | 114 | 0.00134650 | 0.00005700 | 0.00140350 |
| coding-stop | pstack-how-explorer-1 | fba36a1cb8f43ed4 | 17699 | 0 | 115 | 0.00176990 | 0.00005750 | 0.00182740 |
| coding-memory | flow-build | 4b058feaa378d877 | 30389 | 14976 | 87 | 0.00169106 | 0.00004350 | 0.00173456 |
| coding-memory | observational-memory-observer | 9ca991264b668e29 | 5293 | 4096 | 302 | 0.00016066 | 0.00015100 | 0.00031166 |
| coding-memory | observational-memory-reflector | 921112eec9ce0e9b | 6208 | 0 | 242 | 0.00062080 | 0.00012100 | 0.00074180 |
| coding-memory | observational-memory-reflector | 949ba22c85b1e171 | 6240 | 5376 | 261 | 0.00014016 | 0.00013050 | 0.00027066 |
| coding-memory | observational-memory-reflector | dcf0dcf4deed1416 | 6259 | 0 | 334 | 0.00062590 | 0.00016700 | 0.00079290 |
| coding-memory | observational-memory-reflector | 4a646c15f1f005d2 | 6312 | 5376 | 179 | 0.00014736 | 0.00008950 | 0.00023686 |
| coding-memory | pstack-how-explorer-1 | b7fd608022fb1d5e | 19293 | 0 | 8 | 0.00192930 | 0.00000400 | 0.00193330 |

## What the fixture changes

The source under test is `machine/flow/agents.mjs` at `be39210`, SHA-256 recorded in `evidence.json`. Neither that file nor any machine program changed. The script copies that source into the ignored run folder and rewrites its relative imports to their original locations.

Both variants keep the full poteto-mode instructions, workspaces, dynamic helper construction, subscription provider, memory models, output limits, and run-scoped stock `TokenCostControl`. The coding variant replaces the `new Agent(config)` construction with `createCodingAgent(config)` for every constructed agent, including unused stage stand-ins. Only the Lead is registered; its helpers resolve dynamically. Mastra core is 1.82.0, verified from the unchanged installed package after the runs and recorded as `environmentVerifiedAtExport` in the evidence. That factory adds runtime defaults, including task signals when memory exists. It does not supply a guard, memory, or observability by itself. We explicitly retain the same existing configuration.

All saved model selections point to test-local Luna-only files. Shared settings stay untouched. The normal fixture changes no guard or memory thresholds. Stop fixtures replace only the $4 guard limit with $0.00000001. Every Lead request has a safety step limit of eight and activates only `agent-howExplorer`. This limit did not end any run. Helpers retain their workspace tools; one current-memory helper used `printf '937tlaboc'`, which wrote no files.

The separate memory fixture adds synthetic conversation history, lowers observation and reflection triggers to 200 and 100 tokens, and disables asynchronous buffering. This makes both memory helpers run without a large conversation. All other memory settings, including Luna, zero retries, abort policy, and output limits, stay as built. Each variant recorded one observer and four reflector calls. These forced calls belonged to the Lead's memory. This directly tests both memory-helper types; it does not claim every possible memory background schedule has been exercised.

The server is the real Mastra Studio dev server, CLI 1.38.0, using the repository's unchanged `openMastra()` storage and exporter. The script submits to Studio's `/api/agents/<key>/stream` route. It starts no card, calls no Linear tool, and never runs the card workflow. Trace and state files remain under `.artifacts/flow`. This is a disposable measurement, not a change ready for production.

Dollar costs are Mastra's token-based estimates. This agent uses the existing ChatGPT subscription provider. These records do not establish a separate credit-card charge or API invoice.

## Rerun and inspect

From a disposable worktree with the repository dependencies installed, run these commands. The first makes real Luna calls through the existing subscription login. It needs no Linear credentials.

```sh
node spikes/luna-studio-cost-proof/run.mjs run
node spikes/luna-studio-cost-proof/run.mjs query <artifact-directory>
```

`PROOF_PORT` changes the isolated Studio port from 4197. The first command prints the artifact directory. The second reads the stopped server's DuckDB file and repeats all checks without model calls. Both write a sanitized `evidence.json` and `rows.md` there. Raw local traces and streams include request payloads and provider headers; do not publish them.

The original six-run directory is `/home/ubuntu/.local/state/julia-scratch/luna-studio-cost-proof/.artifacts/flow/luna-cost-proof/2026-11-12T16-11-34.988Z`. An earlier setup attempt had an import error. A second attempt's run `9dea8a9d-1696-4333-b786-2fd604fb86d7` was interrupted by Studio reloading after a fixture correction. Those attempts are excluded from the six clean runs and their totals. Their local folders end in `16-09-55.910Z` and `16-10-43.228Z`.

Build the Lever shaped the rerunnable exporter. Explain the Number shaped the separate cached-token arithmetic and the distinction between guard-visible and final cost. Model the Domain shaped the two-factory, three-case table. Prove It Works required persisted Studio outcomes and original metric rows for every answer.
