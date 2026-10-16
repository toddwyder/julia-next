import { Mastra } from '@mastra/core/mastra'
import type { MastraStorage } from '@mastra/core/storage'
import { createRoleExecutionWorkflow } from './workflows/delivery.ts'
import { createInitializationWorkflow } from './initialization.ts'

export function createJuliaMastra(storage: MastraStorage, deliveryWorkflow = createRoleExecutionWorkflow(), initializationWorkflow = createInitializationWorkflow()) {
  return new Mastra({
    storage,
    workflows: { deliveryWorkflow, initializationWorkflow },
  })
}
