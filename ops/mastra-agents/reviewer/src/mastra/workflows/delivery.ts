import { createStep, createWorkflow } from '@mastra/core/workflows'
import { WorkflowInputSchema, WorkflowOutputSchema } from '../contracts.ts'
import { createAcpRoutes, createCommandCodeAgent, selectAcpModel } from '../routes.ts'
import { validateRoleDefaults } from '../roles.ts'

export function createRoleExecutionWorkflow({
  routes = createAcpRoutes(),
  commandCodeKey = () => process.env.COMMANDCODE_API_KEY,
  promptForRole = (role: string, issueId: string, _priorResults: Readonly<Record<string, string>>) => `Perform the ${role} role for ${issueId}.`,
} = {}) {
  const execute = createStep({
    id: 'execute-four-role-snapshot',
    inputSchema: WorkflowInputSchema,
    outputSchema: WorkflowOutputSchema,
    execute: async ({ inputData }) => {
      const results: Record<string, string> = {}
      const traces: Record<string, { route: typeof inputData.snapshot.roles.builder.route; modelId: string; startedAt: string; durationMs: number; ok: boolean }> = {}
      const roles = validateRoleDefaults(inputData.snapshot.roles, { allowSameService: inputData.snapshot.allowSameService })
      for (const [role, selection] of Object.entries(roles)) {
        const startedAt = new Date().toISOString()
        const started = performance.now()
        try {
          const prompt = promptForRole(role, inputData.snapshot.issueId, { ...results })
          if (selection.route === 'commandcode') {
            const key = commandCodeKey()
            if (!key) throw new Error('CommandCode secret reference did not resolve')
            const result = await createCommandCodeAgent(selection, key).generate(prompt)
            results[role] = result.text
          } else {
            await selectAcpModel(routes, selection)
            const result = await routes[selection.route].generate(prompt)
            results[role] = result.text
          }
        } catch (error) {
          console.error(JSON.stringify({ event: 'delivery-route-failed', role, route: selection.route, modelId: selection.modelId, startedAt, durationMs: performance.now() - started, error: error instanceof Error ? error.message : String(error) }))
          throw error
        }
        traces[role] = { route: selection.route, modelId: selection.modelId, startedAt, durationMs: performance.now() - started, ok: true }
      }
      return { status: 'completed' as const, runId: crypto.randomUUID(), results, traces }
    },
  })
  return createWorkflow({ id: 'julia-delivery-roles', inputSchema: WorkflowInputSchema, outputSchema: WorkflowOutputSchema })
    .then(execute)
    .commit()
}
