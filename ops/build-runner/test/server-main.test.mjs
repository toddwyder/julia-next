import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { cgroupProcsPath } from '../server-main.mjs'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const cli = join(import.meta.dirname, '../server-main.mjs')
function repository(t, config = {}) {
  const root = mkdtempSync(join(tmpdir(), 'server-main-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const upstream = join(root, 'upstream')
  const checkout = join(root, 'checkout')
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim()
  mkdirSync(upstream)
  git(upstream, 'init', '-b', 'main')
  git(upstream, 'config', 'user.name', 'Service test')
  git(upstream, 'config', 'user.email', 'test@example.invalid')
  writeFileSync(join(upstream, 'source'), 'baseline\n')
  git(upstream, 'add', '.'); git(upstream, 'commit', '-m', 'baseline')
  git(root, 'clone', upstream, checkout)
  const baseline = git(checkout, 'rev-parse', 'HEAD')
  const configFile = join(root, 'config.json')
  writeFileSync(configFile, JSON.stringify({ checkout, branch: 'main', services: [], installDependencies: false, ...config }))
  const invoke = () => spawnSync(process.execPath, [cli, 'poll', configFile], { encoding: 'utf8', env })
  const poll = () => {
    const result = invoke()
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout)
  }
  const commit = text => {
    writeFileSync(join(upstream, 'source'), text + '\n')
    git(upstream, 'commit', '-am', text)
    return git(upstream, 'rev-parse', 'HEAD')
  }
  const executable = (name, source) => {
    const bin = join(root, 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, name), '#!/usr/bin/env node\n' + source)
    chmodSync(join(bin, name), 0o755)
    env.PATH = bin + ':' + process.env.PATH
  }
  return { root, upstream, checkout, baseline, env, git, commit, poll, invoke, executable }
}

test('the service checkout advances only for a merge, then repeated polls leave it alone', t => {
  const f = repository(t)
  assert.equal(f.poll().updated, false)
  f.commit('direct push')
  assert.equal(f.poll().updated, false)
  assert.equal(f.git(f.checkout, 'rev-parse', 'HEAD'), f.baseline)
  f.git(f.upstream, 'checkout', '-b', 'feature')
  writeFileSync(join(f.upstream, 'feature'), 'merged\n')
  f.git(f.upstream, 'add', '.'); f.git(f.upstream, 'commit', '-m', 'feature')
  f.git(f.upstream, 'checkout', 'main'); f.git(f.upstream, 'merge', '--no-ff', 'feature', '-m', 'merge feature')
  const merged = f.git(f.upstream, 'rev-parse', 'HEAD')
  assert.equal(f.poll().updated, true)
  assert.equal(f.git(f.checkout, 'rev-parse', 'HEAD'), merged)
  assert.equal(f.git(f.checkout, 'branch', '--show-current'), 'main')
  assert.equal(readFileSync(join(f.checkout, 'feature'), 'utf8'), 'merged\n')
  assert.equal(f.poll().updated, false)
})

test('activation waits for the named PR and recognizes its squash merge from GitHub metadata', t => {
  const f = repository(t, { githubRepository: 'test/repo', activationPullRequest: 316 })
  const metadata = join(f.root, 'github.json')
  f.env.SERVICE_TEST_METADATA = metadata
  f.executable('gh', `const fs = require('node:fs');
const pr = JSON.parse(fs.readFileSync(process.env.SERVICE_TEST_METADATA));
console.log(JSON.stringify(process.argv.some(arg => arg.includes('/commits/')) ? [pr] : pr));`)
  const squashed = f.commit('squashed feature')
  const pr = { merged: false, merged_at: null, base: { ref: 'main' }, merge_commit_sha: squashed }
  writeFileSync(metadata, JSON.stringify(pr))
  assert.equal(f.poll().awaitingMerge, 316)
  assert.equal(f.git(f.checkout, 'rev-parse', 'HEAD'), f.baseline)
  writeFileSync(metadata, JSON.stringify({ ...pr, merged: true, merged_at: '2026-10-23T16:00:00Z' }))
  f.git(f.upstream, 'checkout', '-b', 'later-feature')
  f.commit('later feature')
  f.git(f.upstream, 'checkout', 'main'); f.git(f.upstream, 'merge', '--no-ff', 'later-feature', '-m', 'later merge')
  const laterMerge = f.git(f.upstream, 'rev-parse', 'HEAD')
  assert.equal(f.poll().updated, true)
  assert.equal(f.git(f.checkout, 'rev-parse', 'HEAD'), squashed)
  assert.equal(f.poll().updated, true)
  assert.equal(f.git(f.checkout, 'rev-parse', 'HEAD'), laterMerge)
  assert.equal(f.poll().updated, false)
})

test('the cgroup procs path resolves systemd-relative and absolute cgroups', t => {
  const root = mkdtempSync(join(tmpdir(), 'cgroup-path-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'user.slice', 'x'), { recursive: true })
  writeFileSync(join(root, 'user.slice', 'x', 'cgroup.procs'), '1\n')
  assert.equal(cgroupProcsPath('/user.slice/x', root), join(root, 'user.slice', 'x', 'cgroup.procs'))
  const absolute = join(root, 'cgroup')
  mkdirSync(absolute, { recursive: true })
  writeFileSync(join(absolute, 'cgroup.procs'), '2\n')
  assert.equal(cgroupProcsPath(absolute), join(absolute, 'cgroup.procs'))
  assert.equal(cgroupProcsPath('/does/not/exist', root), null)
})

test('a merge is deferred while a build worker runs and applies after it ends', t => {
  const f = repository(t, { services: ['julia-machine-runner.service'] })
  const cgroup = join(f.root, 'cgroup')
  mkdirSync(cgroup)
  const workerPath = join(f.root, 'worker.mjs')
  writeFileSync(workerPath, 'setInterval(() => {}, 1000)\n')
  const worker = spawn(process.execPath, [workerPath], { stdio: 'ignore' })
  worker.unref()
  t.after(() => worker.kill())
  writeFileSync(join(cgroup, 'cgroup.procs'), `${worker.pid}\n`)
  const restarts = join(f.root, 'restarts.log')
  f.env.SERVICE_TEST_CGROUP = cgroup
  f.env.SERVICE_TEST_RESTARTS = restarts
  f.executable('systemctl', `const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('restart')) fs.appendFileSync(process.env.SERVICE_TEST_RESTARTS, args.join(' ') + '\\n');
if (args.includes('show') && args.some(arg => arg.includes('ControlGroup'))) { console.log(process.env.SERVICE_TEST_CGROUP); process.exit(0); }
process.exit(0);`)
  f.git(f.upstream, 'checkout', '-b', 'feature')
  f.commit('feature')
  f.git(f.upstream, 'checkout', 'main')
  f.git(f.upstream, 'merge', '--no-ff', 'feature', '-m', 'merge feature')
  const merged = f.git(f.upstream, 'rev-parse', 'HEAD')

  const deferred = f.poll()
  assert.equal(deferred.updated, false)
  assert.equal(deferred.deferred, true)
  assert.equal(f.git(f.checkout, 'rev-parse', 'HEAD'), f.baseline)
  assert.equal(existsSync(restarts), false)

  writeFileSync(join(cgroup, 'cgroup.procs'), '')
  const applied = f.poll()
  assert.equal(applied.updated, true)
  assert.equal(f.git(f.checkout, 'rev-parse', 'HEAD'), merged)
  assert.match(readFileSync(restarts, 'utf8'), /restart julia-machine-runner\.service/)
});

test('a service restart failure is retried after checkout already advanced', t => {
  const f = repository(t, { services: ['fixture.service'] })
  f.executable('systemctl', `if (process.argv.includes('restart') && process.env.SERVICE_TEST_FAIL === 'yes') process.exit(1);`)
  f.git(f.upstream, 'checkout', '-b', 'feature')
  f.commit('feature')
  f.git(f.upstream, 'checkout', 'main'); f.git(f.upstream, 'merge', '--no-ff', 'feature', '-m', 'merge feature')
  const merged = f.git(f.upstream, 'rev-parse', 'HEAD')
  f.env.SERVICE_TEST_FAIL = 'yes'
  assert.equal(f.invoke().status, 1)
  assert.equal(f.git(f.checkout, 'rev-parse', 'HEAD'), merged)
  assert.equal(existsSync(join(f.checkout, '.git/julia-services-pending')), true)
  delete f.env.SERVICE_TEST_FAIL
  assert.equal(f.poll().updated, true)
  assert.equal(existsSync(join(f.checkout, '.git/julia-services-pending')), false)
  assert.equal(f.poll().updated, false)
})
