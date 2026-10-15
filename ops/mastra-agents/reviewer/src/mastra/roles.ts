import { RoleDefaultsSchema } from './contracts.ts'
import type { z } from 'zod/v4'

type RoleDefaults = z.infer<typeof RoleDefaultsSchema>

export function validateRoleDefaults(input: RoleDefaults, options: { allowSameService?: boolean } = {}) {
  const roles = RoleDefaultsSchema.parse(input)
  if (roles.builder.company.toLowerCase() === roles.reviewer.company.toLowerCase()) {
    throw new Error('builder and reviewer must use different companies')
  }
  if (!options.allowSameService && roles.builder.service.toLowerCase() === roles.reviewer.service.toLowerCase()) {
    throw new Error('builder and reviewer must normally use different services')
  }
  if (roles.crashFixer.company.toLowerCase() === roles.fixReviewer.company.toLowerCase()) {
    throw new Error('crash-fixer and fix reviewer must use different companies')
  }
  return roles
}
