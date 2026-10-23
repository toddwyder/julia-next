# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (omit the subagent `model`). Alias entries in a panel list still count toward its fan-out.
# budget: large (xhigh)
feature, refactoring: commandcode-free/deepseek/deepseek-v4.1-flash
bug-fix: commandcode-free/deepseek/deepseek-v4.1-flash
perf-issue: commandcode-free/deepseek/deepseek-v4.1-flash
hillclimb: commandcode-free/deepseek/deepseek-v4.1-flash
swarm workers: commandcode-free/deepseek/deepseek-v4.1-flash
arena runners: openai/gpt-6-sol, commandcode-free/deepseek/deepseek-v4.1-flash
arena cross-judge pool: openai/gpt-6-sol, commandcode-free/deepseek/deepseek-v4.1-flash
architect runners: openai/gpt-6-sol, commandcode-free/deepseek/deepseek-v4.1-flash
interrogate reviewers: openai/gpt-6-sol, commandcode-free/deepseek/deepseek-v4.1-flash
hardest tasks: openai/gpt-6-sol
main session: openai/gpt-6-sol
judgment and prose: openai/gpt-6-sol
how explorer: openai/gpt-6-sol
how explainer: openai/gpt-6-sol
why investigators: openai/gpt-6-sol
why synthesizer: openai/gpt-6-sol
reflect tooling: openai/gpt-6-sol
reflect judgment, divergent, synthesizer: openai/gpt-6-sol
