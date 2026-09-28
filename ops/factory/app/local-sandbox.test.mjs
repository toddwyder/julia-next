import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLocalFactorySandbox } from './src/mastra/local-sandbox.ts';

test('Factory local commands cannot read service-user files outside their workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-bwrap-'));
  const priorRoot = process.env.MASTRACODE_LOCAL_SANDBOX_ROOT;
  process.env.MASTRACODE_LOCAL_SANDBOX_ROOT = root;
  const outside = join(root, 'outside-canary');
  await writeFile(outside, 'canary');
  try {
    const sandbox = createLocalFactorySandbox('session', {});
    await sandbox.start();
    const allowed = await sandbox.executeCommand('printf isolated');
    assert.equal(allowed.exitCode, 0);
    assert.equal(allowed.stdout, 'isolated');
    const result = await sandbox.executeCommand(`test -r '${outside}'`);
    assert.notEqual(result.exitCode, 0);
    assert.equal((await sandbox.getInfo()).metadata.isolation, 'bwrap');
  } finally {
    if (priorRoot === undefined) delete process.env.MASTRACODE_LOCAL_SANDBOX_ROOT;
    else process.env.MASTRACODE_LOCAL_SANDBOX_ROOT = priorRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test('Factory local commands can use the approved network while outside files stay private', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-bwrap-network-'));
  const priorRoot = process.env.MASTRACODE_LOCAL_SANDBOX_ROOT;
  process.env.MASTRACODE_LOCAL_SANDBOX_ROOT = root;
  const outside = join(root, 'outside-canary');
  await writeFile(outside, 'canary');
  const server = createServer((_request, response) => response.end('reachable'));
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const sandbox = createLocalFactorySandbox('session', {});
    await sandbox.start();
    const port = server.address().port;
    const result = await sandbox.executeCommand(`curl -fsS --max-time 3 http://127.0.0.1:${port}/`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'reachable');
    assert.notEqual((await sandbox.executeCommand(`test -r '${outside}'`)).exitCode, 0);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (priorRoot === undefined) delete process.env.MASTRACODE_LOCAL_SANDBOX_ROOT;
    else process.env.MASTRACODE_LOCAL_SANDBOX_ROOT = priorRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test('Factory local sandbox fails closed when bubblewrap is unavailable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-bwrap-missing-'));
  const priorPath = process.env.PATH;
  process.env.PATH = root;
  try {
    assert.throws(() => createLocalFactorySandbox('session', {}), /bwrap|bubblewrap|isolation/i);
  } finally {
    process.env.PATH = priorPath;
    await rm(root, { recursive: true, force: true });
  }
});
