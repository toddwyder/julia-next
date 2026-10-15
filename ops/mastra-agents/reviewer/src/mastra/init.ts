import { readFile } from 'node:fs/promises'
import { ModelOfferSchema, RoleDefaultsSchema, RunSnapshotSchema } from './contracts.ts'
import { validateRoleDefaults } from './roles.ts'
import type { z } from 'zod/v4'

type RoleDefaults = z.infer<typeof RoleDefaultsSchema>

export function validateStartPreconditions({ authorized, roles, records, offers }: {
  authorized: boolean
  roles: RoleDefaults
  records: Array<{ route: string; enabled: boolean; lastTest?: { ok: boolean } }>
  offers: Array<{ route: string; modelId: string }>
}, options: { allowSameService?: boolean } = {}) {
  if (!authorized) throw new Error('start authorization is missing')
  const validated = validateRoleDefaults(roles, options)
  for (const selection of Object.values(validated)) {
    const connection = records.find(item => item.route === selection.route)
    if (!connection?.enabled || connection.lastTest?.ok !== true) throw new Error(`${selection.route} connection is disabled, failed, or stale`)
  }
  return ensureSelectionsOffered(validated, offers)
}

export function ensureSelectionsOffered(roles: RoleDefaults, offers: unknown) {
  const parsedOffers = ModelOfferSchema.array().parse(offers)
  for (const [role, selection] of Object.entries(RoleDefaultsSchema.parse(roles))) {
    if (!parsedOffers.some(offer => offer.route === selection.route && offer.modelId === selection.modelId)) {
      throw new Error(`${role} selection ${selection.route}:${selection.modelId} is unavailable or stale`)
    }
  }
  return roles
}

export async function loadSavedSnapshot(path: string, issueId: string) {
  const saved = RunSnapshotSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  if (saved.issueId !== issueId) throw new Error('saved snapshot belongs to another card')
  validateRoleDefaults(saved.roles, { allowSameService: saved.allowSameService })
  return saved
}

export async function decideStart({ decision, snapshot, dispatch }: {
  decision: string
  snapshot: RoleDefaults
  dispatch: (snapshot: RoleDefaults) => Promise<unknown>
}) {
  if (decision === 'Cancel') return { status: 'cancelled' as const }
  if (decision !== 'Start') throw new Error('decision must be exactly Start or Cancel')
  const immutable = structuredClone(RoleDefaultsSchema.parse(snapshot))
  await dispatch(immutable)
  return { status: 'started' as const, snapshot: immutable }
}
