import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';
import { ROLE_GROUPS } from '../../dashboard/lib/model-settings.js';
import { report } from './report.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const mode = process.argv[2] ?? 'run';
const dir = resolve(process.argv[3] ?? join(root, '.artifacts/flow/luna-cost-proof', new Date().toISOString().replaceAll(':', '-')));
const MODEL = 'openai/gpt-6-luna';
const LIMIT = 0.00000001;
const cases = ['current', 'coding'].flatMap(factory => ['normal', 'stop', 'memory'].map(test => ({ key: `${factory}-${test}`, factory, test })));
const prompt = 'This is a disposable cost measurement, not a card or a code change. Delegate exactly once to the how explorer helper using agent-howExplorer. Ask it to reverse the string cobalt739 and return only the reversed string. Do not ask it about code. After the helper returns, repeat its answer and finish. Do not use any other tool, edit files, run commands, or start another helper.';
const pause = ms => new Promise(done => setTimeout(done, ms));
const jsonFile = (name, value) => writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + '\n');

function prepare() {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'lead-model'), MODEL + '\n');
  writeFileSync(join(dir, 'roles.md'), ROLE_GROUPS.flatMap(group => group.roles.map(role => `${role.name}: ${MODEL}`)).join('\n') + '\n');
  assert.equal(JSON.parse(readFileSync(join(root,'node_modules/@mastra/core/package.json'),'utf8')).version, '1.82.0');
  const source = readFileSync(join(root, 'machine/flow/agents.mjs'), 'utf8');
  for (const lane of ['observation', 'reflection']) assert(source.includes(`${lane}: { model: agentModel('openai/gpt-6-luna')`), 'Memory model changed. Review the fixture before running.');
  jsonFile('setup.json', { baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd:root,encoding:'utf8'}).trim(), coreVersion: JSON.parse(readFileSync(join(root,'node_modules/@mastra/core/package.json'),'utf8')).version, sourceSha256: createHash('sha256').update(source).digest('hex'), model: MODEL, limit: LIMIT, prompt, cases,
    changes: ['All model selections point to local Luna-only files.', 'Stop cases replace only COST_LIMIT_DOLLARS.', 'Coding cases replace every new Agent(config) with createCodingAgent(config).', 'Memory cases lower observation and reflection thresholds to 200 and 100 tokens, disabling async buffering. No other memory setting changes.', 'Only agent-howExplorer is active on the Lead. Helpers retain workspace tools. The Graphify gate is started.'] });
  for (const item of cases) {
    let code = source.replace(/from '(\.\/[^']+)'/g, (_, path) => `from '${pathToFileURL(resolve(root, 'machine/flow', path)).href}'`);
    assert(source.includes('COST_LIMIT_DOLLARS = 4') && source.includes('new Agent({'), 'Agent source changed. Review fixture transformations before running.');
    if (item.factory === 'coding') code = `import { createCodingAgent } from '@mastra/core/coding-agent';\n` + code.replaceAll('new Agent({', 'createCodingAgent({');
    if (item.test === 'stop') code = code.replace('COST_LIMIT_DOLLARS = 4', `COST_LIMIT_DOLLARS = ${LIMIT}`);
    if (item.test === 'memory') code = code.replace('observation: { model:', 'observation: { messageTokens: 200, bufferTokens: false, model:').replace('reflection: { model:', 'reflection: { observationTokens: 100, model:');
    writeFileSync(join(dir, `${item.key}.mjs`), code);
  }
  writeFileSync(join(dir, 'index.ts'), cases.map((item,i)=>`import { createAgents as factory${i} } from './${item.key}.mjs';`).join('\n') + `\nimport { createWorkflow } from '@mastra/core/workflows';\nimport { z } from 'zod';\nimport { openMastra } from '${pathToFileURL(join(root, 'machine/flow/mastra.mjs')).href}';\nconst agents = {};\nfor (const [key,createAgents] of [${cases.map((item,i)=>`['${item.key}',factory${i}]`).join(',')}]) {\n const group = createAgents({repo:${JSON.stringify(root)}, machine:true, leadModelFile:${JSON.stringify(join(dir, 'lead-model'))},roleModelsFile:${JSON.stringify(join(dir, 'roles.md'))}});\n group.gate.start(); agents[key] = group.build;\n}\nconst workflow = createWorkflow({id:'disposable-cost-probe',inputSchema:z.object({}),outputSchema:z.object({})}).commit();\nexport const mastra = await openMastra({card:'disposable-luna-cost-proof',agents,workflow,stateDb:${JSON.stringify(join(dir,'state.db'))},traceDb:${JSON.stringify(join(dir,'trace.duckdb'))}});\n`);
}

async function run() {
  prepare();
  const port = Number(process.env.PROOF_PORT ?? 4197);
  const probe = createServer();
  await new Promise((done, fail) => { probe.once('error', fail); probe.listen(port, '127.0.0.1', done); });
  await new Promise(done => probe.close(done));
  const log = [];
  const child = spawn('npm', ['exec', '--yes', 'mastra@1.38.0', 'dev', '--', '--dir', dir], { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: String(port), FLOW_REPO: root, MASTRA_TELEMETRY_DISABLED: '1' } });
  for (const pipe of [child.stdout, child.stderr]) pipe.on('data', chunk => { log.push(chunk.toString()); writeFileSync(join(dir, 'studio.log'), log.join('')); });
  const records = [];
  try {
    const deadline = Date.now() + 180000;
    for (;;) {
      try { const res = await fetch(`http://localhost:${port}/api/agents`); if (res.ok) { jsonFile('agents.json', await res.json()); break; } } catch {}
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('Studio did not start. See studio.log');
      await pause(1000);
    }
    for (const item of cases) {
      const runId = randomUUID();
      const messages = item.test === 'memory' ? [
        {role:'user',content: Array.from({length:32},(_,i)=>`Preference ${i}: keep the cobalt project result concise, preserve its digits, reverse its letters and numbers together. This is historical background only.`).join('\n')},
        {role:'assistant',content:'I have noted these preferences.'}, {role:'user',content:prompt},
      ] : prompt;
      console.log(`Studio ${item.key} run ${runId}`);
      const response = await fetch(`http://localhost:${port}/api/agents/${item.key}/stream`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages,runId,memory:{thread:`${item.key}-${runId}`,resource:'disposable-luna-cost-proof'},maxSteps:8,activeTools:['agent-howExplorer']}),signal:AbortSignal.timeout(240000)});
      assert(response.ok, `Studio returned ${response.status}`);
      const wire = await response.text();
      writeFileSync(join(dir, `${item.key}.sse`), wire);
      const events = wire.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).filter(line=>line && line!=='[DONE]').map(line=>JSON.parse(line));
      records.push({...item,runId,events});
      jsonFile('runs.json', records);
      console.log(`${item.key} finished with ${events.length} events`);
      await pause(3000);
    }
  } finally {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    await pause(3000);
  }
  await query();
}

async function query() {
  const instance = await DuckDBInstance.create(join(dir,'trace.duckdb'), { access_mode: 'READ_ONLY' });
  const conn = await instance.connect();
  try {
    for (const table of ['span_events','metric_events']) {
      const rows = (await conn.runAndReadAll(`select * from ${table}`)).getRowObjectsJS();
      jsonFile(`${table}.json`, JSON.parse(JSON.stringify(rows, (_,v)=>typeof v==='bigint'?Number(v):v)));
    }
  } finally { conn.closeSync(); instance.closeSync(); }
  report(dir);
  console.log(`Evidence saved in ${dir}`);
}
if (mode === 'run') await run();
else if (mode === 'query') await query();
else throw new Error('Usage: node run.mjs [run|query] [artifact-directory]');
