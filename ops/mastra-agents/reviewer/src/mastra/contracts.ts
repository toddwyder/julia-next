import { z } from 'zod/v4'

const nonempty = z.string().trim().min(1)
export const RouteSchema = z.enum(['antigravity', 'claude', 'commandcode'])

export const SecretReferenceSchema = z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,63}$/, 'secret references must be environment names, never values')

export const ConnectionRecordSchema = z.object({
  id: nonempty,
  route: RouteSchema,
  company: nonempty,
  service: nonempty,
  enabled: z.boolean(),
  secretReference: SecretReferenceSchema.optional(),
  lastTest: z.object({ ok: z.boolean(), testedAt: z.string().datetime(), modelCount: z.number().int().nonnegative() }).optional(),
}).strict()

export const ModelOfferSchema = z.object({
  route: RouteSchema,
  modelId: nonempty,
  name: nonempty,
  company: nonempty,
  service: nonempty,
  codingCapable: z.literal(true),
  wire: z.enum(['chat', 'responses', 'messages']).optional(),
}).strict()

export const ModelSelectionSchema = ModelOfferSchema.pick({ route: true, modelId: true, company: true, service: true, wire: true }).superRefine((selection, context) => {
  if (selection.route === 'claude' && !selection.modelId.startsWith('claude-')) {
    context.addIssue({ code: 'custom', path: ['modelId'], message: 'Claude selections require a full provider model ID beginning with claude-' })
  }
})
export const RoleDefaultsSchema = z.object({
  builder: ModelSelectionSchema,
  reviewer: ModelSelectionSchema,
  crashFixer: ModelSelectionSchema,
  fixReviewer: ModelSelectionSchema,
}).strict()

const requiredSections = ['Outcome', 'Requirements', 'Contracts', 'Finish conditions', 'Proof'] as const
const markdownHeading = /^#{1,6}(?:[ \t]+.*)?$/im
export const CardAdmissionSchema = z.object({
  identifier: z.string().regex(/^[A-Z][A-Z0-9]*-\d+$/),
  state: nonempty,
  description: nonempty,
}).strict().superRefine((card, context) => {
  if (card.state !== 'Ready') {
    context.addIssue({ code: 'custom', path: ['state'], message: 'expected Ready state' })
  }
  for (const section of requiredSections) {
    const title = section.replace(' ', '[ \\t]+')
    const pattern = new RegExp(`^#{1,6}[ \\t]+${title}[ \\t]*$`, 'im')
    const heading = pattern.exec(card.description)
    if (!heading) {
      context.addIssue({ code: 'custom', path: ['description'], message: `missing nonempty ${section} section` })
      continue
    }
    const content = card.description.slice(heading.index + heading[0].length).split(markdownHeading)[0]?.trim()
    if (!content) context.addIssue({ code: 'custom', path: ['description'], message: `empty ${section} section` })
  }
  const decisionText = card.description.replace(/\bno\s+unresolved(?:[\s-]+)decisions?(?:\s+markers?)?\b/gi, '')
  if (/\b(?:TODOs?|TBDs?|unresolved(?:[\s-]+)decisions?(?:\s+markers?)?)\b/i.test(decisionText)) {
    context.addIssue({ code: 'custom', path: ['description'], message: 'unresolved decision marker' })
  }
})

export const RunSnapshotSchema = z.object({ issueId: nonempty, roles: RoleDefaultsSchema, allowSameService: z.boolean().default(false), savedAt: z.string().datetime() }).strict().readonly()
export const DeliveryStartSchema = z.object({ decision: z.literal('Start'), authorized: z.literal(true), snapshot: RunSnapshotSchema }).strict()
export const WorkflowInputSchema = DeliveryStartSchema
export const RouteTraceSchema = z.object({ route: RouteSchema, modelId: nonempty, startedAt: z.string().datetime(), durationMs: z.number().nonnegative(), ok: z.boolean(), error: nonempty.optional() }).strict()
export const WorkflowOutputSchema = z.object({ status: z.enum(['completed', 'failed']), runId: nonempty, results: z.record(z.string(), nonempty), traces: z.record(z.string(), RouteTraceSchema) }).strict()
export const WorkflowSnapshotSchema = z.object({ runId: nonempty, input: WorkflowInputSchema, output: WorkflowOutputSchema.optional() }).strict()

export const ConnectionsCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }),
  z.object({ action: z.literal('add'), record: ConnectionRecordSchema }),
  z.object({ action: z.literal('reconnect'), id: nonempty, secretReference: SecretReferenceSchema.optional() }),
  z.object({ action: z.enum(['test', 'disable', 'remove']), id: nonempty }),
])
export const ConnectionsResultSchema = z.object({ ok: z.boolean(), records: z.array(ConnectionRecordSchema), message: nonempty.optional() }).strict()
export const ModelsCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }),
  z.object({ action: z.literal('save'), defaults: RoleDefaultsSchema }),
])
export const ModelsResultSchema = z.object({ offers: z.array(ModelOfferSchema), defaults: RoleDefaultsSchema.optional() }).strict()
export const InitCommandSchema = z.object({ issueId: z.string().regex(/^[A-Z][A-Z0-9]*-\d+$/), decision: z.enum(['Start', 'Cancel']).optional(), allowSameService: z.boolean().optional() }).strict()
export const RoleLimitsSchema = z.object({ builderUsd: z.literal(2), reviewerUsd: z.literal(1), crashFixerUsd: z.literal(0.5), fixReviewerUsd: z.literal(0.25), builderMinutes: z.literal(90), reviewerMinutes: z.literal(30), crashFixerMinutes: z.literal(20), fixReviewerMinutes: z.literal(10) }).strict()
export const InitResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('awaiting-decision'), issueId: nonempty, choices: RoleDefaultsSchema, limits: RoleLimitsSchema }).strict(),
  z.object({ status: z.literal('cancelled'), issueId: nonempty }).strict(),
  z.object({ status: z.literal('started'), resumed: z.boolean(), snapshotPath: nonempty, choices: RoleDefaultsSchema, limits: RoleLimitsSchema, snapshot: RunSnapshotSchema, delivery: z.unknown() }).strict(),
])
