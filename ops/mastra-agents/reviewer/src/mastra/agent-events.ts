import { z } from 'zod/v4'

export const AgentLaunchSchema = z.object({
  launchId: z.string().min(1), provider: z.enum(['codex', 'commandcode', 'mastra']),
  providerRunId: z.string().min(1), cardIdentifier: z.string().regex(/^[A-Z][A-Z0-9]*-\d+$/),
  cardTitle: z.string().min(1), role: z.string().min(1), model: z.string().min(1),
  stage: z.string().min(1), round: z.number().int().positive(),
}).strict()
export const AgentEventSchema = z.object({
  launchId: z.string().min(1), eventId: z.string().min(1),
  kind: z.enum(['run-started', 'progress', 'action-started', 'action-completed', 'run-completed', 'run-failed', 'run-canceled', 'run-suspended', 'disconnected', 'unknown']),
  providerKind: z.string().min(1).max(160), providerStatus: z.string().max(160),
  occurredAt: z.string().datetime(),
  relatedRunIds: z.array(z.string().min(1)).optional(),
  launch: AgentLaunchSchema.optional(),
  action: z.object({ id: z.string().min(1), type: z.string().min(1).max(160), name: z.string().min(1).max(160), outcome: z.enum(['succeeded', 'failed', 'unknown']), actionKey: z.string().max(160).optional(), errorCode: z.string().max(160).optional(), errorCategory: z.string().max(160).optional() }).strict().optional(),
}).strict()
export type AgentLaunch = z.infer<typeof AgentLaunchSchema>
export type AgentEvent = z.infer<typeof AgentEventSchema>
