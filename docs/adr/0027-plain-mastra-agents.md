---
Status: proposed. Todd decided 10 Nov 2026. Supersedes the 25 Oct harness line in docs/plans/path-forward.md; amends 0026.
---
# Plain Mastra agents run the machine

The card path's agents are `@mastra/core` agents; from Mastra Code they take only the two subscription sign-in modules. Why: Mastra Code's agents can't track cost accurately. The agents get pstack's tools from `@mastra/core` (the task list, the subagent tool with its helper types, read-only access where an agent only looks), and one short guide maps pstack's instructions to those tools; `docs/harness/mastra-code.md` covers hand-run sessions only.
