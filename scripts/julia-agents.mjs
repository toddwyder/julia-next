// op 2.40.0: https://www.1password.dev/cli/secrets-environment-variables
// Thin server bootstrap; op owns authentication, reference resolution and masking.
import { readFileSync,statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve,dirname } from 'node:path'
export const agentsTokenPath='/home/ubuntu/.config/julia-agents/service-account-token'
const referencesPath=fileURLToPath(new URL('./julia-agents.env',import.meta.url))
const fields=new Set(['COMMANDCODE_API_KEY','LINEAR_API_KEY','SENTRY_AUTH_TOKEN','NEXT_PUBLIC_SENTRY_DSN','SENTRY_ORG','SENTRY_PROJECT','AXIOM_TOKEN','AXIOM_DATASET'])
export function runAgentsCommand(argv,{tokenPath=agentsTokenPath,environment=process.env}={}){
 try{
  if(!Array.isArray(argv)||!argv.length||argv.some(s=>typeof s!=='string'||!s))throw Error()
  const file=statSync(tokenPath),directory=statSync(dirname(tokenPath))
  if(file.uid!==process.getuid()||(file.mode&0o777)!==0o600||directory.uid!==process.getuid()||(directory.mode&0o777)!==0o700)throw Error()
  const token=readFileSync(tokenPath,'utf8').trim()
  if(!token)throw Error()
  const env=Object.fromEntries(Object.entries(environment).filter(([key,value])=>!key.startsWith('OP_')&&!fields.has(key)&&!value.startsWith('op://')))
  Object.assign(env,{OP_SERVICE_ACCOUNT_TOKEN:token,OP_BIOMETRIC_UNLOCK_ENABLED:'false',OP_CACHE:'false'})
  const auth=spawnSync('op',['user','get','--me','--format=json'],{env,encoding:'utf8',timeout:30000})
  if(auth.status!==0||auth.error||JSON.parse(auth.stdout).type!=='SERVICE_ACCOUNT')throw Error()
  const child=spawnSync('op',['run','--env-file',referencesPath,'--',...argv],{env,stdio:'inherit',timeout:undefined})
  if(child.error)throw Error()
  return child.status??1
 }catch{
  console.error('provider unavailable')
  return 1
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2)
 if(args[0]==='--')args.shift()
 process.exitCode=runAgentsCommand(args)
}
