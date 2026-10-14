# 0019. Stock Mastra before custom orchestration

Date: 2026-10-13

Status: Accepted (Todd, in conversation, 13 Oct 2026)

The delivery workflow uses the installed Mastra version's documented public capabilities for
workflow state, control flow, retries, suspension, resumption, and persistence. Julia-specific
workflow steps and adapters are normal stock use. Patching Mastra or `node_modules`, using
undocumented internals, bypassing a documented safety or persistence mechanism, or rebuilding a
capability Mastra already supplies is a Mastra deviation and requires Todd's explicit approval
before implementation.

Before requesting that approval, the agent must identify the installed-version documentation it
followed, the stock approach it tried, the observed failure, and the smallest proposed deviation.
Difficulty alone does not authorize custom machinery.
