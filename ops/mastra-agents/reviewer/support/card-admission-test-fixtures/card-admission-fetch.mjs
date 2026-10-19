import { completeCardDescription } from './card-admission-descriptions.mjs'

globalThis.fetch = async (_url, init) => {
  const { variables } = JSON.parse(init.body)
  const complete = variables.id !== 'JUL-244'
  return new Response(JSON.stringify({
    data: {
      issue: {
        identifier: variables.id,
        title: 'CLI fixture',
        description: complete ? completeCardDescription : '## Outcome\n\nOne.',
        state: { name: 'Triage' },
      },
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
