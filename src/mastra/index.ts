// The Studio entry. Registering the card-path workflow here is what puts it on
// Studio's run form, and that form is the one place a card is started.
//
// FLOW_DIR overrides the durable Studio run folder under .artifacts/flow.

process.env.CMD_API_KEY ??= process.env.COMMANDCODE_API_KEY;

import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { createSliceControl } from '../../machine/budget/control.mjs';

import { createAgents } from '../../machine/flow/agents.mjs';
import { graphifyTools } from '../../machine/flow/graphify.mjs';
import { openMastra } from '../../machine/flow/mastra.mjs';
import { CARD_PATH } from '../../machine/flow/schema.mjs';
import { openScratch } from '../../machine/flow/scratch.mjs';
import { buildCardPath } from '../../machine/flow/workflow.mjs';

export const STUDIO_DOLLAR_CAP = 4;
export const STUDIO_TOKEN_CAP = 2_000_000;

const dir = resolve(process.env.FLOW_DIR ?? '.artifacts/flow/studio');

openScratch(dir);
const budget = createSliceControl({
  directory: join(homedir(), '.local/state/julia/budget'),
  dollarCap: STUDIO_DOLLAR_CAP,
  tokenCap: STUDIO_TOKEN_CAP,
});
const agents = createAgents({ tools: await graphifyTools(), budget });
const workflow = buildCardPath({ agents, dir });

// Storage and observability come from the same place a resumed run uses, so the
// model calls a Studio run makes are written to this run folder's trace file.
export const mastra = await openMastra({
  card: process.env.FLOW_CARD ?? '',
  agents,
  budget: agents.budget,
  workflow,
  stateDb: resolve(dir, 'state.db'),
  traceDb: resolve(dir, 'trace.duckdb'),
});
