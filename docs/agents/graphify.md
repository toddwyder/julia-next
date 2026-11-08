# Graphify

Graphify builds a queryable knowledge graph of this repository and of the Mastra
documentation installed in `node_modules`. Agents query the graph instead of
reading the same files in every session.

The setup follows the [Graphify CLI docs](https://docs.graphify.com/open-source/cli-quickstart)
and the [ignore](https://docs.graphify.com/open-source/configuration/ignoring-files),
[update](https://docs.graphify.com/open-source/features/incremental-updates),
[LLM provider](https://docs.graphify.com/open-source/configuration/llm-providers),
and [agent](https://docs.graphify.com/cookbooks/make-agents-use-the-graph) pages.

## Graphs

| Graph | File | Source |
| --- | --- | --- |
| Julia and pstack | `graphify-out/graph.json` | Code and Markdown under the repository root |
| Mastra | `graphify-out/mastra/graph.json` | `node_modules/@mastra/*/dist/docs` for the installed package versions |

Code is parsed by tree-sitter and costs no model tokens. Markdown is extracted
semantically, so the Markdown corpora are the only token cost.

`.graphifyignore` keeps historical records, throwaway fixtures, duplicate skill
catalogs, and images out of the graph. Graphify reads `.gitignore` first, so
`.artifacts/`, `.commandcode/`, `.mastra/`, and `node_modules/` are already out.

## Build

Install Graphify once per machine. The `mcp` extra provides `graphify-mcp`; the
`openai` extra reaches the Command Code OpenAI-compatible endpoint.

```
uv tool install "graphifyy[mcp,openai]"
```

Both graphs use the Command Code endpoint already configured for the agents, so
no new service is involved. `scripts/julia-agents.mjs` supplies the key. The
flags below are the low-token path from Graphify's docs: the cheaper flash model,
thinking off, and a small chunk budget, because this model truncates a large
chunk and the retry re-sends it.

### Julia and pstack

```
node scripts/julia-agents.mjs -- bash -lc '
  export PATH="$HOME/.local/bin:$PATH"
  export OPENAI_BASE_URL=https://api.commandcode.ai/provider/v1
  export OPENAI_API_KEY="$COMMANDCODE_API_KEY"
  export GRAPHIFY_DISABLE_THINKING=1
  graphify extract . --backend openai --model deepseek/deepseek-v4.1-flash \
    --max-concurrency 4 --token-budget 10000
'
```

### Mastra

Each installed package keeps its own version-matched docs, and Graphify skips a
`dist` directory beneath a scan root. Extract each docs directory and merge the
results with Graphify's `merge-graphs` command.

```
node scripts/julia-agents.mjs -- bash -lc '
  export PATH="$HOME/.local/bin:$PATH"
  export OPENAI_BASE_URL=https://api.commandcode.ai/provider/v1
  export OPENAI_API_KEY="$COMMANDCODE_API_KEY"
  export GRAPHIFY_DISABLE_THINKING=1
  for docs in node_modules/@mastra/*/dist/docs; do
    pkg=$(basename "$(dirname "$(dirname "$docs")")")
    graphify extract "$docs" --backend openai --model deepseek/deepseek-v4.1-flash \
      --max-concurrency 4 --token-budget 10000 --out "graphify-out/mastra-src/$pkg"
  done
  graphify merge-graphs graphify-out/mastra-src/*/graphify-out/graph.json \
    --out graphify-out/mastra/graph.json
'
```

## Keep it current

Run `graphify hook install` once in a fresh clone. This server already has the
hooks. A clone that inherits this server's `core.hooksPath` also needs the chain
files in `/home/ubuntu/.config/git/julia-hooks` described under Limits, because
git ignores `.git/hooks` when that setting is present. The hooks rebuild the code
graph after commits, checkouts, merges, and rebases with no model calls. Graphify
rewrites the graph in the background, so a query right after a commit can
briefly see the previous graph.

Markdown changes need the extract command above. Graphify's own docs state that
`update` and the hooks re-extract code only; there is no automatic trigger for
Markdown, and none for a `node_modules` upgrade. After changing this repository's
docs, or after upgrading Mastra, run the matching command above.

## Agents

- `graphify install --platform agents --project` wrote the project skill to
  `.agents/skills/graphify`. Studio's Lead sees it through its workspace skills.
- Studio's Lead and helpers get Graphify's MCP tools from `machine/flow/graphify.mjs`.
  The tools are namespaced `julia_*` and `mastra_*`.
- `.mcp.json` gives Command Code sessions the same two servers.
- The `## Graphify` section in `AGENTS.md` tells every coding session when to ask
  the graph first.

## Cost

The repository graph build used 523,817 input and 849,440 output tokens, 1,373,257
in total. The Mastra build used 1,691,473 input and 2,065,540 output tokens,
3,757,013 in total across the seven package docs roots. The whole build is
5,130,270 tokens. That is the one-time semantic pass. A later run hits the
semantic cache and only changed Markdown is re-extracted.

`graphify-out/mastra/versions.json` records the installed package versions the
Mastra graph was built from. The three-question comparison is in
[graphify-comparison](./graphify-comparison.md).

## Limits

- Graphify skips `node_modules` and `dist` beneath a scan root. Each Mastra
  package's docs are therefore a separate extraction, merged with
  `graphify merge-graphs`. The merge tags every node with its package name, but
  a node's `source_file` stays relative to that package's docs root.
- `graphify update` and the git hooks re-extract code only. Markdown changes and
  Mastra upgrades need the extract commands above.
- This server sets `core.hooksPath` to `/home/ubuntu/.config/git/julia-hooks`,
  outside the repository. `graphify hook install` writes to `.git/hooks`, and
  the chain files in that directory call the repository hooks for `post-commit`,
  `post-checkout`, `post-merge`, and `post-rewrite`.

