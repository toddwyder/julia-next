import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { agyArgs, agyOutcome, workerEnv } from './julia-minimal-runner-adapters.mjs';

// Gemini's limits. agy honours only the user's global allow list in headless
// mode (JUL-122 step 3: a project's own rules were ignored), so the runner
// adds what it controls: no permission-skipping flag, an environment with no
// secrets and no way to push, and a turn that hit a denial counted as a
// failure even though agy exits 0 and says SUCCESS.

test('agy runs headless, never with permissions skipped', () => {
  const worktree = 'C:/work/card-1';
  const args = agyArgs('the brief', worktree);
  assert.ok(!args.includes('--dangerously-skip-permissions'));
  assert.ok(!args.includes('--sandbox'), '--sandbox needs admin on Windows and is auto-denied (step 1)');
  assert.ok(!args.includes('--project'), "a project file's own permission rules are ignored headless (step 3)");
  assert.deepEqual(args.slice(args.indexOf('--add-dir'), args.indexOf('--add-dir') + 2), ['--add-dir', worktree], 'without the worktree in its workspace agy refuses to read it (24 Sep)');
  assert.equal(args.at(-2), '--print', '--print must be last, followed by the prompt');
  assert.equal(args.at(-1), `Your working folder is ${worktree}.\n\nthe brief`, 'Gemini guesses paths unless told its folder (24 Sep)');
});

test('the worker environment carries no secrets', () => {
  const env = workerEnv({ PATH: '/bin', USERPROFILE: 'C:/u', LINEAR_API_KEY: 'k', GITHUB_TOKEN: 't', GH_TOKEN: 't', DEEPSEEK_API_KEY: 'd', JULIA_PUBLISHER_PRIVATE_KEY: 'p', SOME_SECRET: 's', NODE_TEST_CONTEXT: 'child' });
  assert.equal(env.PATH, '/bin');
  assert.equal(env.USERPROFILE, 'C:/u', 'agy needs the home folder for its own sign-in');
  for (const name of ['LINEAR_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN', 'DEEPSEEK_API_KEY', 'JULIA_PUBLISHER_PRIVATE_KEY', 'SOME_SECRET', 'NODE_TEST_CONTEXT']) {
    assert.equal(env[name], undefined, `${name} must not reach the worker`);
  }
});

test('a git push under the worker environment fails, even with a real remote', () => {
  const root = mkdtempSync(join(tmpdir(), 'runner-push-'));
  const origin = join(root, 'origin.git');
  const repo = join(root, 'repo');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', origin]);
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'a']);
  const push = spawnSync('git', ['push', 'origin', 'main'], { cwd: repo, encoding: 'utf8', env: workerEnv(process.env) });
  assert.notEqual(push.status, 0, 'push must fail');
  assert.equal(spawnSync('git', ['--git-dir', origin, 'rev-parse', '--verify', 'main'], { encoding: 'utf8' }).status, 128, 'nothing reached the remote');
  rmSync(root, { recursive: true, force: true });
});

test('a denied action, an empty reply or a non-SUCCESS status is a failed turn', () => {
  const denied = agyOutcome(JSON.stringify({ status: 'SUCCESS', response: '', denied_actions: [{ action: 'command', display_name: 'RunCommand' }] }), 'jetski: a tool required the "command" permission');
  assert.equal(denied.ok, false);
  assert.match(denied.reason, /denied.*command/);
  assert.equal(agyOutcome(JSON.stringify({ status: 'SUCCESS', response: '' })).ok, false);
  assert.equal(agyOutcome(JSON.stringify({ status: 'ERROR', error: 'quota' })).ok, false);
  assert.equal(agyOutcome('not json').ok, false);
  assert.deepEqual(agyOutcome(JSON.stringify({ status: 'SUCCESS', response: 'Done: add() now sums.' })), { ok: true, reason: null });
});
