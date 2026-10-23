# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (omit the subagent `model`). Alias entries in a panel list still count toward its fan-out.
# budget: large (xhigh)
feature, refactoring: DeepSeek
bug-fix: DeepSeek
perf-issue: DeepSeek
hillclimb: DeepSeek
swarm workers: DeepSeek
arena runners: GPT-6 Sol, DeepSeek
arena cross-judge pool: GPT-6 Sol, DeepSeek
architect runners: GPT-6 Sol, DeepSeek
interrogate reviewers: GPT-6 Sol, DeepSeek
hardest tasks: GPT-6 Sol
main session: GPT-6 Sol
judgment and prose: GPT-6 Sol
how explorer: GPT-6 Sol
how explainer: GPT-6 Sol
why investigators: GPT-6 Sol
why synthesizer: GPT-6 Sol
reflect tooling: GPT-6 Sol
reflect judgment, divergent, synthesizer: GPT-6 Sol
