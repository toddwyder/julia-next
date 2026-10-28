import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkStop } from '../worker/run-build.mjs';
import { readRunTrace } from '../worker/trace-cost.mjs';
import { writeReport } from './effort-report.mjs';

export async function recoverProof(source, output) {
  checkStop();
  mkdirSync(output, { recursive: false, mode: 0o700 });
  const runs = [];
  for (const name of readdirSync(source).filter(name => name.endsWith('.proof.json')).sort()) {
    checkStop();
    const previous = JSON.parse(readFileSync(join(source, name), 'utf8'));
    const runDir = join(source, previous.id);
    const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    let trace;
    try { trace = await readRunTrace(join(runDir, 'observability.duckdb')); }
    catch (error) { trace = { error: error.message, rowCount: 0, models: [] }; }
    const helpers = events.filter(event => event.type === 'subagent_start').map(event => ({ toolCallId: event.toolCallId, agentType: event.agentType, model: event.modelId, source: 'SDK subagent_start event' }));
    const requestPath = join(source, `${previous.id}.request.json`);
    const request = existsSync(requestPath) ? JSON.parse(readFileSync(requestPath, 'utf8')) : undefined;
    runs.push({ ...previous, trace, helpers, originalProof: join(source, name), originalTraceError: previous.trace?.error,
      gaps: [
        ...(helpers.length !== 1 ? [`Expected one helper, observed ${helpers.length}`] : []),
        ...(previous.result?.finishReason === 'suspended' ? ['SDK turn suspended despite exit code zero'] : []),
        ...(request && !existsSync(join(request.cwd, 'proof.txt')) ? ['Requested proof file is absent from the assigned workspace'] : []),
      ] });
  }
  const proof = { mode: 'recovered matrix, not a rerun', source: resolve(source), runs };
  checkStop();
  writeFileSync(join(output, 'proof.json'), JSON.stringify(proof, null, 2), { mode: 0o600 });
  writeReport(proof, join(output, 'effort-report.html'));
  return proof;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [source, output] = process.argv.slice(2);
    if (!source || !output) throw new Error('usage: node effort-read.mjs SOURCE NEW_OUTPUT');
    const proof = await recoverProof(resolve(source), resolve(output));
    console.log(JSON.stringify({ runs: proof.runs.length, withRows: proof.runs.filter(r => r.trace.rowCount > 0).length, helpers: proof.runs.filter(r => r.helpers.length === 1).length, gaps: proof.runs.filter(r => r.gaps.length).length }));
    process.exitCode = proof.runs.length === 12 && proof.runs.every(r => !r.gaps.length && r.trace.rowCount > 0 && r.trace.readMs < 5000) ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
