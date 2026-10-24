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

test('builder commands cannot read outside the worktree or reach host services', linux, async () => {
  const root = await mkdtemp(join(tmpdir(), 'builder-boundary-'))
  const workspace = join(root, 'worktree')
  const home = join(workspace, '.builder-home')
  const outside = join(root, 'outside-secret.txt')
  const serviceSocket = join(root, 'control.sock')
  const tcp = createServer(socket => socket.destroy())
  const unix = createServer(socket => socket.destroy())
  try {
    await mkdir(home, { recursive: true })
    await writeFile(outside, 'outside-secret\n')
    await listen(tcp, { host: '127.0.0.1', port: 0 })
    await listen(unix, serviceSocket)
    const launcher = fileURLToPath(new URL('../command-boundary.py', import.meta.url))
    const config = JSON.stringify({ workspace, home, cwd: workspace, executable: process.execPath })
    const attempts = [
      ['outside-worktree', `cat '${outside}'`],
      ['control-page', `node -e "require('net').connect(${tcp.address().port},'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(23))"`],
      ['start-endpoint', `node -e "const http=require('http');const r=http.request({host:'127.0.0.1',port:${tcp.address().port},path:'/jobs',method:'POST'},()=>process.exit(0));r.on('error',()=>process.exit(24));r.end('{}')"`],
      ['server-service', `node -e "require('net').connect('${serviceSocket}').on('connect',()=>process.exit(0)).on('error',()=>process.exit(25))"`],
    ]
    for (const [name, command] of attempts) {
      await assert.rejects(execFile('python3', [launcher, config, command]), error => {
        assert.notEqual(error.code, 0, `${name} unexpectedly crossed the boundary`)
        return true
      })
    }
  } finally {
    await Promise.all([new Promise(resolve => tcp.close(resolve)), new Promise(resolve => unix.close(resolve))])
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
