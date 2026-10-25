import test from 'node:test'
import assert from 'node:assert/strict'
import { COMMAND_INACTIVITY_MS, disabledRunnerTools, guardProcessIdle, guardSessionIdle, SESSION_INACTIVITY_MS } from '../adapter.mjs'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

test('a real build cannot request broader filesystem access', () => {
  const normal = disabledRunnerTools()
  assert.ok(normal.includes('request_access'))
  assert.ok(!normal.includes('mastra_workspace_read_file'))
})

test('the build and command inactivity windows are fifteen minutes', () => {
  assert.equal(SESSION_INACTIVITY_MS, 15 * 60 * 1000)
  assert.equal(COMMAND_INACTIVITY_MS, 15 * 60 * 1000)
})

test('a session guard turns idle only after the window with no activity', async () => {
  const guard = guardSessionIdle({ inactivityMs: 30 })
  guard.touch()
  await sleep(15)
  guard.touch()
  await sleep(15)
  assert.equal(guard.idle, false)
  await sleep(40)
  assert.equal(guard.idle, true)
  guard.stop()
})

test('command output resets the inactivity window', async () => {
  let killed = 0
  const handle = {
    kill: async () => { killed += 1; return true },
    wait: async (options = {}) => {
      for (let index = 0; index < 5; index += 1) {
        await sleep(10)
        options.onStdout?.('still working')
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    },
  }
  const guarded = guardProcessIdle(handle, 30)
  await guarded.wait()
  await sleep(50)
  assert.equal(killed, 0)
})

test('a command with no output is killed when the inactivity window expires', async () => {
  let killed = 0
  let finish
  const handle = {
    kill: async () => { killed += 1; return true },
    wait: async () => {
      await new Promise(resolve => { finish = resolve })
      return { exitCode: 0, stdout: '', stderr: '' }
    },
  }
  const guarded = guardProcessIdle(handle, 20)
  const waiting = guarded.wait()
  await sleep(40)
  assert.equal(killed, 1)
  finish()
  await waiting
})
