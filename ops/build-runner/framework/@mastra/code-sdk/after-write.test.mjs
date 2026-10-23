import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { git,withFramework } from './framework-runtime.mjs'

// @mastra/code-sdk@1.14.0
// Documentation: dist/hooks/config.d.ts:1-11 (discovery);
// dist/hooks/types.d.ts:5-28,53-58,152-170 (PostToolUse input and stdout).
// dist/index.d.ts:43-44 and dist/agents/tools.d.ts:28 (observer is void).
// https://mastra.ai/reference/code-sdk/mount-agent-controller#parameters
// Fact: stock PostToolUse can run actual ESLint after a real file write, but its
// additionalContext/decision does not replace the public command output.
// The observed omission is a passing package fact, NOT passing immediate-feedback
// acceptance. No other session injection interface is substituted for this hook.
const marker = 'AFTER_WRITE_LINT_FAILED'
const eslint = join(process.cwd(), 'node_modules/eslint/bin/eslint.js')
test('public command runs PostToolUse lint without replacing command output',async()=>{
  await withFramework(async directory=>{
    git(directory, 'init', '-b', 'learning')
    await mkdir(join(directory, '.mastracode'))
    await writeFile(join(directory, 'eslint.config.mjs'), "export default [{rules:{'no-var':'error'}}]\n")
    const hook = join(directory, 'after-write.cjs')
    await writeFile(hook, `const fs=require('node:fs'),cp=require('node:child_process');const e=JSON.parse(fs.readFileSync(0,'utf8'));if(!fs.existsSync(${JSON.stringify(join(directory, 'written.mjs'))}))process.exit(0);const r=cp.spawnSync(${JSON.stringify(process.execPath)},[${JSON.stringify(eslint)},'--no-config-lookup','--config',${JSON.stringify(join(directory, 'eslint.config.mjs'))},${JSON.stringify(join(directory, 'written.mjs'))}],{cwd:${JSON.stringify(directory)},encoding:'utf8'});fs.appendFileSync(${JSON.stringify(join(directory, 'after-write.jsonl'))},JSON.stringify({event:e,status:r.status,stdout:r.stdout,stderr:r.stderr})+String.fromCharCode(10));console.log(JSON.stringify({decision:'block',reason:${JSON.stringify(marker)},additionalContext:${JSON.stringify(marker)}}));`)
    execFileSync(process.execPath, ['--check', hook])
    await writeFile(join(directory, '.mastracode/hooks.json'), JSON.stringify({ PostToolUse: [{ type: 'command', command: `${JSON.stringify(process.execPath)} ${JSON.stringify(hook)}` }] }))

  },async ctx=>{
    const output=await ctx.execute("printf 'var banned = 1;\\n' > written.mjs; printf write-complete")
    assert.equal(await readFile(join(ctx.directory,'written.mjs'),'utf8'),'var banned = 1;\n')
    const hooks=(await readFile(join(ctx.directory,'after-write.jsonl'),'utf8')).trim().split('\n').map(JSON.parse)
    assert.equal(hooks[0].event.hook_event_name,'PostToolUse')
    assert.equal(hooks[0].status,1)
    assert.match(hooks[0].stdout,/no-var/)
    assert.match(String(output),/write-complete/)
    assert.equal(String(output).includes(marker),false)
  })
})
