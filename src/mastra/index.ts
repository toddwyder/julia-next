// The Studio entry. It registers the same card-path workflow against the same
// LibSQL state file a run writes, so a run started by
// `node machine/flow/run.mjs` shows up in Studio as the run it is.

process.env.CMD_API_KEY ??= process.env.COMMANDCODE_API_KEY;

import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';

import { createAgents } from '../../machine/flow/agents.mjs';
import { openScratch } from '../../machine/flow/scratch.mjs';
import { CARD_PATH } from '../../machine/flow/schema.mjs';
import { buildCardPath } from '../../machine/flow/workflow.mjs';

// The dev server runs from its own output folder, so the run folder is given
// as an absolute path: FLOW_DIR=$PWD/.artifacts/flow/product.
const dir = process.env.FLOW_DIR;
if (!dir || !dir.startsWith('/')) {
  throw new Error('Set FLOW_DIR to the absolute path of a run folder, e.g. FLOW_DIR=$PWD/.artifacts/flow/product');
}
openScratch(dir);
const agents = createAgents();
const workflow = buildCardPath({ agents, dir });

export const mastra = new Mastra({
  agents,
  workflows: { [CARD_PATH]: workflow },
  storage: new LibSQLStore({ id: 'flow-state', url: `file:${dir}/state.db` }),
});
