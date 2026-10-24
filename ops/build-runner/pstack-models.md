# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (omit the subagent `model`). Alias entries in a panel list still count toward its fan-out.
# budget: large (xhigh)
feature, refactoring: commandcode/deepseek/deepseek-v4.1-flash
bug-fix: commandcode/deepseek/deepseek-v4.1-flash
perf-issue: commandcode/deepseek/deepseek-v4.1-flash
hillclimb: commandcode/deepseek/deepseek-v4.1-flash
swarm workers: commandcode/deepseek/deepseek-v4.1-flash
arena runners: anthropic/claude-haiku-5-5, commandcode/deepseek/deepseek-v4.1-flash
arena cross-judge pool: anthropic/claude-haiku-5-5, commandcode/deepseek/deepseek-v4.1-flash
architect runners: anthropic/claude-haiku-5-5, commandcode/deepseek/deepseek-v4.1-flash
interrogate reviewers: anthropic/claude-haiku-5-5, commandcode/deepseek/deepseek-v4.1-flash
hardest tasks: anthropic/claude-haiku-5-5
main session: anthropic/claude-haiku-5-5
judgment and prose: anthropic/claude-haiku-5-5
how explorer: commandcode/deepseek/deepseek-v4.1-flash
how explainer: commandcode/deepseek/deepseek-v4.1-flash
why investigators: commandcode/deepseek/deepseek-v4.1-flash
why synthesizer: anthropic/claude-haiku-5-5
reflect tooling: anthropic/claude-haiku-5-5
reflect judgment, divergent, synthesizer: anthropic/claude-haiku-5-5
