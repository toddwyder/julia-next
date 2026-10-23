import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { portOwners, processTree, stopProcess } from './process-platform.mjs';

test('lifecycle identifies the real server tree and listener, then stops that tree', async t => {
  const startedAt = Date.now();
  const child = spawn(process.execPath, ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port))"], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });
  const [output] = await once(child.stdout, 'data');
  const port = Number(String(output).trim());
  const info = processTree(child.pid);
  assert.equal(info.root.ProcessId, child.pid);
  assert.ok(info.root.CommandLine.includes('createServer'));
  assert.ok(Math.abs(Date.parse(info.root.Created) - startedAt) < 15_000);
  assert.deepEqual(portOwners(port), [child.pid]);
  await stopProcess(child.pid, true);
  assert.equal(processTree(child.pid).root, null);
  assert.deepEqual(portOwners(port), []);
});
