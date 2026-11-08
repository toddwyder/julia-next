# Graphify comparison

One real question per source. "Without" is the search output plus the files a careful agent reads to answer. "With" is the Graphify query output plus the section it points at. Both sides use the same tokenizer (`cl100k_base`) on the exact text supplied to the model. For the Julia and pstack questions the same model also answered both evidence sets; its prompt plus completion totals are shown in brackets.

| Question | Without the graph | With the graph | Result |
| --- | --- | --- | --- |
| Julia: How does Studio give the Lead agent its model at startup? | 1,781 tokens (2,370 with the model) | 1,235 tokens (1,670 with the model) | 31% fewer with the graph |
| pstack: In the Babysit playbook, what must an agent do before polling, and which mode handles "get it green"? | 1,991 tokens (2,358 with the model) | 2,533 tokens (3,011 with the model) | 27% more with the graph |
| Mastra: How do you connect MCPClient to a local stdio server and give its tools to an Agent? | 20,754 tokens | 1,166 tokens | 94% fewer with the graph |

The Julia answer was correct both ways: Studio calls `createAgents`, which calls `buildModel`, which reads `~/.config/julia/lead-model`. The pstack answer was correct both ways: declare the mode and resolve the forge before polling, and `drive` handles "get it green". The Mastra model ask hit the Command Code rate limit after the build, so its row is the tokenizer count of the evidence only; the evidence files show the exact text.

Plain words. The graph pays for itself when the corpus is large and the answer is a small section of a long document, as with the Mastra reference page. It also trims a code question because it points at the one file and function. It does not pay on a small, single-file pstack answer, where a targeted search is already cheap and the query output is extra.

The evidence text used for these counts, the two build logs, and the ask script are in [graphify-evidence](./graphify-evidence/README.md).
