// Read-only: same owner createRequire seam used by real-route.mjs.
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
const owner='/home/ubuntu/julia-jul-231/ops/build-runner';
const require=createRequire(`${owner}/package.json`);
const packages=process.argv.slice(2).length ? process.argv.slice(2) : ['@mastra/core','@ai-sdk/openai-compatible'];
let failed=false;
for (const name of packages) {
 const entry=require.resolve(name), real=realpathSync(entry);
 const red=real.startsWith('/home/ubuntu/mastra-trial/route-a/node_modules/');
 console.log(`${red?'RED':'GREEN'} ${name}: ${real}`);
 failed ||= red;
}
process.exitCode=failed?1:0;
