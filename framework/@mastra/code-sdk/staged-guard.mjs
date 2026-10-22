// Learning-only staged check; public SDK hook protocol, no production runner.
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {git} from './framework-runtime.mjs'
export const docs = 'https://nodejs.org/api/assert.html#assertstrictequalactual-expected-message'
export const fact = `BROKEN FACT: staged answer must equal 42. ${docs}`
export const fixture = `import assert from 'node:assert/strict'; import {answer} from './answer.mjs'; assert.equal(answer,42);\n`
export const hook = String.raw`
import {readFileSync,appendFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os'; import {join} from 'node:path'; import {execFileSync,spawnSync} from 'node:child_process';
const input=JSON.parse(readFileSync(0,'utf8'));
const cwd=PROBE_DIRECTORY;
const command=input.tool_input?.command ?? '';
if(!/\bgit\s+commit\b/.test(command)) process.exit(0);
const git=(...a)=>execFileSync('git',a,{cwd,encoding:'utf8'}).trim();
const tree=git('write-tree');
const snapshot=mkdtempSync(join(tmpdir(),'staged-check-'));
try {
 const archive=execFileSync('git',['archive',tree],{cwd});
 execFileSync('tar',['-xf','-','-C',snapshot],{input:archive});
 const checkEnv={...process.env}; delete checkEnv.NODE_TEST_CONTEXT;
 const check=spawnSync(process.execPath,['--test','answer.test.mjs'],{cwd:snapshot,encoding:'utf8',env:checkEnv});
 if(!/tests 1/.test(check.stdout)) throw new Error('Learning harness did not execute exactly one test: '+check.stdout+check.stderr);
 appendFileSync(join(cwd,'checks.jsonl'),JSON.stringify({tree,status:check.status,stdout:check.stdout,stderr:check.stderr})+'\n');
 if(check.status!==0) {
  console.log(JSON.stringify({reason:FACT})); process.exitCode=2;
 }
} catch(error) {
 console.log(JSON.stringify({reason:'Framework check could not run: '+error.message})); process.exitCode=2;
} finally {rmSync(snapshot,{recursive:true,force:true})}
`.replace('FACT', JSON.stringify(fact))

// Documented model-independent runner extension: preserve and encode actual
// hook-result data before real inference. Never returns a cached `response`.
// SDK dist/index.d.ts:45-52; core dist/processors/index.d.ts:329-358,685-706.
export const feedback = {
  id: 'runner-hook-refusal-feedback-learning',
  processLLMRequest({ prompt: messages }) {
    const changed = messages.map(message => {
      if (message.role !== 'tool') return message
      return { ...message, content: message.content.map(part => {
        if (part.type !== 'tool-result') return part
        console.log(JSON.stringify({fact:'actual-hook-tool-result-before-encoding',part}))
        const output = part.output
        if (['text','json','error-text','error-json','content'].includes(output?.type) && output.value !== undefined) return part
        return { ...part, output: { type:'text', value: JSON.stringify(output) } }
      }) }
    })
    return { prompt: changed }
  },
}


export async function setupStagedGuard(directory){
      git(directory,'init','-q'); git(directory,'config','user.name','Learning'); git(directory,'config','user.email','learning@example.invalid')
      await writeFile(join(directory,'answer.mjs'),'export const answer=42;\n')
      await writeFile(join(directory,'answer.test.mjs'),fixture)
      git(directory,'add','answer.mjs','answer.test.mjs'); git(directory,'commit','-qm','baseline')
      await mkdir(join(directory,'.mastracode'))
      await writeFile(join(directory,'.mastracode','check.mjs'),hook.replace('PROBE_DIRECTORY',JSON.stringify(directory)))
      await writeFile(join(directory,'.mastracode','hooks.json'),JSON.stringify({PreToolUse:[{type:'command',command:[process.execPath,join(directory,'.mastracode','check.mjs')].map(value=>"'"+value.replaceAll("'","'\"'\"'")+"'").join(' '),timeout:30000}]}))
      await writeFile(join(directory,'answer.mjs'),'export const answer=41;\n')
      git(directory,'add','answer.mjs')
      // Working copy is good, index is broken: a worktree check would wrongly pass.
      await writeFile(join(directory,'answer.mjs'),'export const answer=42;\n')

}
