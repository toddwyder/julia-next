// @mastra/code-sdk@1.14.0 public hooks/index and agents/tools declarations.
// @mastra/core@1.78.0 public workspace exports; bundled
// reference-workspace-workspace-class.md: Tool hooks; createWorkspaceTools().
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile,mkdtemp,rm } from 'node:fs/promises'
import { join,resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
export const owner=resolve(process.env.FRAMEWORK_RUNNER_ROOT??'ops/build-runner')
export const ownerRequire=createRequire(join(owner,'package.json'))
const sdkDirectory=resolve(ownerRequire.resolve('@mastra/code-sdk/package.json'),'..')
const pkg=JSON.parse(await readFile(join(sdkDirectory,'package.json'),'utf8'))
const lock=JSON.parse(await readFile(process.env.FRAMEWORK_LOCKFILE??join(owner,'package-lock.json'),'utf8'))
assert.equal(pkg.version,'1.14.0');assert.equal(lock.packages['node_modules/@mastra/code-sdk'].version,'1.14.0')
export const sdk=subpath=>{
 const key=subpath==='index.js'?'.':`./${subpath.replace(/\.js$/,'')}`
 const entry=pkg.exports[key]??pkg.exports['./*']
 assert.ok(entry?.import?.default,`public SDK export missing: ${key}`)
 return import(pathToFileURL(join(sdkDirectory,entry.import.default.replace('*',key.slice(2)))))
}
export const core=subpath=>import(pathToFileURL(ownerRequire.resolve(`@mastra/core/${subpath}`)))
export const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
export async function withoutModel(body){
 const original=globalThis.fetch
 let inferenceAttempts=0
 globalThis.fetch=(input,init)=>{const url=String(input instanceof Request?input.url:input);if(/chat\/completions|\/responses|\/messages/.test(url)){inferenceAttempts++;throw Error('framework fact must not request a model')}return original(input,init)}
 try{return await body()}finally{globalThis.fetch=original;assert.equal(inferenceAttempts,0,'framework fact attempted inference');console.log(JSON.stringify({fact:'framework-only-drive',inferenceAttempts}))}
}
export async function withFramework(setup,body,{observer}={}){
 return withoutModel(async()=>{
  const directory=await mkdtemp(join(tmpdir(),'framework-direct-'))
  let workspace
  try{
   await setup(directory)
   const {HookManager}=await sdk('hooks/index.js')
   const {createToolHooks}=await sdk('agents/tools.js')
   const {Workspace,LocalFilesystem,LocalSandbox,createWorkspaceTools}=await core('workspace')
   const manager=new HookManager(directory,'direct-learning','.mastracode',directory)
   workspace=new Workspace({filesystem:new LocalFilesystem({basePath:directory}),sandbox:new LocalSandbox({workingDirectory:directory}),tools:{hooks:createToolHooks(manager,observer),mastra_workspace_execute_command:{name:'execute_command'}}})
   await workspace.init()
   const tools=await createWorkspaceTools(workspace)
   assert.ok(tools.execute_command?.execute,'public workspace command tool required')
   return await body({directory,manager,execute:command=>tools.execute_command.execute({command},{})})
  }finally{if(workspace)await workspace.destroy();await rm(directory,{recursive:true,force:true})}
 })
}
