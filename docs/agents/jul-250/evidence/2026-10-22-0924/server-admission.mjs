import assert from 'node:assert/strict'
import { CardAdmissionSchema } from '../../../../../ops/mastra-agents/reviewer/src/mastra/contracts.ts'
import { cardAdmissionInput,fetchLinearIssue } from '../../../../../ops/mastra-agents/reviewer/src/mastra/linear.ts'
assert.ok(process.env.LINEAR_API_KEY)
const broken=process.argv.includes('--broken')
let refused=false
for(const id of ['JUL-250','JUL-249']){
 const issue=await fetchLinearIssue(id,process.env.LINEAR_API_KEY)
 if(broken){const original=issue.description;issue.description=issue.description.replace(/^## Acceptance criteria\n[\s\S]*?(?=^## Proof\n)/m,'');assert.notEqual(issue.description,original)}
 const result=CardAdmissionSchema.safeParse({...cardAdmissionInput(issue),state:'Ready'})
 const issues=result.success?[]:result.error.issues.map(e=>e.message)
 console.log(JSON.stringify({id,broken,admitted:result.success,issues,source:'actual live Linear read through documented server op run route'}))
 assert.deepEqual(issues,broken?['missing nonempty Acceptance criteria section']:[])
 refused ||= !result.success
}
process.exitCode=refused?1:0
