import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AuthStorage } from '@mastra/code-sdk/auth/storage'
import { openRunner } from '../adapter.mjs'
import { hydrateSettings, loadCatalogue } from '../catalogue.mjs'

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const settingsPath = join(root, 'ops/build-runner/machine-settings.json')
const outputPath = process.argv[2] ?? join(root, 'docs/agents/model-catalogue-2026-10-24/proof/subscription-requests.json')
const models = [
  { key: 'anthropic/claude-opus-5-5', marker: 'PROOF_CLAUDE_OPUS_5_5' },
  { key: 'anthropic/claude-sonnet-5-5', marker: 'PROOF_CLAUDE_SONNET_5_5' },
]

const catalogue = await loadCatalogue({ settingsPath })
const baseSettings = hydrateSettings(JSON.parse(await readFile(settingsPath, 'utf8')), catalogue)
assert.equal(baseSettings.authPath, '/home/ubuntu/.local/share/mastracode/auth.json')
const auth = new AuthStorage(baseSettings.authPath)
auth.allowEnvironmentFallback = false
assert.equal(auth.isLoggedIn('anthropic'), true, 'Claude subscription sign-in is required')
assert.equal(process.env.ANTHROPIC_API_KEY, undefined, 'the proof must not fall back to an API key')

const card = 'PROOF-001'
const workspaceRoot = await mkdtemp(join(tmpdir(), 'julia-subscription-proof-'))
const ledgerPath = join(workspaceRoot, 'cards.sqlite')
const results = []
try {
  for (const model of models) {
    const offer = catalogue.offers.find(candidate => candidate.route === 'claude' && candidate.modelId === catalogue.models[model.key]?.wireModel)
    assert(offer, `${model.key} must be offered by the Start catalogue`)
    const spec = catalogue.models[model.key]
    assert(spec, `${model.key} must carry a published price and bounds`)

    const workspace = join(workspaceRoot, model.marker)
    const stateDir = join(workspace, 'state')
    const cwd = join(workspace, 'workspace')
    await mkdir(cwd, { recursive: true })
    const settings = {
      ...baseSettings,
      ledgerPath,
      memory: false,
      roles: { proof: model.key },
    }
    const config = join(workspace, 'settings.json')
    await writeFile(config, JSON.stringify(settings))

    const runner = await openRunner({ card, settingsPath: config, cwd, stateDir, role: 'proof' })
    try {
      const before = runner.snapshot()
      const receipt = await runner.run({
        prompt: `Reply with exactly ${model.marker} and nothing else. Do not use tools.`,
        maxTurns: 3,
        timeoutMs: 120000,
      })
      const after = receipt.account
      const requests = after.requests.slice(before.requests.length)
      assert.equal(receipt.result.status, 'completed')
      assert.match(receipt.result.text, new RegExp(model.marker))
      assert.ok(requests.length > 0, 'a real request must reach the ledger')
      for (const request of requests) {
        assert.equal(request.state, 'settled')
        assert.equal(request.model, model.key)
        assert.deepEqual(request.price, spec.price)
        assert.ok(request.usage)
        assert.ok(request.costNano > 0)
      }
      const spent = Number(after.spentNano) - Number(before.spentNano)
      assert.ok(spent > 0)
      results.push({
        modelKey: model.key,
        offer,
        catalogue: {
          endpoint: spec.endpoint,
          wireModel: spec.wireModel,
          protocol: spec.protocol,
          maxInputTokens: spec.maxInputTokens,
          maxOutputTokens: spec.maxOutputTokens,
          publishedMaxOutputTokens: spec.publishedMaxOutputTokens,
          price: spec.price,
          source: spec.source,
          boundsSource: spec.boundsSource,
        },
        status: receipt.result.status,
        text: receipt.result.text,
        spentNano: spent,
        requests,
        account: {
          spentNano: after.spentNano,
          heldNano: after.heldNano,
          stopped: after.stopped,
          pricedBlocked: after.pricedBlocked,
        },
      })
    } finally {
      await runner.close()
    }
  }

  const finalLedger = results.at(-1).account
  const evidence = {
    generatedAt: new Date().toISOString(),
    card,
    catalogueSource: catalogue.sources,
    subscription: {
      provider: 'anthropic',
      authPath: baseSettings.authPath,
      signedIn: true,
      environmentApiKeyPresent: false,
      authKind: 'stock AuthStorage OAuth',
    },
    offers: results.map(result => result.offer),
    requests: results.map(result => ({
      modelKey: result.modelKey,
      catalogue: result.catalogue,
      status: result.status,
      text: result.text,
      spentNano: result.spentNano,
      requests: result.requests,
    })),
    account: finalLedger,
  }
  await mkdir(join(outputPath, '..'), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await rm(workspaceRoot, { recursive: true, force: true })
}
