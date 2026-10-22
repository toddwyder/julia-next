import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'

const require = createRequire(new URL('../package.json', import.meta.url))
const installed = require('@mastra/code-sdk/package.json')
const lock = JSON.parse(await readFile('ops/build-runner/package-lock.json', 'utf8'))
assert.equal(installed.version, '1.14.0')
assert.equal(lock.packages['node_modules/@mastra/code-sdk'].version, installed.version)
const files = []
async function collect(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const child = `${path}/${entry.name}`
    if (entry.isDirectory()) await collect(child)
    else if (/\.(mjs|py|json)$/.test(child)) files.push(child)
  }
}
await collect('ops/build-runner')
const sources = {}
for (const path of files.sort()) sources[path] = createHash('sha256').update(await readFile(path)).digest('hex')
const sourceHash = createHash('sha256').update(JSON.stringify(sources)).digest('hex')
const manifest = { sdkVersion: installed.version, sourceHash, sources }
const target = process.argv[2] ?? 'docs/agents/jul-251/evidence/build/source-manifest.json'
await writeFile(target, JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify({ target, sourceHash, files: files.length }))
