# The $4 cost guard

Todd decided on 11 November 2026 to use stock Mastra for the machine's spending limit and add custom code only when a real run shows a problem. This note says what the stock guard does and where it falls short.

## What it is

Every agent the machine builds (the Lead, each helper, Shipping, Remediation, Retro) carries Mastra's `TokenCostControl` set to $4, scoped to one run. Before each model step it asks Mastra's saved metrics what the run has cost so far. If the figure is $4 or more, it stops that agent with a tripwire. The cost is Mastra's own estimate: tokens the provider reported, times the price in Mastra's price table. The exporter writes after every event so the saved figure is as fresh as Mastra allows.

Every agent also answers under an output limit: 32,000 tokens for the agents, 100,000 for the two memory note-takers (the same number as PR #496). A test fails if any agent lacks one.

The old controller (`machine/budget`) is deleted. The Graphify exploration gate is kept, unchanged, in `createBuildGate`.

## Which calls it counts

- Any agent run, once that run has ended. Mastra saves a run's cost when its model span closes, not step by step.
- That includes helper runs the Lead starts, because they share the run's trace.

## Which calls it cannot count or stop

1. **An agent still running.** The guard cannot see a run's cost until the run ends. One agent looping inside one run is never stopped by the guard. A test (`known limit`) shows 8 loop steps of $3 each, $24 in all, with no stop. The Lead may take up to 400 steps and a helper up to 100.
2. **A call made outside an agent**, such as a model called directly from a workflow step. Mastra's docs say these are not counted. The machine makes none today.
3. **A model with no price in Mastra's table.** It counts as zero.
4. **A cost it cannot read.** If the saved cost cannot be read, the guard lets the call through.
5. **The memory note-takers.** They run inside the Lead's calls and are not guarded before they run. Whether their cost reaches the run's total is not yet checked.

## Worst case past $4

The Lead's own loop is the exposure, because the guard sees it only when it ends. Worst case for one Lead run on `openai/gpt-6.1-sol` (Mastra prices: $2 per million input tokens, $10 per million output tokens, short-context tier):

- One step, at most: 272,000 input tokens x $2 / 1,000,000 = $0.544, plus 32,000 output tokens x $10 / 1,000,000 = $0.32. That is $0.864.
- The Lead may take 400 steps: 400 x $0.864 = **$345.60**.

With cached input at $0.10 per million, a step is about $0.347 and the run about $139. Both figures come from arithmetic on Mastra's prices and the step limits. No real run has come near them.

Past $4, the guard also lets one more agent run finish after the limit is crossed: the test run crossed at $6 (two $3 helper runs), so the overshoot there was one run.

## What a real call showed

One call to `openai/gpt-6-luna` (73 input tokens, 5 output tokens, as the provider reported them) was saved as $0.0000098. At Mastra's prices, 73 x $0.10 / 1,000,000 + 5 x $0.50 / 1,000,000 = $0.0000098. The two match.

## If this is not enough

The gap is item 1. The stock fix is a lower step limit on the Lead. Anything stronger is custom code, which waits for Todd's word.
