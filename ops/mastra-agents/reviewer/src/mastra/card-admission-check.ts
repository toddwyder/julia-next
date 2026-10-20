import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CardAdmissionSchema } from './contracts.ts'
import { cardAdmissionInput, fetchLinearIssue } from './linear.ts'

export type CardAdmissionResult = {
  identifier: string
  currentState: string
  admitted: boolean
  issues: string[]
}

export async function checkLinearCardAdmission(
  issueId: string,
  apiKey = process.env.LINEAR_API_KEY,
  fetchImpl: typeof fetch = fetch,
): Promise<CardAdmissionResult> {
  if (!apiKey) throw new Error('LINEAR_API_KEY was not resolved by the Julia vault launcher')
  const issue = await fetchLinearIssue(issueId, apiKey, fetchImpl)
  const candidate = CardAdmissionSchema.safeParse({
    ...cardAdmissionInput(issue),
    state: 'Ready',
  })
  return {
    identifier: issue.identifier,
    currentState: issue.state.name,
    admitted: candidate.success,
    issues: candidate.success ? [] : candidate.error.issues.map(finding => finding.message),
  }
}

async function main() {
  const issueIds = process.argv.slice(2)
  if (issueIds.length === 0) throw new Error('usage: card-admission-check.ts JUL-nnn [JUL-nnn ...]')
  const results = await Promise.all(issueIds.map(issueId => checkLinearCardAdmission(issueId)))
  console.log(JSON.stringify(results, null, 2))
  if (results.some(result => !result.admitted)) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
