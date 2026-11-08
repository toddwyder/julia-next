import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { MCPClient } from '@mastra/mcp';

import { repoRoot } from './agents.mjs';

let client;

export function graphifyGraphPaths(repo = repoRoot()) {
  const out = join(repo, 'graphify-out');
  return {
    julia: join(out, 'graph.json'),
    mastra: join(out, 'mastra', 'graph.json'),
  };
}

export async function graphifyTools({ repo = repoRoot() } = {}) {
  const paths = graphifyGraphPaths(repo);
  const servers = {};
  for (const [name, graph] of Object.entries(paths)) {
    if (existsSync(graph)) {
      servers[name] = { command: process.env.GRAPHIFY_MCP ?? 'graphify-mcp', args: [graph] };
    }
  }
  if (!Object.keys(servers).length) return {};

  try {
    client = new MCPClient({ id: 'graphify', servers });
    return await client.listTools();
  } catch (error) {
    console.warn(`[graphify] graph tools are unavailable: ${error.message}`);
    await client?.disconnect().catch(() => {});
    client = undefined;
    return {};
  }
}

export async function closeGraphify() {
  const open = client;
  client = undefined;
  if (open) await open.disconnect();
}
