import { writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'

const ledgerPath = '/home/ubuntu/.local/state/julia-machine/cards.sqlite'
const outputPath = new URL('./spend.json', import.meta.url)
const capNano = 10_000_000_000
const db = new DatabaseSync(ledgerPath, { readOnly: true })
const rows = db.prepare("select model, role, state, maximum_nano, cost_nano from requests where card = 'JUL-252' order by rowid").all()
const total = list => list.reduce((sum, row) => sum + (row.cost_nano ?? 0), 0)
const group = list => {
  const models = {}
  for (const row of list) {
    models[row.model] ??= { requests: 0, costNano: 0 }
    models[row.model].requests += 1
    models[row.model].costNano += row.cost_nano ?? 0
  }
  return models
}
const first = rows.slice(0, 1)
const second = rows.slice(1, 8)
const current = rows.slice(8)
const stopped = Boolean(db.prepare("select 1 from stops where card = 'JUL-252'").get())
const snapshot = {
  capturedAt: new Date().toISOString(),
  capNano,
  total: { requests: rows.length, spentNano: total(rows), remainingNano: capNano - total(rows), stopped },
  runs: {
    firstFailedRun: { requests: first.length, spentNano: total(first), note: 'plan only; the build request was refused by the old worst-case reservation', models: group(first) },
    secondFailedRun: { requests: second.length, spentNano: total(second), note: 'plan plus six build turns; the next worst-case reservation exceeded the old $2 remainder before the checklist', models: group(second) },
    currentRun: { requests: current.length, spentNano: total(current), note: 'running at capture; settled actual spend gates the $10 cap', models: group(current) },
  },
  taskKinds: {
    'Main session, how, architecture synthesis, throughput checkpoint and orchestration': 'anthropic/claude-opus-5-5',
    'Architect design panel candidate': 'anthropic/claude-haiku-5-5 and commandcode/deepseek/deepseek-v4.1-flash',
    'Delegated coding and swarm work': 'commandcode/deepseek/deepseek-v4.1-flash',
  },
  inFlight: current.filter(row => row.state === 'reserved').length,
  ledgerRole: 'orchestrator (the adapter opens one role for the whole session; the model identifies the task kind)',
}
db.close()
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`)
console.log(JSON.stringify(snapshot, null, 2))
