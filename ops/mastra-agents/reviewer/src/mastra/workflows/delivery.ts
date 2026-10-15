import { createStep, createWorkflow } from '@mastra/core/workflows'
import { WorkflowInputSchema, WorkflowOutputSchema } from '../contracts.ts'
import { createAcpRoutes, createCommandCodeAgent, selectAcpModel } from '../routes.ts'

export function createRoleExecutionWorkflow({
  routes = createAcpRoutes(),
  commandCodeKey = () => process.env.COMMANDCODE_API_KEY,
  promptForRole = (role: string, issueId: string) => `Perform the ${role} role for ${issueId}.`,
} = {}) {
  const execute = createStep({
    id: 'execute-four-role-snapshot',
    inputSchema: WorkflowInputSchema,
    outputSchema: WorkflowOutputSchema,
    execute: async ({ inputData }) => {
      const results: Record<string, string> = {}
      for (const [role, selection] of Object.entries(inputData.snapshot.roles)) {
        if (selection.route === 'commandcode') {
          const key = commandCodeKey()
          if (!key) throw new Error('CommandCode secret reference did not resolve')
          const result = await createCommandCodeAgent(selection, key).generate(promptForRole(role, inputData.snapshot.issueId))
          results[role] = result.text
        } else {
          await selectAcpModel(routes, selection)
          const result = await routes[selection.route].generate(promptForRole(role, inputData.snapshot.issueId))
          results[role] = result.text
        }
      }
      return { status: 'completed' as const, runId: crypto.randomUUID(), results }
    },
  })
  return createWorkflow({ id: 'julia-delivery-roles', inputSchema: WorkflowInputSchema, outputSchema: WorkflowOutputSchema })
    .then(execute)
    .commit()
}
