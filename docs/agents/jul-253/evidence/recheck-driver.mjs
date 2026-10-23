import {readFile,writeFile} from 'node:fs/promises';
import {CardLedger} from '/home/ubuntu/julia-jul-253/ops/build-runner/ledger.mjs';
import {createTransport} from '/home/ubuntu/julia-jul-253/ops/build-runner/transport.mjs';
const root='/home/ubuntu/julia-jul-253';
const settings=JSON.parse(await readFile(root+'/ops/build-runner/machine-settings.json','utf8'));
const key='commandcode/deepseek/deepseek-v4.1-flash';
settings.models[key].maxOutputTokens=16384;
const paths=['ops/build-runner/ledger.mjs','ops/build-runner/pstack-session.mjs','ops/build-runner/worker.mjs','ops/build-runner/test/ledger.test.mjs','ops/build-runner/test/pstack-session.test.mjs'];
const packet=(await Promise.all(paths.map(async p=>'FILE '+p+'\n'+await readFile(root+'/'+p,'utf8')))).join('\n\n');
const spec=`Fresh DeepSeek recheck of JUL-253's two review findings. Return under 700 words. No tools are available; label counterexamples STATIC TRACES, not executed tests. Previous review found D1: maximum-charged unknown requests could later settle downward. D2: any different review model could replace the configured Sol+DeepSeek panel. New code should make maximum-charge recovery terminal for settle(), and derive two required review models from pstack configuration, pass them through worker and require both successful handoffs targeting changed files. Inspect all supplied code to confirm these repairs and flag only concrete remaining defects. Retain unit/proof limitations. Tests for both were run red before fixes and green afterward. The expanded mutation suite catches 45 injected defects including removing each fix, final restored suite green. Subscription sign-ins remain unauthorized, so their proof and full end-to-end acceptance are UNVERIFIED and cannot be approved. Claude may be used for the separately planned evidence review, but cannot replace an internal configured-panel member. The unknown recovery consumes the full existing reserved maximum and explicitly leaves actual usage unknown; no cap increase, no budget release. Overall acceptance stays INCONCLUSIVE if no code blockers remain. State whether D1 and D2 are fixed, trace the failure attempts, and give Standards/Spec and five standards checks briefly. Native Codex chat cost is outside the machine ledger and must not be claimed as counted. Todd accepted admin/config/control-pass risks; don't invent safeguards for them.

`;
const ledger=new CardLedger({path:settings.ledgerPath,card:'JUL-253'});
const before=ledger.snapshot();
try{
 const guarded=createTransport({settings,ledger,role:'review',fetch:async (...args)=>{const response=await fetch(...args);if(!response.ok){let body;try{body=await response.clone().json()}catch{};console.error(JSON.stringify({upstreamStatus:response.status,errorCode:body?.error?.code,errorParam:body?.error?.param}))}return response}});
 const response=await guarded(settings.models[key].endpoint,{method:'POST',headers:{'content-type':'application/json',Authorization:`Bearer ${process.env.COMMANDCODE_API_KEY}`},body:JSON.stringify({model:settings.models[key].wireModel,messages:[{role:'user',content:spec+packet}],reasoning_effort:'low',stream:false}),signal:AbortSignal.timeout(240000)});
 const body=await response.json();
 console.log(JSON.stringify({status:response.status,model:body.model,report:body.choices?.[0]?.message?.content,finishReason:body.choices?.[0]?.finish_reason,usage:body.usage,account:ledger.snapshot(),costNano:Number(ledger.snapshot().spentNano)-Number(before.spentNano)},null,2));
}finally{ledger.close()}
