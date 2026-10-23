import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const [head, ...args] = process.argv.slice(2);
if (!/^[a-f0-9]{40}$/.test(head ?? '')) throw Error('Expected exact pull-request head SHA');
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const remote = option('--remote', 'origin');
const timeout = Number(option('--timeout', '1800')) * 1000;
const scratch = await mkdtemp(join(tmpdir(), 'await-server-tests-'));
const fetchDirectory = remote === 'origin' ? process.cwd() : scratch;
try {
  if (fetchDirectory === scratch) execFileSync('git', ['init', '--quiet', scratch]);
  const deadline = Date.now() + timeout;
  let receipt;
  while (Date.now() < deadline) {
    try {
      execFileSync('git', ['fetch', '--quiet', remote, `refs/notes/julia-server-tests/${head}`], { cwd: fetchDirectory, stdio: 'pipe' });
      receipt = JSON.parse(execFileSync('git', ['show', 'FETCH_HEAD:result.json'], { cwd: fetchDirectory, encoding: 'utf8' }));
      break;
    } catch { await setTimeout(1000); }
  }
  if (!receipt) throw Error(`No server test receipt for ${head} before timeout`);
  if (receipt.head !== head || receipt.host !== 'ubuntu-server') throw Error('Server result belongs to another candidate');
  if (receipt.exitCode !== 0) {
    process.stderr.write(execFileSync('git', ['show', 'FETCH_HEAD:server-tests.log'], { cwd: fetchDirectory, encoding: 'utf8' }));
    throw Error(`Server tests failed for ${head}`);
  }
  console.log(`Server tests passed for ${head}`);
} finally { await rm(scratch, { recursive: true, force: true }); }
