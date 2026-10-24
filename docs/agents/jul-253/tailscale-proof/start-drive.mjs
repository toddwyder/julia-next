import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require=createRequire('/home/ubuntu/julia-jul-253/ops/mastra-agents/reviewer/package.json');
const {chromium}=require('playwright');
const evidence=process.argv[3] ?? '/home/ubuntu/julia-jul-253-handoff/docs/agents/jul-253/tailscale-proof';
const url='https://ovh.tail91f394.ts.net/julia-control';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1365,height:1100}});
const page=await context.newPage();
const consoleEntries=[],pageErrors=[],network=[];
page.on('console',m=>consoleEntries.push({type:m.type(),text:m.text()}));
page.on('pageerror',e=>pageErrors.push(String(e)));
page.on('response',r=>{if(r.url().startsWith(url))network.push({url:r.url(),method:r.request().method(),status:r.status()})});
try{
 await page.goto(url,{waitUntil:'networkidle'});
 const stateResponse=await context.request.get(url+'/api/state');assert.equal(stateResponse.ok(),true);
 const state=await stateResponse.json();const index=state.cards.findIndex(e=>e.card.identifier==='JUL-254'&&e.admitted);assert.ok(index>=0);
 await page.locator('select[name="card"]').selectOption(String(index));
 for(const [label,value] of [['Orchestrator','openai-codex::gpt-6-sol'],['Coder','commandcode::deepseek/deepseek-v4.1-flash']]){
  const field=page.locator('fieldset').filter({has:page.locator('legend',{hasText:label})});await field.locator('select').first().selectOption(value);await field.locator('select').nth(1).selectOption('medium');
 }
 await page.screenshot({path:evidence+'/start-selected.png',fullPage:true});
 const waiting=page.waitForResponse(r=>r.request().method()==='POST'&&r.url()===url+'/api/start',{timeout:60000});
 await page.getByRole('button',{name:'Start',exact:true}).click();
 const response=await waiting;const body=await response.json();
 await writeFile(evidence+'/start-response.json',JSON.stringify({url:response.url(),status:response.status(),body},null,2));
 assert.equal(response.status(),200);assert.equal(body.build.state,'running');
 assert.equal(body.snapshot.card.identifier,'JUL-254');
 assert.equal(body.snapshot.roles.orchestrator.route,'openai-codex');
 assert.equal(body.snapshot.roles.coder.modelId,'deepseek/deepseek-v4.1-flash');
 assert.equal(body.build.baseCommit,process.argv[2]);
 await page.screenshot({path:evidence+'/start-running.png',fullPage:true});
 console.log(JSON.stringify({runId:body.runId,workerPid:body.build.workerPid,worktree:body.build.worktree,baseCommit:body.build.baseCommit,roles:body.snapshot.roles}));
}finally{
 await writeFile(evidence+'/start-browser.json',JSON.stringify({url,consoleEntries,pageErrors,network},null,2));
 await context.close();await browser.close();
}
