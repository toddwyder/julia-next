import { openRunner } from '../adapter.mjs'

const [settingsPath, cwd, stateDir] = process.argv.slice(2)

for (let attempt = 0; attempt < 2; attempt += 1) {
  const runner = await openRunner({ card: 'JUL-900', settingsPath, cwd, stateDir, role: 'builder' })
  await runner.close()
}

console.log('sequential runners ok')
