import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));

test('killing the transport process after the real Beam answer arrives leaves the complete file', { timeout: 120_000 }, async t => {
  assert.ok(process.env.COMMANDCODE_API_KEY, 'COMMANDCODE_API_KEY must be supplied through the approved vault');
  const directory = await mkdtemp(join(tmpdir(), 'jul223-interrupt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const rawAnswerPath = join(directory, 'JUL-223.8a0d87.raw.txt');
  const childPath = join(here, '..', '..', 'support', 'raw-answer-interrupt-child.mjs');
  const child = spawn(process.execPath, [childPath, rawAnswerPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode == null) child.kill('SIGKILL'); });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`raw answer was not saved before interruption: ${stderr}`)), 120_000);
    const poll = async () => {
      try { await access(rawAnswerPath); clearTimeout(timeout); resolve(); }
      catch { setTimeout(poll, 20); }
    };
    poll();
  });
  child.kill('SIGKILL');
  await new Promise(resolve => child.once('exit', resolve));
  assert.ok((await readFile(rawAnswerPath, 'utf8')).length > 0);
});
