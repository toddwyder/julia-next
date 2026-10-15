import { Mastra } from '@mastra/core/mastra'
import type { MastraStorage } from '@mastra/core/storage'
import { createRoleExecutionWorkflow } from './workflows/delivery.ts'

export function createJuliaMastra(storage: MastraStorage) {
  const deliveryWorkflow = createRoleExecutionWorkflow()
  return new Mastra({
    storage,
    workflows: { deliveryWorkflow },
  })
}
