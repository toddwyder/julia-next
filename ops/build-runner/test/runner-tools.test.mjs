import test from 'node:test'
import assert from 'node:assert/strict'
import { disabledRunnerTools } from '../adapter.mjs'

test('a real build cannot request broader filesystem access', () => {
  const normal = disabledRunnerTools(false)
  assert.ok(normal.includes('request_access'))
  assert.ok(!normal.includes('mastra_workspace_read_file'))
})

test('a plan-only turn cannot use workspace tools', () => {
  const planning = disabledRunnerTools(true)
  for (const tool of ['request_access', 'mastra_workspace_read_file', 'mastra_workspace_list_files', 'execute_command']) {
    assert.ok(planning.includes(tool))
  }
})
