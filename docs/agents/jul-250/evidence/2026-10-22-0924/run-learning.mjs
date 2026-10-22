// Rewritten framework facts are driven directly; only two model-side subjects use Beam.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
const root=resolve(fileURLToPath(new URL('../../../../../',import.meta.url)))
const base=fileURLToPath(new URL('./',import.meta.url))
const suite=join(root,'framework/@mastra/code-sdk')
const sources=Object.fromEntries(readdirSync(suite).filter(f=>f.endsWith('.mjs')).map(f=>[f,readFileSync(join(suite,f),'utf8')]))
const sha=s=>createHash('sha256').update(s).digest('hex')
const hashes=Object.fromEntries(Object.entries(sources).map(([f,s])=>[f,sha(s)]))
const cases=[
 {id:'post-hook',file:'after-write.test.mjs',target:'framework-runtime.mjs',before:'createToolHooks(manager,observer)',after:'createToolHooks(undefined,observer)',error:/ENOENT.*after-write/},
 {id:'pre-hook',file:'layer1.test.mjs',target:'framework-runtime.mjs',before:'createToolHooks(manager,observer)',after:'createToolHooks(undefined,observer)',error:/Expected|ERR_ASSERTION/},
 {id:'staged-guard',file:'layer2.test.mjs',target:'staged-guard.mjs',before:' if(!/tests 1/.test(check.stdout))',after:' check.status=0; // deliberately removed failed-check guard\n if(!/tests 1/.test(check.stdout))',error:/broken staged tree must never become a commit/},
 {id:'awaited-observer',file:'layer3.test.mjs',before:'{ observer: observe }',after:'{}',error:/Expected|ERR_ASSERTION/},
 {id:'push',file:'push-route.test.mjs',before:"    const command = 'git push",after:"    git(ctx.directory,'remote','remove','origin')\n    const command = 'git push",error:/Command failed: git ls-remote|origin.*does not appear/},
 {id:'native-memory',file:'native.test.mjs',name:'stock native memory retains the active thread without inference',target:'native-facts.mjs',before:'homeDir:directory})',after:'homeDir:directory,memory:false})',error:/getThreadById|undefined|null/},
 {id:'settings',file:'native.test.mjs',name:'stock settings persist through the same default file without inference',before:'  saveSettings(settings)\n  assert.equal',after:"  saveSettings(settings,join(directory,'wrong-settings.json'))\n  assert.equal",error:/12345|Expected|ERR_ASSERTION/},
 {id:'ordering',file:'native.test.mjs',name:'thread creation resets selection and selecting after the thread preserves it without inference',last:true,before:'  await runtime.session.model.switch(selectedModel)\n  assert.equal(runtime.session.model.get(),selectedModel)',after:'  // corrective switch removed\n  assert.equal(runtime.session.model.get(),selectedModel)',error:/Expected|ERR_ASSERTION/},
 {id:'local-refusal',file:'native.test.mjs',name:'explicit canonical model override refuses locally before any model request',before:'model:selectedModel,prompt:',after:'prompt:',error:/framework fact|Expected|ERR_ASSERTION/},
 {id:'memory-switch',file:'native.test.mjs',name:'public memory constructor enables and disables the real observational engine without inference',before:'observationalMemory:true',after:'observationalMemory:false',error:/enabled switch must construct/},
 {id:'request-resolution',file:'model-side.test.mjs',name:'saved model selection resolves to an actual Beam provider request',target:'real-route.mjs',before:'thread: { id: thread.id }, prompt: text',after:'thread: { id: thread.id }, model: savedModel, prompt: text',error:/Unknown model/},
 {id:'model-feedback',file:'model-side.test.mjs',name:'real Beam receives the actual refusal as a valid tool result and feedback without provider error',before:'{inputProcessors:[feedback]}',after:'{inputProcessors:[]}',error:/400|Expected|ERR_ASSERTION|tool.result/i},
 {id:'inconclusive-once',file:'model-attempt.test.mjs',target:'model-attempt.mjs',before:'attempt<=2',after:'attempt<=1',error:/1 !== 2|Expected|ERR_ASSERTION/},
]
const results=[]
for(const item of cases){
 const directory=mkdtempSync(join(tmpdir(),'framework-direct-red-'))
 try{
  for(const [name,text]of Object.entries(sources))writeFileSync(join(directory,name),text)
  const target=item.target??item.file,source=sources[target]
  const index=item.last?source.lastIndexOf(item.before):source.indexOf(item.before)
  assert.ok(index>=0,`missing mutation anchor ${item.id}`)
  const broken=source.slice(0,index)+item.after+source.slice(index+item.before.length)
  writeFileSync(join(directory,target),broken)
  for(const phase of ['red','green']){
   const args=['--test','--test-reporter=tap','--test-concurrency=1']
   if(item.name)args.push('--test-name-pattern',`^${item.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`)
   args.push(join(phase==='red'?directory:suite,item.file))
   const run=spawnSync(process.execPath,args,{cwd:root,env:{...process.env,JULIA_LEARNING_PHASE:`direct-${item.id}-${phase}`},encoding:'utf8',timeout:300000,maxBuffer:16*1024*1024})
   const text=(run.stdout??'')+(run.stderr??'')
   writeFileSync(join(base,`${item.id}-${phase}.stdout`),run.stdout??'');writeFileSync(join(base,`${item.id}-${phase}.stderr`),run.stderr??'')
   const skipped=Number(text.match(/^# skipped (\d+)/m)?.[1]??0)
   const row={id:item.id,file:item.file,name:item.name,phase,exit:run.status,skipped,classification:skipped?'INCONCLUSIVE':phase==='red'?'broken guard':'restored guard',guard:item.before,mutationSha256:sha(broken),sourceHashes:hashes}
   results.push(row);writeFileSync(join(base,'red-green-results.json'),JSON.stringify(results,null,2)+'\n')
   if(skipped){console.log('INCONCLUSIVE: model did not attempt; no guard pass/fail');process.exitCode=2;throw Error('inconclusive model test cannot satisfy guard proof')}
   assert.equal(run.status,phase==='red'?1:0,`${item.id} ${phase}: inspect retained output`)
   if(phase==='red')assert.match(text,item.error)
   assert.doesNotMatch(text,/HTTP 429|HTTP 403|temporarily unavailable/,'unavailable provider is not a guard verdict')
   console.log(JSON.stringify({id:item.id,phase,exit:run.status}))
  }
 }finally{rmSync(directory,{recursive:true,force:true})}
}
const direct=['after-write','layer1','layer2','layer3','native','push-route'].map(f=>join(suite,`${f}.test.mjs`))
const independent=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-concurrency=1',...direct],{cwd:root,env:{...process.env,FRAMEWORK_MODEL:'an-unrelated-configured-model',JULIA_LEARNING_PHASE:'direct-model-independent'},encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024})
writeFileSync(join(base,'model-independent.stdout'),independent.stdout??'');writeFileSync(join(base,'model-independent.stderr'),independent.stderr??'');assert.equal(independent.status,0);assert.match(independent.stdout,/# tests 10\n/)
const files=Object.keys(sources).filter(f=>f.endsWith('.test.mjs'))
const full=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-concurrency=1',...files.map(f=>join(suite,f))],{cwd:root,env:{...process.env,JULIA_LEARNING_PHASE:'complete-suite-0924'},encoding:'utf8',timeout:600000,maxBuffer:32*1024*1024})
writeFileSync(join(base,'complete-suite.stdout'),full.stdout??'');writeFileSync(join(base,'complete-suite.stderr'),full.stderr??'')
const skipped=Number(full.stdout.match(/^# skipped (\d+)/m)?.[1]??0)
writeFileSync(join(base,'complete-suite-result.json'),JSON.stringify({exit:skipped?2:full.status,nodeExit:full.status,skipped,sourceHashes:hashes,frameworkFactTests:10,realModelTests:2,classifierTests:1,model:'reflection/beam:free'},null,2)+'\n')
assert.equal(full.status,0);assert.equal(skipped,0,'inconclusive is not a completed guard proof');assert.match(full.stdout,/# tests 13\n/);assert.match(full.stdout,/# pass 13\n/)
for(const [name,text]of Object.entries(sources))assert.equal(readFileSync(join(suite,name),'utf8'),text)
console.log('Complete suite: thirteen passed; ten framework facts without inference, two Beam-side cases, one classifier check')
