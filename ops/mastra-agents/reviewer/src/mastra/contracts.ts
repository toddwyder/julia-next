import { z } from 'zod/v4'

const nonempty = z.string().trim().min(1)
export const RouteSchema = z.enum(['antigravity', 'claude', 'commandcode'])
export const EffortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max'])

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
  supportedEfforts: z.array(EffortSchema).min(1),
  wire: z.enum(['chat', 'responses', 'messages']).optional(),
}).strict()

const modelSelectionShape = ModelOfferSchema.pick({ route: true, modelId: true, company: true, service: true, wire: true }).shape
function validateModelSelection(selection: { route: z.infer<typeof RouteSchema>; modelId: string }, context: z.RefinementCtx) {
  if (selection.route === 'claude' && !selection.modelId.startsWith('claude-')) {
    context.addIssue({ code: 'custom', path: ['modelId'], message: 'Claude selections require a full provider model ID beginning with claude-' })
  }
}
export const ModelSelectionSchema = z.object(modelSelectionShape).strict().superRefine(validateModelSelection)
export const RoleSelectionSchema = z.object({ ...modelSelectionShape, effort: EffortSchema }).strict().superRefine(validateModelSelection)
export const InitializationRolesSchema = z.object({
  builder: RoleSelectionSchema,
  reviewer: RoleSelectionSchema,
  crashFixer: RoleSelectionSchema,
  crashReviewer: RoleSelectionSchema,
}).strict()
export const RoleDefaultsSchema = z.object({
  builder: ModelSelectionSchema,
  reviewer: ModelSelectionSchema,
  crashFixer: ModelSelectionSchema,
  fixReviewer: ModelSelectionSchema,
}).strict()

const requiredSections = ['Outcome', 'Requirements', 'Contracts', 'Finish conditions', 'Proof'] as const
const requiredAgentBriefFields = ['Category', 'Summary', 'Current behavior', 'Desired behavior', 'Key interfaces', 'Acceptance criteria', 'Out of scope'] as const
const markdownHeading = /^#{1,6}(?:[ \t]+.*)?$/im

function validateCardAdmission(card: { state: string; description: string }, context: z.RefinementCtx) {
  if (card.state !== 'Ready') {
    context.addIssue({ code: 'custom', path: ['state'], message: 'expected Ready state' })
  }
  if (/^##[ \t]+Agent Brief[ \t]*$/im.test(card.description)) {
    for (const field of requiredAgentBriefFields) {
      const label = field.replace(' ', '[ \\t]+')
      const pattern = new RegExp(`^\\*\\*${label}:\\*\\*[ \\t]*(.*)$`, 'im')
      const match = pattern.exec(card.description)
      const inline = match?.[1]?.trim()
      const following = match ? card.description.slice(match.index + match[0].length).split(/^\*\*[^\n]+:\*\*/m)[0]?.trim() : ''
      if (!match || (!inline && !following)) {
        context.addIssue({ code: 'custom', path: ['description'], message: `missing nonempty ${field} field` })
      }
    }
  } else {
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
  }
  const decisionText = card.description.replace(/\b(?:no|rejects?)\s+unresolved(?:[\s-]+)decisions?(?:\s+markers?)?\b/gi, '')
  if (/\b(?:TODOs?|TBDs?|unresolved(?:[\s-]+)decisions?(?:\s+markers?)?)\b/i.test(decisionText)) {
    context.addIssue({ code: 'custom', path: ['description'], message: 'unresolved decision marker' })
  }
}

const cardIdentityShape = {
  identifier: z.string().regex(/^[A-Z][A-Z0-9]*-\d+$/),
  state: nonempty,
  description: nonempty,
}

export const CardAdmissionSchema = z.object(cardIdentityShape).strict().superRefine(validateCardAdmission)
export const ReadyCardSchema = z.object({ ...cardIdentityShape, title: nonempty }).strict().superRefine(validateCardAdmission)

export const ControlPageStateSchema = z.object({ cards: z.array(ReadyCardSchema), offers: z.array(ModelOfferSchema).min(1) }).strict()
export const StartInitializationSchema = z.object({ card: ReadyCardSchema, roles: InitializationRolesSchema }).strict()
export const InitializationInputSchema = StartInitializationSchema.extend({ runId: nonempty, initializedAt: z.string().datetime() }).strict()
export const RunSnapshotSchema = z.object({
  runId: nonempty,
  card: ReadyCardSchema,
  roles: InitializationRolesSchema,
  state: z.literal('ready-for-build'),
  initializedAt: z.string().datetime(),
}).strict().readonly()
export const ReadyForBuildSchema = z.object({ state: z.literal('ready-for-build'), snapshot: RunSnapshotSchema }).strict().readonly()
export const InitializationResultSchema = z.object({
  runId: nonempty,
  state: z.literal('ready-for-build'),
  snapshot: RunSnapshotSchema,
  resumed: z.boolean(),
}).strict()
export const InitializationRunsStateSchema = z.object({
  runs: z.array(InitializationResultSchema),
  totalRuns: z.number().int().nonnegative(),
}).strict().superRefine((value, context) => {
  if (value.runs.length !== value.totalRuns) {
    context.addIssue({ code: 'custom', path: ['totalRuns'], message: 'totalRuns must match the complete persisted run collection' })
  }
})
export const InitializationActivitySchema = z.object({
  roleDispatches: z.object({
    builder: z.number().int().nonnegative(),
    reviewer: z.number().int().nonnegative(),
    crashFixer: z.number().int().nonnegative(),
    crashReviewer: z.number().int().nonnegative(),
  }).strict(),
  llmInferenceCalls: z.number().int().nonnegative(),
  linearQueries: z.number().int().nonnegative(),
  linearMutations: z.number().int().nonnegative(),
}).strict()
export const InitializationBoundaryStateSchema = InitializationRunsStateSchema.extend({
  activity: InitializationActivitySchema,
}).strict()

export const DeliveryRunSnapshotSchema = z.object({ issueId: nonempty, roles: RoleDefaultsSchema, allowSameService: z.boolean().default(false), savedAt: z.string().datetime() }).strict().readonly()
export const DeliveryStartSchema = z.object({ decision: z.literal('Start'), authorized: z.literal(true), snapshot: DeliveryRunSnapshotSchema }).strict()
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
  z.object({ status: z.literal('started'), resumed: z.boolean(), snapshotPath: nonempty, choices: RoleDefaultsSchema, limits: RoleLimitsSchema, snapshot: DeliveryRunSnapshotSchema, delivery: z.unknown() }).strict(),
])
