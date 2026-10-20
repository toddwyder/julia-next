import { createAgentActivityStore } from '../src/mastra/agent-activity.ts'
import { startControlPageServer } from '../src/mastra/control-page.ts'
import { ControlPageStateSchema, InitializationBoundaryStateSchema } from '../src/mastra/contracts.ts'

// Reuse real production initialization state; this candidate owns only its isolated agent DB.
const production = 'http://127.0.0.1:43123/julia-control/api'
const state = ControlPageStateSchema.parse(await (await fetch(`${production}/state`)).json())
const runs = InitializationBoundaryStateSchema.parse(await (await fetch(`${production}/runs`)).json())
const store = await createAgentActivityStore(process.argv[2])
const server = await startControlPageServer({ port: 0, getState: async () => state,
  getRuns: async () => ({ runs: runs.runs, totalRuns: runs.totalRuns }), getActivity: () => runs.activity,
  startInitialization: async () => { throw Error('Proof does not initialize cards') },
  getAgentCards: async () => ({ updatedAt: new Date().toISOString(), cards: await store.cards() }),
})
process.send?.({ url: server.url })
process.once('SIGTERM', () => { server.close().then(() => { store.close(); process.exit(0) }, () => process.exit(1)) })
