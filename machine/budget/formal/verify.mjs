import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { checkModel } from './model-check.mjs';
import { checkReservationModel } from './reservation-check.mjs';
import { createSliceControl } from '../control.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../control.mjs');
const scratchRoot = join(process.env.HOME, '.local/state/julia-scratch');
mkdirSync(scratchRoot, { recursive: true });
const temporary = mkdtempSync(join(scratchRoot, 'jul360-formal-'));
const result = { node: process.version, checkedSource: 'machine/budget/control.mjs',
  sourceSha256: createHash('sha256').update(readFileSync(source)).digest('hex'), checks: [] };
function launch(modulePath, directory, mode) {
  const child = spawn(process.execPath, [join(here, 'worker.mjs'), modulePath, directory, mode], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const done = new Promise((resolveResult, reject) => {
    child.on('error', reject);
    child.on('exit', code => {
      if (code !== 0) reject(new Error(`Worker exited ${code}: ${stderr}`));
      else { try { resolveResult(JSON.parse(stdout)); } catch (error) { reject(error); } }
    });
  });
  return { child, done };
}
try {
  // Sequential stop/refusal survives reconstruction and requires attributed clear.
  const directory = join(temporary, 'sequential');
  const one = createSliceControl({ directory, dollarCap: 4, tokenCap: 2000000 });
  one.assertStart(); one.stop('formal_sequential_stop');
  assert.throws(() => one.assertStart(), /slice_stopped/);
  const two = createSliceControl({ directory, dollarCap: 4, tokenCap: 2000000 });
  assert.throws(() => two.assertStart(), /slice_stopped/);
  assert.throws(() => two.begin({ model: 'x', role: 'lead' }), /slice_stopped/);
  one.clear({ actor: 'formal-check', reason: 'deliberate test reset' });
  const three = createSliceControl({ directory, dollarCap: 4, tokenCap: 2000000 });
  three.assertStart(); three.finish();
  result.checks.push({ name: 'real sequential stop, reconstruction, retry and attributed clear', pass: true });

  // Break the actual code in a disposable copy, never the production file.
  let mutant = readFileSync(source, 'utf8');
  const guards = [
    "    if (existsSync(stopPath)) throw new Error(`slice_stopped: ${JSON.parse(readFileSync(stopPath, 'utf8')).reason}`);",
    "    if (record.phase === 'stopped') throw new Error(`slice_stopped: ${record.stop?.reason}`);",
    "      if (existsSync(stopPath)) { release(); throw new Error('slice_stopped'); }",
    "        if (existsSync(stopPath) || record.phase === 'stopped') { release(); throw new Error('slice_stopped'); }",
  ];
  for (const guard of guards) { assert.ok(mutant.includes(guard), 'Covered admission changed: review model mapping'); mutant = mutant.replace(guard, ''); }
  const mutantDir = join(temporary, 'mutant'); mkdirSync(mutantDir);
  const mutantModule = join(mutantDir, 'control.mjs'); writeFileSync(mutantModule, mutant);
  copyFileSync(resolve(here, '../prices.json'), join(mutantDir, 'prices.json'));
  const mutated = await launch(mutantModule, join(temporary, 'mutant-record'), 'post-stop').done;
  assert.equal(mutated.admitted, true, 'Mutation did not break the guarded property');
  assert.equal(mutated.record.events.at(-1).kind, 'slice_start');
  result.checks.push({ name: 'real-code mutation removes admission guards; same property detects illegal slice_start', pass: true, mutantPropertyPass: false });

  // Deterministically reproduce the model race: pause after the second stop.lock
  // existence check, let another process publish the stop, resume admission.
  const raceDirectory = join(temporary, 'race'); mkdirSync(raceDirectory);
  const contender = launch(source, raceDirectory, 'pause-after-recheck');
  const deadline = Date.now() + 8000;
  while (!existsSync(join(raceDirectory, 'ready'))) {
    if (Date.now() > deadline) { contender.child.kill(); throw new Error('Worker did not reach post-lock latch recheck'); }
    await delay(5);
  }
  const stopper = createSliceControl({ directory: raceDirectory, dollarCap: 4, tokenCap: 2000000 });
  stopper.stop('formal_concurrent_stop');
  assert.ok(existsSync(join(raceDirectory, 'stop.lock')));
  writeFileSync(join(raceDirectory, 'resume'), 'continue');
  const admitted = await contender.done;
  const persisted = JSON.parse(readFileSync(join(raceDirectory, 'record.json'), 'utf8'));
  const illegal = admitted.admitted && persisted.events.at(-1)?.kind === 'slice_start' && existsSync(join(raceDirectory, 'stop.lock'));
  result.checks.push({ name: 'real two-process stop/admission interleaving', pass: !illegal,
    finding: illegal ? 'A contender rechecks stop.lock, another process publishes stop.lock, then the contender persists slice_start and returns successfully while stop.lock still exists.' : null,
    finalPhase: persisted.phase, latchPresent: existsSync(join(raceDirectory, 'stop.lock')) });
  result.model = checkModel();
  result.mutantModel = checkModel({ removeStopChecks: true });
  assert.equal(result.mutantModel.pass, false, 'Model mutation did not violate the property');
  result.reservationModel = checkReservationModel();
  result.mutantReservationModel = checkReservationModel({ removeReservationCheck: true });
  assert.equal(result.mutantReservationModel.pass, false, 'Reservation model mutation did not violate the property');
  result.pass = result.checks.every(check => check.pass) && result.model.pass && result.reservationModel.pass;
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) process.exitCode = 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
