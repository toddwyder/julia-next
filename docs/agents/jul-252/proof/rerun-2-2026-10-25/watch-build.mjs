import { readFile, appendFile, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'

const jobDir = '/home/ubuntu/.local/state/julia-jul231/jobs-attempt-2/jul-252-04db241d9dbeda4fc7d58701cd7b66d2'
const ledgerPath = '/home/ubuntu/.local/state/julia-machine/cards.sqlite'
const snapshotsPath = new URL('./checklist-spend.jsonl', import.meta.url)
const finalChecklistPath = new URL('./checklist-final.md', import.meta.url)
const finalJobPath = new URL('./job-final.json', import.meta.url)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

let lastChecklist = null
let lastState = null
let lastWrite = 0
for (;;) {
  let job
  try { job = JSON.parse(await readFile(`${jobDir}/job.json`, 'utf8')) } catch { await sleep(5000); continue }
  let checklist = ''
  try { checklist = await readFile(`${jobDir}/worktree/.builder-home/pstack/checklist.md`, 'utf8') } catch {}
  const db = new DatabaseSync(ledgerPath, { readOnly: true })
  const rows = db.prepare("select model, state, cost_nano from requests where card = 'JUL-252' order by rowid").all()
  db.close()
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
  const current = rows.slice(8)
  const snapshot = {
    at: new Date().toISOString(),
    state: job.state,
    spentNano: total(rows),
    currentSpentNano: total(current),
    byModel: group(rows),
    currentByModel: group(current),
    checklist,
  }
  if (checklist !== lastChecklist || job.state !== lastState || Date.now() - lastWrite >= 5 * 60 * 1000) {
    await appendFile(snapshotsPath, `${JSON.stringify(snapshot)}\n`)
    lastChecklist = checklist
    lastState = job.state
    lastWrite = Date.now()
  }
  if (job.state !== 'running') {
    await writeFile(finalChecklistPath, checklist)
    await writeFile(finalJobPath, `${JSON.stringify(job, null, 2)}\n`)
    console.log(JSON.stringify({ done: true, state: job.state, at: snapshot.at, currentSpentNano: snapshot.currentSpentNano }))
    break
  }
  await sleep(5000)
}
