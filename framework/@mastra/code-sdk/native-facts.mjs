// Public stock SDK session/settings interfaces; never sends inference.
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sdk,withoutModel } from './framework-runtime.mjs'
export const selectedModel='direct-learning/reflection/beam:free'
export async function withNative(body){
 return withoutModel(async()=>{
  const directory=await mkdtemp(join(tmpdir(),'framework-native-direct-'))
  const prior=process.env.MASTRA_APP_DATA_DIR
  process.env.MASTRA_APP_DATA_DIR=directory
  let runtime
  try{
   const {loadSettings,saveSettings}=await sdk('onboarding/settings.js')
   const {upsertCustomProviderInSettings}=await sdk('onboarding/custom-providers.js')
   const settings=loadSettings()
   upsertCustomProviderInSettings(settings,{name:'Direct learning',url:'https://api.commandcode.ai/provider/v1',models:['reflection/beam:free']})
   saveSettings(settings)
   const {bootLocalAgentController,runMC}=await sdk('index.js')
   runtime=await bootLocalAgentController({cwd:directory,homeDir:directory})
   return await body({runtime,runMC,directory,loadSettings,saveSettings})
  }finally{if(runtime){await runtime.controller.destroy();await runtime.observability.shutdown()}if(prior===undefined)delete process.env.MASTRA_APP_DATA_DIR;else process.env.MASTRA_APP_DATA_DIR=prior;await rm(directory,{recursive:true,force:true})}
 })
}
