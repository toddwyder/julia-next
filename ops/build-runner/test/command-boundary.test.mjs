import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFile = promisify(execFileCb)
const linux = { skip: process.platform !== 'linux' }

async function listen(server, target) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(target, resolve)
  })
}

test('builder commands cannot read outside the worktree but can reach the package registry network', linux, async () => {
  const root = await mkdtemp(join(tmpdir(), 'builder-boundary-'))
  const workspace = join(root, 'worktree')
  const home = join(workspace, '.builder-home')
  const outside = join(root, 'outside-secret.txt')
  const tcp = createServer(socket => socket.destroy())
  try {
    await mkdir(home, { recursive: true })
    await writeFile(outside, 'outside-secret\n')
    await listen(tcp, { host: '127.0.0.1', port: 0 })
    const launcher = fileURLToPath(new URL('../command-boundary.py', import.meta.url))
    const config = JSON.stringify({ workspace, home, cwd: workspace, executable: process.execPath })
    await assert.rejects(execFile('python3', [launcher, config, `cat '${outside}'`]), error => {
      assert.notEqual(error.code, 0, 'outside worktree unexpectedly readable')
      return true
    })
    const connected = await execFile('python3', [launcher, config, `node -e "require('net').connect(${tcp.address().port},'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(23))"`])
    assert.equal(connected.stderr, '')
  } finally {
    await new Promise(resolve => tcp.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('builder commands receive only configured read-only keys', linux, async () => {
  const root = await mkdtemp(join(tmpdir(), 'builder-env-boundary-'))
  const workspace = join(root, 'worktree')
  const home = join(workspace, '.builder-home')
  try {
    await mkdir(home, { recursive: true })
    const launcher = fileURLToPath(new URL('../command-boundary.py', import.meta.url))
    const config = JSON.stringify({ workspace, home, cwd: workspace, executable: process.execPath, envKeys: ['PROOF_BUILDER_KEY', 'LINEAR_API_KEY'] })
    const environment = { ...process.env, PROOF_BUILDER_KEY: 'synthetic-builder', LINEAR_API_KEY: 'synthetic-linear' }
    const allowed = await execFile('python3', [launcher, config, 'printf %s "$PROOF_BUILDER_KEY"'], { env: environment })
    assert.equal(allowed.stdout, 'synthetic-builder')
    const blocked = await execFile('python3', [launcher, config, 'test -z "$LINEAR_API_KEY" && printf clean'], { env: environment })
    assert.equal(blocked.stdout, 'clean')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a missing command key fails that command and the next command still runs', linux, async () => {
  const root = await mkdtemp(join(tmpdir(), 'builder-missing-key-'))
  const workspace = join(root, 'worktree')
  const home = join(workspace, '.builder-home')
  try {
    await mkdir(home, { recursive: true })
    const launcher = fileURLToPath(new URL('../command-boundary.py', import.meta.url))
    const config = JSON.stringify({ workspace, home, cwd: workspace, executable: process.execPath, envKeys: ['MISSING_KEY'] })
    await assert.rejects(execFile('python3', [launcher, config, 'test -n "$MISSING_KEY"']))
    const next = await execFile('python3', [launcher, config, 'printf continued'])
    assert.equal(next.stdout, 'continued')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the builder can run the pinned package manager toolchain', linux, async () => {
  const root = await mkdtemp(join(tmpdir(), 'builder-npm-boundary-'))
  const workspace = join(root, 'worktree')
  const home = join(workspace, '.builder-home')
  try {
    await mkdir(home, { recursive: true })
    const launcher = fileURLToPath(new URL('../command-boundary.py', import.meta.url))
    const config = JSON.stringify({ workspace, home, cwd: workspace, executable: process.execPath })
    const result = await execFile('python3', [launcher, config, 'npm --version'])
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('builder command cwd must remain inside the worktree', linux, async () => {
  const root = await mkdtemp(join(tmpdir(), 'builder-cwd-boundary-'))
  const workspace = join(root, 'worktree')
  const home = join(workspace, '.builder-home')
  try {
    await mkdir(home, { recursive: true })
    const launcher = fileURLToPath(new URL('../command-boundary.py', import.meta.url))
    const config = JSON.stringify({ workspace, home, cwd: root, executable: process.execPath })
    await assert.rejects(execFile('python3', [launcher, config, 'pwd']), /builder command refused/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
