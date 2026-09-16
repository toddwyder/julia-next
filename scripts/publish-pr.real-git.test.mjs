import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pushBranch } from './publish-pr.mjs';

const execFileAsync = promisify(execFile);

async function withRepositories(run) {
  const root = mkdtempSync(join(tmpdir(), 'julia-publisher-real-git-'));
  const publisherTempDirs = new Set();
  try {
    const bare = join(root, 'remote.git');
    const cwd = join(root, 'working');
    mkdirSync(cwd);
    // Keep fixture creation independent of ambient Git config and identity.
    const env = {
      PATH: process.env.PATH,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: join(root, 'empty.gitconfig'),
    };
    const git = (args, directory = cwd) => execFileAsync('git', args, { cwd: directory, env });
    await git(['init', '--bare', bare]);
    await git(['init']);
    writeFileSync(join(cwd, 'fixture.txt'), 'real-git publisher regression\n');
    await git(['add', 'fixture.txt']);
    await git(['-c', 'user.name=Publisher Test', '-c', 'user.email=publisher@example.invalid',
      '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${join(root, 'no-hooks')}`,
      'commit', '-m', 'fixture']);

    let pushAttempts = 0;
    let tokenMints = 0;
    const branch = 'publisher-real-git';
    const options = {
      owner: 'toddwyder', repo: 'julia-next', branch, cwd, env,
      tokenImpl: async () => {
        tokenMints += 1;
        return 'FAKE_INSTALLATION_TOKEN';
      },
      writeAskpass: () => join(root, 'fake-askpass'),
      execImpl: async (command, args, execOptions) => {
        // The publisher owns these dirs but only removes the config files.
        // Retain their paths so this fixture cleans up those empty dirs too.
        publisherTempDirs.add(dirname(execOptions.env.GIT_CONFIG_GLOBAL));
        for (const arg of args) {
          if (arg.startsWith('core.hooksPath=')) {
            publisherTempDirs.add(arg.slice('core.hooksPath='.length));
          }
        }
        const realArgs = [...args];
        const pushIndex = realArgs.indexOf('push');
        if (pushIndex !== -1) {
          pushAttempts += 1;
          // Substitute only the destination; every invocation uses real Git,
          // including the local-config check and the push itself.
          realArgs[pushIndex + 1] = bare;
        }
        return execFileAsync(command, realArgs, execOptions);
      },
    };
    await run({ bare, branch, git, options,
      pushAttempts: () => pushAttempts, tokenMints: () => tokenMints });
  } finally {
    for (const directory of publisherTempDirs) rmSync(directory, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

test('pushBranch refuses a real repo-local insteadOf rewrite before minting a token or attempting a push', async () => {
  await withRepositories(async ({ bare, git, options, pushAttempts, tokenMints }) => {
    await git(['config', 'url.probe::.insteadOf', 'https://x-access-token@github.com/']);
    await assert.rejects(pushBranch(options), /insteadOf.*refusing to push/);
    assert.equal(pushAttempts(), 0);
    assert.equal(tokenMints(), 0);
    assert.equal((await git(['for-each-ref', '--format=%(refname)'], bare)).stdout, '');
  });
});

test('pushBranch without insteadOf rewrites really pushes HEAD into the bare repository', async () => {
  await withRepositories(async ({ bare, branch, git, options, pushAttempts, tokenMints }) => {
    assert.deepEqual(await pushBranch(options), { pushed: true, branch });
    assert.equal(pushAttempts(), 1);
    assert.equal(tokenMints(), 1);
    const head = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    const pushed = (await git(['rev-parse', `refs/heads/${branch}`], bare)).stdout.trim();
    assert.equal(pushed, head);
  });
});
