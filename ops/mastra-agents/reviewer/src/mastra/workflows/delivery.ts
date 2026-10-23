import { createStep, createWorkflow } from '@mastra/core/workflows'
import { WorkflowInputSchema, WorkflowOutputSchema } from '../contracts.ts'
import { createAcpRoutes, createCommandCodeAgent, selectAcpModel } from '../routes.ts'
import { validateRoleDefaults } from '../roles.ts'
import type { createInitializationActivityRecorder } from '../initialization-observability.ts'

export type DeliveryRole = keyof ReturnType<typeof validateRoleDefaults>
type ActivityRecorder = Pick<ReturnType<typeof createInitializationActivityRecorder>, 'recordRoleDispatch' | 'recordLlmInference'>

export function createRoleExecutionWorkflow({
  routes = createAcpRoutes(),
  commandCodeKey = () => process.env.COMMANDCODE_API_KEY,
  promptForRole = (role: DeliveryRole, issueId: string, _priorResults: Readonly<Record<string, string>>) => `Perform the ${role} role for ${issueId}.`,
  activity,
}: {
  routes?: ReturnType<typeof createAcpRoutes>
  commandCodeKey?: () => string | undefined
  promptForRole?: (role: DeliveryRole, issueId: string, priorResults: Readonly<Record<string, string>>) => string
  activity?: ActivityRecorder
} = {}) {
  const execute = createStep({
    id: 'execute-four-role-snapshot',
    inputSchema: WorkflowInputSchema,
    outputSchema: WorkflowOutputSchema,
    execute: async ({ inputData }) => {
      const results: Record<string, string> = {}
      const traces: Record<string, { route: typeof inputData.snapshot.roles.builder.route; modelId: string; startedAt: string; durationMs: number; ok: boolean }> = {}
      const roles = validateRoleDefaults(inputData.snapshot.roles, { allowSameService: inputData.snapshot.allowSameService })
      for (const [role, selection] of Object.entries(roles) as Array<[DeliveryRole, typeof roles[DeliveryRole]]>) {
        activity?.recordRoleDispatch(role === 'fixReviewer' ? 'crashReviewer' : role)
        const startedAt = new Date().toISOString()
        const started = performance.now()
        try {
          const prompt = promptForRole(role, inputData.snapshot.issueId, { ...results })
          if (selection.route === 'commandcode') {
            const key = commandCodeKey()
            if (!key) throw new Error('CommandCode secret reference did not resolve')
            activity?.recordLlmInference()
            const result = await createCommandCodeAgent(selection, key).generate(prompt)
            if (result.finishReason === 'length') throw new Error(`${role} output was truncated by the model limit`)
            results[role] = result.text
          } else {
            if (selection.route === 'openai-codex') throw new Error('ChatGPT subscription models use the stock Start build, not the legacy delivery workflow')
            await selectAcpModel(routes, selection)
            activity?.recordLlmInference()
            const result = await routes[selection.route].generate(prompt)
            if (result.finishReason === 'length') throw new Error(`${role} output was truncated by the model limit`)
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
