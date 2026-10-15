import { RoleDefaultsSchema } from './contracts.ts'
import type { z } from 'zod/v4'

type RoleDefaults = z.infer<typeof RoleDefaultsSchema>

export function ensureSelectionsOffered(roles: RoleDefaults, offers: Array<{ route: string; modelId: string }>) {
  for (const [role, selection] of Object.entries(RoleDefaultsSchema.parse(roles))) {
    if (!offers.some(offer => offer.route === selection.route && offer.modelId === selection.modelId)) {
      throw new Error(`${role} selection ${selection.route}:${selection.modelId} is unavailable or stale`)
    }
  }
  return roles
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
