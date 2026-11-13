# The $4 cost guard

Todd decided on 11 November 2026 to use stock Mastra for the machine's spending limit and add custom code only when a real run shows a problem. This note says what the stock guard does and where it falls short.

## What it is

Every agent the machine builds (the Lead, each helper, Shipping, Remediation, Retro) carries Mastra's `TokenCostControl` set to $4, scoped to one run. Before each model step it asks Mastra's saved metrics what the run has cost so far. If the figure is $4 or more, it stops that agent with a tripwire. The cost is Mastra's own estimate: tokens the provider reported, times the price in Mastra's price table. The exporter writes after every event so the saved figure is as fresh as Mastra allows.

Every agent answers to the model's own length limit, and the card's own dollar ledger (`machine/flow/spending.mjs`) adds each finished call and stops the card at its limit. The ledger is what ends a runaway answer.

The old controller (`machine/budget`) is deleted.

## Which calls it counts

- Any agent run, once that run has ended. Mastra saves a run's cost when its model span closes, not step by step.
- That includes helper runs the Lead starts, because they share the run's trace.

## Which calls it cannot count or stop

1. **An agent still running.** The guard cannot see a run's cost until the run ends. One agent looping inside one run is never stopped by the guard. A test (`known limit`) shows 8 loop steps of $3 each, $24 in all, with no stop. The Lead may take up to 400 steps and a helper up to 100.
2. **A call made outside an agent**, such as a model called directly from a workflow step. Mastra's docs say these are not counted. The machine makes none today.
3. **A model with no price in Mastra's table.** It counts as zero.
4. **A cost it cannot read.** If the saved cost cannot be read, the guard lets the call through.
5. **The memory note-takers.** They run inside the Lead's calls and are not guarded before they run. They cost $0: both run on a free model the price list offers, and that model is metered into the card's ledger like any other.

## Worst case past $4

The Lead's own loop is the exposure, because the guard sees it only when it ends. Worst case for one Lead run on a frontier coding model at Mastra's short-context prices, $2 per million input tokens and $10 per million output tokens:

- One step, at most: 272,000 input tokens x $2 / 1,000,000 = $0.544, plus the model's longest answer, 32,000 output tokens x $10 / 1,000,000 = $0.32. That is $0.864.
- The Lead may take 400 steps: 400 x $0.864 = **$345.60**.

With cached input at $0.10 per million, a step is about $0.347 and the run about $139. Both figures come from arithmetic on Mastra's prices and the step limits. No real run has come near them.

Past $4, the guard also lets one more agent run finish after the limit is crossed: the test run crossed at $6 (two $3 helper runs), so the overshoot there was one run.

## What a real call showed

One measured call (73 input tokens, 5 output tokens, as the provider reported them) was saved as $0.0000098. At that model's Mastra prices, 73 x $0.10 / 1,000,000 + 5 x $0.50 / 1,000,000 = $0.0000098. The two match.

## If this is not enough

The gap is item 1. The stock fix is a lower step limit on the Lead. Anything stronger is custom code, which waits for Todd's word.
