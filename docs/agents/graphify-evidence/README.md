# Graphify comparison evidence

Each `qN_without.txt` and `qN_with.txt` pair is the exact text supplied to the model for that side of the comparison. Token counts use `cl100k_base`:

```
uv run --with tiktoken python -c "import tiktoken,pathlib; e=tiktoken.get_encoding('cl100k_base'); print(len(e.encode(pathlib.Path('q1_without.txt').read_text())))"
```

Questions:

1. How does Studio give the Lead agent its model at startup?
2. In the Babysit playbook, what must an agent do before polling, and which mode handles "get it green"?
3. How do you connect MCPClient to a local stdio server and give its tools to an Agent?

`ask.mjs` sends the pair as a system and user message to the Command Code endpoint and prints the answer with the model's usage. `repo-build.log` and `mastra-build.log` are the Graphify extraction logs with the token totals.
