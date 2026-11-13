# DeepSeek shared card dollar proof

Before the first run, the CommandCode balance was $5.0985978124, consisting of purchased credits. It was read on 2026-11-13 from CommandCode's billing credits endpoint using only the CommandCode secret.

All runs use the same $0.02 card limit and a cap of two simultaneous helper tools. Before every run, its ceiling is $2.3024. That reserves the limit plus three maximum calls, one each for the lead and two helpers. The conservative peak-price maximum is $0.7608 per call: one million input tokens at $0.30 per million, plus 384,000 output tokens at $1.20 per million. The [DeepSeek pricing page](https://api-docs.deepseek.com/quick_start/pricing/) gives those limits and prices. It gives $0.15 per million uncached input, $0.003 per million cached input, and $0.60 per million output in off-peak hours. Cache writes are priced as uncached input. We will use off-peak rates for calls made outside DeepSeek's published peak hours, and peak rates for calls during peak hours. The ceiling always reserves peak rates. The fixture uses no paid tools.

The first solo attempt, run `158eb10a-9b10-4322-8754-9103eab3ceba`, ended at Mastra's 100-step limit after 100 calls. It spent $0.00540306, and Studio's input and output rows sum to the same amount. It did not reach the card limit and is inconclusive for the dollar stop. Before the repeat, the card limit remains $0.02 and the ceiling remains $2.3024. The repeat uses larger random tool results to reach the limit in fewer calls.

## Results

Case 5 failed. During published peak hours the solo repeat stopped after four calls, but Studio recorded exactly half the price required by DeepSeek's peak rates. The test cannot meet the requirement that both totals match using the stock Studio price data. No further model runs were started after this finding.

| Case | Result | Evidence |
| --- | --- | --- |
| 1. Lead loops | Pass | Run `58a38e88-a9ed-466c-ab45-3ed6c873d3c3` crossed $0.02 on its fourth call. Its next input was blocked at $0.028071168. |
| 2. New helpers | Not run | Stopped after the cost reconciliation failure. |
| 3. Many helpers | Not run | Stopped after the cost reconciliation failure. |
| 4. Missing usage | Not run | Stopped after the cost reconciliation failure. |
| 5. Reconcile every run | **Fail** | The four-call run's ledger and recalculated peak price are $0.028071168. Studio saved $0.013956384 input plus $0.0000792 output, or $0.014035584. All are below the $2.3024 ceiling. |
| 6. Balance | Pass for the two runs | The balance fell from $5.0985978124 to $5.0651235844, a difference of $0.033474228. The two run totals sum to $0.033474228. |

The four-call run started after 01:00 UTC on Friday 13 November 2026, within DeepSeek's published peak period. Studio's saved prices match its installed CommandCode price table of $0.15 uncached input, $0.003 cache read, and $0.60 output per million. DeepSeek's published peak rates are twice those values. The account balance decrease matches the peak-priced ledger for these two runs, but that observation does not establish the gateway's billing rules for other times or calls.

The two committed JSON files contain the recorded token rows, ledger events and Studio spans for the two runs. `solo-initial.json` preserves the 100-call setup attempt. `solo-peak.json` preserves the four-call repeat. Both used real Studio agent requests, not a full card workflow. The earlier PR 510 experiment used separate Studio processes for each run, so this does not prove concurrent card isolation.

## Reproduce

Install the locked dependencies in an isolated worktree with access to the CommandCode secret. The helper supplies only `CMD_API_KEY` through 1Password and removes inherited Linear variables. It does not run the Julia secret wrapper or request a Linear token.

```sh
node spikes/deepseek-card-dollar-proof/with-key.mjs node spikes/deepseek-card-dollar-proof/run.mjs solo
node spikes/deepseek-card-dollar-proof/report.mjs <artifact-directory> <output.json>
node spikes/deepseek-card-dollar-proof/check.mjs <output.json>
```

The run command also accepts `helpers`, `parallel`, and `missing`; those cases were not run. The missing-usage case deliberately withholds the current response's usage from the processor. Treat it as a simulation, not a provider-produced missing-usage response. The checker recalculates from token rows and exits nonzero when the ledger, Studio cost, or ceiling does not match. Check pricing and record the current balance and a ceiling before another run. Raw streams and databases may contain sensitive data.
