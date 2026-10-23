import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const refFor = head => `refs/notes/julia-server-tests/${head}`;
const { GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, ...gitEnv } = process.env;
const git = (cwd, args, options = {}) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8', ...options }).trim();

export async function runHead({ repository, state }, head, { env = process.env } = {}) {
  if (!/^[a-f0-9]{40}$/.test(head)) throw Error('Expected a full candidate SHA');
  await mkdir(state, { recursive: true });
  const claim = join(state, head);
  try { await mkdir(claim); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    try {
      const result = JSON.parse(await readFile(join(claim, 'result.json'), 'utf8'));
      await publish(repository, head, claim, result);
      return result;
    } catch (failure) {
      if (failure.code !== 'ENOENT') throw failure;
      try {
        const owner = JSON.parse(await readFile(join(claim, 'owner.json'), 'utf8'));
        process.kill(owner.pid, 0);
        return { head, state: 'running' };
      } catch (ownerError) {
        if (!['ENOENT', 'ESRCH'].includes(ownerError.code)) throw ownerError;
      }
      await rename(claim, `${claim}.interrupted-${Date.now()}`);
      return runHead({ repository, state }, head, { env });
    }
  }
  await writeFile(join(claim, 'owner.json'), JSON.stringify({ pid: process.pid }));
  const work = join(claim, 'checkout');
  const output = [];
  let exitCode = 1;
  let error;
  try {
    git(state, ['clone', '--quiet', '--no-hardlinks', repository, work]);
    git(work, ['fetch', '--quiet', 'origin', head]);
    git(work, ['checkout', '--quiet', '--detach', head]);
    const { GIT_DIR, GIT_WORK_TREE, NODE_TEST_CONTEXT, ...cleanEnv } = env;
    for (const args of [
      ['scripts/test-owners.mjs', '--install'],
      ['scripts/julia-agents.mjs', '--', process.execPath, 'scripts/test-owners.mjs', '--run', 'server'],
    ]) {
      const run = spawnSync(process.execPath, args, { cwd: work, env: cleanEnv, encoding: 'utf8', timeout: 1_800_000, maxBuffer: 32 * 1024 * 1024 });
      output.push(run.stdout ?? '', run.stderr ?? '');
      if (run.error || run.status !== 0) throw run.error ?? Error(`Command failed with exit ${run.status}`);
    }
    exitCode = 0;
  } catch (failure) { error = String(failure.message); output.push(error); }
  const result = { head, exitCode, host: 'ubuntu-server', completedAt: new Date().toISOString(), ...(error ? { error } : {}) };
  await writeFile(join(claim, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(join(claim, 'server-tests.log'), output.join('\n'));
  await publish(repository, head, claim, result);
  await rm(work, { recursive: true, force: true });
  return result;
}

async function publish(repository, head, claim, result) {
  const store = join(claim, 'receipt');
  await mkdir(store, { recursive: true });
  try { git(store, ['rev-parse', '--git-dir']); }
  catch { git(store, ['init', '--quiet']); }
  await writeFile(join(store, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(join(store, 'server-tests.log'), await readFile(join(claim, 'server-tests.log')));
  git(store, ['add', '.']);
  if (git(store, ['status', '--porcelain'])) git(store, ['-c', 'user.name=Julia server CI', '-c', 'user.email=julia-ci@localhost', 'commit', '--quiet', '-m', `Server tests for ${head}`]);
  git(store, ['push', '--quiet', repository, `HEAD:${refFor(head)}`]);
}

export async function poll({ repository, state, githubRepository }) {
  const heads = JSON.parse(execFileSync('gh', ['pr', 'list', '--repo', githubRepository, '--state', 'open', '--limit', '100', '--json', 'headRefOid,isCrossRepository'], { encoding: 'utf8' }))
    .filter(pr => !pr.isCrossRepository).map(pr => pr.headRefOid);
  const main = git(state, ['ls-remote', repository, 'refs/heads/main']).split(/\s/)[0];
  for (const head of new Set([...heads, main].filter(Boolean))) {
    await runHead({ repository, state }, head);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, configPath, head] = process.argv.slice(2);
  try {
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    await mkdir(config.state, { recursive: true });
    if (command === 'poll') await poll(config);
    else if (command === 'run') console.log(JSON.stringify(await runHead(config, head)));
    else throw Error('Use poll <config> or run <config> <head>');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
