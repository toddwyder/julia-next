import type { z } from 'zod/v4'

import { InitializationActivitySchema } from './contracts.ts'

type Activity = z.infer<typeof InitializationActivitySchema>
type DeliveryRole = keyof Activity['roleDispatches']
type ActivityEvent =
  | { event: 'initialization-role-dispatch'; role: DeliveryRole }
  | { event: 'initialization-llm-inference' }
  | { event: 'initialization-linear-operation'; operation: 'query' | 'mutation' }

export function createInitializationActivityRecorder(onEvent: (event: ActivityEvent) => void = () => {}) {
  const events: ActivityEvent[] = []
  const record = (event: ActivityEvent) => {
    events.push(event)
    onEvent(event)
  }
  return {
    recordRoleDispatch: (role: DeliveryRole) => { record({ event: 'initialization-role-dispatch', role }) },
    recordLlmInference: () => { record({ event: 'initialization-llm-inference' }) },
    recordLinearQuery: () => { record({ event: 'initialization-linear-operation', operation: 'query' }) },
    recordLinearMutation: () => { record({ event: 'initialization-linear-operation', operation: 'mutation' }) },
    snapshot: () => InitializationActivitySchema.parse(events.reduce<Activity>((activity, event) => {
      if (event.event === 'initialization-role-dispatch') activity.roleDispatches[event.role] += 1
      if (event.event === 'initialization-llm-inference') activity.llmInferenceCalls += 1
      if (event.event === 'initialization-linear-operation') activity[event.operation === 'query' ? 'linearQueries' : 'linearMutations'] += 1
      return activity
    }, {
      roleDispatches: { builder: 0, reviewer: 0, crashFixer: 0, crashReviewer: 0 },
      llmInferenceCalls: 0,
      linearQueries: 0,
      linearMutations: 0,
    })),
  }
}

export type InitializationActivityRecorder = ReturnType<typeof createInitializationActivityRecorder>

export type LinearQueryClient = {
  query: (document: string, variables: Record<string, unknown>) => Promise<Response>
}

export function createObservedLinearClient(apiKey: string, activity: InitializationActivityRecorder, fetchImpl: typeof fetch = fetch) {
  const request = async (operation: 'query' | 'mutation', document: string, variables: Record<string, unknown>) => {
    if (operation === 'query') activity.recordLinearQuery()
    else activity.recordLinearMutation()
    return fetchImpl('https://api.linear.app/graphql', {
      method: 'POST', headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: document, variables }),
    })
  }
  return {
    query: (document: string, variables: Record<string, unknown>) => request('query', document, variables),
    mutate: (document: string, variables: Record<string, unknown>) => request('mutation', document, variables),
  }
}
