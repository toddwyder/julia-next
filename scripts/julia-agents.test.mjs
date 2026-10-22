import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtempSync,writeFileSync,chmodSync,existsSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const script=fileURLToPath(new URL('./julia-agents.mjs',import.meta.url))
test('server agents route resolves all eight fields and forwards literal arguments through real op',()=>{
 const child="const assert=require('node:assert/strict');for(const k of ['COMMANDCODE_API_KEY','LINEAR_API_KEY','SENTRY_AUTH_TOKEN','NEXT_PUBLIC_SENTRY_DSN','SENTRY_ORG','SENTRY_PROJECT','AXIOM_TOKEN','AXIOM_DATASET'])assert.ok(process.env[k]&&!process.env[k].startsWith('op://'));assert.equal(process.argv[1],'literal ; $(do-not-run)');console.log('resolved eight fields; literal argv received')"
 const result=spawnSync(process.execPath,[script,'--',process.execPath,'-e',child,'literal ; $(do-not-run)'],{encoding:'utf8',timeout:60000})
 assert.equal(result.status,0,result.stderr)
 assert.equal(result.stdout.trim(),'resolved eight fields; literal argv received')
})
test('unavailable agent passes fail before child effects without inherited authentication fallback',()=>{
 const directory=mkdtempSync(join(tmpdir(),'julia-agents-pass-'))
 chmodSync(directory,0o700)
 try{
  for(const scenario of ['missing','empty','unreadable','invalid']){
   const token=join(directory,scenario),marker=join(directory,`${scenario}.child`)
   if(scenario!=='missing')writeFileSync(token,scenario==='empty'?'':'ops_invalid_test_pass',{mode:scenario==='unreadable'?0o000:0o600})
   const args=[process.execPath,'-e',`require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran')`]
   const invoke=`import {runAgentsCommand} from ${JSON.stringify(new URL('./julia-agents.mjs',import.meta.url).href)};process.exitCode=runAgentsCommand(${JSON.stringify(args)},{tokenPath:${JSON.stringify(token)}})`
   const result=spawnSync(process.execPath,['--input-type=module','-e',invoke],{encoding:'utf8',timeout:45000,env:{...process.env,OP_SERVICE_ACCOUNT_TOKEN:'inherited-account-must-not-be-used',OP_CONNECT_HOST:'http://127.0.0.1:9',OP_CONNECT_TOKEN:'inherited-connect-must-not-be-used'}})
   assert.equal(result.status,1,scenario)
   assert.equal(result.stdout,'',scenario)
   assert.equal(result.stderr.trim(),'provider unavailable',scenario)
   assert.equal(existsSync(marker),false,scenario)
  }
 }finally{rmSync(directory,{recursive:true,force:true})}
})
test('real op ignores inherited desktop Connect and no-masking overrides and preserves child exit',()=>{
 const child="const assert=require('node:assert/strict');for(const k of ['OP_CONNECT_HOST','OP_CONNECT_TOKEN','OP_SESSION_test','OP_RUN_NO_MASKING','OP_CONFIG_DIR'])assert.equal(process.env[k],undefined);assert.notEqual(process.env.COMMANDCODE_API_KEY,'stale-key');console.log('child-result');process.exit(23)"
 const result=spawnSync(process.execPath,[script,'--',process.execPath,'-e',child],{encoding:'utf8',timeout:60000,env:{...process.env,OP_CONNECT_HOST:'http://127.0.0.1:9',OP_CONNECT_TOKEN:'bad-connect',OP_SESSION_test:'bad-session',OP_CONFIG_DIR:'/nonexistent/bad-op-config',OP_RUN_NO_MASKING:'1',COMMANDCODE_API_KEY:'stale-key'}})
 assert.equal(result.status,23,result.stderr)
 assert.equal(result.stdout.trim(),'child-result')
})
