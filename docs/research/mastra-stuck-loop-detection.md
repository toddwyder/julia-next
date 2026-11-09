# Mastra Built-in Stuck, Loop, and Repetition Detection Research

Checked against the installed Mastra version's docs and the Mastra knowledge graph (graphify-out/mastra/graph.json):

1. **Mastra Agent Controller / Subagents**:
   - Mastra 1.82.0 (@mastra/core, @mastra/code-sdk) ships no built-in automatic stuck, loop, or step-repetition detection for agents or subagents.
   - The only mechanism provided by Mastra for custom step-level termination is the stopWhen callback hook (streamStopWhen on definition / run options), which runs at step boundaries.
   - Mastra's built-in step termination reasons are limited to max_steps (defaults to 50 steps if not overridden, or interactive limit) and tool termination.

2. **Long-Running / Blocked Tool Calls (Stuck)**:
   - Mastra has no built-in idle timeout or wall-clock watchdog for processes blocked inside a tool call (such as a server wait).
   - Because a blocked call never yields a step boundary to stopWhen, handling idle/stuck runs requires watching activity via the subagent tool's emitEvent and aborting via AbortController (bortSignal).

3. **Conclusion**:
   - Because Mastra provides no built-in stuck/loop detection out of the box, machine/shipping/stops.mjs integrates custom detection predicates into Mastra's supported stopWhen hook for repetition, spinning, and token ceilings, paired with watchReview on the abort signal for idle detection.
