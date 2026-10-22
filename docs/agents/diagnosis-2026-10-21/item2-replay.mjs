// An assertion replay only: cannot identify the original refused requests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const root='/home/ubuntu/julia-jul-231';
const source=execFileSync('git',['show','dc7af2145f7407f2e616536053a19b3056845048:.agents/skills/verify-machine/drive-build.mjs'],{cwd:root,encoding:'utf8'});
assert.ok(source.includes('assert.deepEqual(consoleErrors, [])'));
const {consoleErrors}=JSON.parse(readFileSync(`${root}/docs/agents/jul-231/evidence/live-proof-2/failure.json`));
try { assert.deepEqual(consoleErrors, []); }
catch { console.log('REPLAY RED (historical assertion only): '+JSON.stringify(consoleErrors)); process.exitCode=1; }
