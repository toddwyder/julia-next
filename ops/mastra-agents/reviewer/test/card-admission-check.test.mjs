import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { checkLinearCardAdmission } from '../src/mastra/card-admission-check.ts'
import { completeCardDescription, legacyFinishConditionsCardDescription, refusedFrameworkMap } from '../support/card-admission-test-fixtures/card-admission-descriptions.mjs'

function linearResponse(description, comments = []) {
  return async () => new Response(JSON.stringify({
    data: {
      issue: {
        identifier: 'JUL-243',
        title: 'A card awaiting settlement',
        description,
        comments: { nodes: comments.map(body => typeof body === 'string' ? { body } : body), pageInfo: { hasNextPage: false } },
        state: { name: 'Triage' },
      },
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

test('checks a Linear card as a Ready candidate without changing its current state', async () => {
  const result = await checkLinearCardAdmission('JUL-243', 'reference-only', linearResponse(completeCardDescription))

  assert.deepEqual(result, {
    identifier: 'JUL-243',
    currentState: 'Triage',
    admitted: true,
    issues: [],
  })
})

test('keeps accepting the legacy Finish conditions heading', async () => {
  const result = await checkLinearCardAdmission('JUL-243', 'reference-only', linearResponse(legacyFinishConditionsCardDescription))

  assert.equal(result.admitted, true)
  assert.deepEqual(result.issues, [])
})

test('returns the launcher contract findings for an inadmissible card', async () => {
  const result = await checkLinearCardAdmission('JUL-243', 'reference-only', linearResponse('## Outcome\n\nOne outcome.'))

  assert.equal(result.admitted, false)
  assert.deepEqual(result.issues, [
    'missing nonempty Requirements section',
    'missing nonempty Contracts section',
    'missing nonempty Acceptance criteria section',
    'missing nonempty Proof section',
  ])
})

test('the command checks every requested card and exits nonzero when one fails', () => {
  const script = fileURLToPath(new URL('../src/mastra/card-admission-check.ts', import.meta.url))
  const fetchFixture = new URL('../support/card-admission-test-fixtures/card-admission-fetch.mjs', import.meta.url).href
  const result = spawnSync(process.execPath, [
    '--experimental-strip-types', '--import', fetchFixture, script, 'JUL-243', 'JUL-244',
  ], {
    encoding: 'utf8',
    env: { ...process.env, LINEAR_API_KEY: 'reference-only' },
  })

  assert.equal(result.status, 1)
  assert.deepEqual(JSON.parse(result.stdout), [
    { identifier: 'JUL-243', currentState: 'Triage', admitted: true, issues: [] },
    {
      identifier: 'JUL-244',
      currentState: 'Triage',
      admitted: false,
      issues: [
        'missing nonempty Requirements section',
        'missing nonempty Contracts section',
        'missing nonempty Acceptance criteria section',
        'missing nonempty Proof section',
      ],
    },
  ])
})

test('the command refuses an empty card list', () => {
  const script = fileURLToPath(new URL('../src/mastra/card-admission-check.ts', import.meta.url))
  const result = spawnSync(process.execPath, ['--experimental-strip-types', script], {
    encoding: 'utf8',
    env: { ...process.env, LINEAR_API_KEY: 'reference-only' },
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /usage: card-admission-check\.ts JUL-nnn/)
})

test('refuses a fabricated installed section in the Framework Map comment', async () => {
  const map = '# Framework Map\n\n| Job | Feature | Documentation |\n| --- | --- | --- |\n| Store traces | Mastra exporter | `ops/mastra-agents/reviewer/node_modules/@mastra/core/dist/docs/references/reference-observability-tracing-configuration.md`, “Storage exporter” |'
  const result = await checkLinearCardAdmission('JUL-243', 'reference-only', linearResponse(completeCardDescription, [map]))
  assert.equal(result.admitted, false)
  assert.ok(result.issues.some(issue => issue.includes('Storage exporter')))
})

const installedPage = 'ops/mastra-agents/reviewer/node_modules/@libsql/client/README.md'
function frameworkRow(documentation, job = 'Store data') {
  return `# Framework Map\n\n| Job | Feature | Documentation |\n| --- | --- | --- |\n| ${job} | Storage | ${documentation} |`
}

for (const [label, map, expected, finding] of [
  ['package version is not a file citation', frameworkRow('Installed `@mastra/core@1.75.0`; https://mastra.ai/docs'), true],
  ['unscoped package citation', frameworkRow('`fastembed/ABSENT.md`'), false, 'installed file not found'],
  ['Windows installed citation', frameworkRow('`node_modules\\@libsql\\client\\ABSENT.md`'), false, 'installed file not found'],
  ['prose installed citation', '# Framework Map\nInstalled `@libsql/client/ABSENT.md`.', false, 'installed file not found'],
  ['prose framework gap', '# Framework Map\nRead sessions: Framework gap; no published page.', false, 'linked Todd decision'],
  ['plain installed path', frameworkRow('ops/mastra-agents/reviewer/node_modules/@libsql/client/ABSENT.md'), false, 'installed file not found'],
  ['versioned installed citation', `# Framework Map\n- Installed \`@libsql/client@0.18.0/README.md:1-3,5-8\`, “Invented section”`, false, 'Invented section'],
  ['missing installed file', frameworkRow('`ops/mastra-agents/reviewer/node_modules/@libsql/client/ABSENT.md`'), false, 'installed file not found'],
  ['non-Markdown installed file', frameworkRow('`@libsql/client/ABSENT.json`'), false, 'installed file not found'],
  ['real installed section', frameworkRow(`\`${installedPage}\`, “Quickstart”`), true],
  ['unapproved framework gap', frameworkRow('Framework gap: no published page'), false, 'linked Todd decision'],
  ['private files behind generic docs', frameworkRow('https://nodejs.org/docs/latest-v24.x/api/fs.html', 'Read private Codex files'), false, 'linked Todd decision'],
  ['linked Todd decision', frameworkRow('Framework gap; [Todd decision](https://linear.app/julia-next/issue/JUL-243#comment-decision)'), true],
  ['unrelated link is no decision', frameworkRow('Framework gap; https://nodejs.org/docs/latest-v24.x/api/fs.html'), false, 'linked Todd decision'],
  ['bullet citation', `# Framework Map\n- Installed \`${installedPage}\`, “Invented section”`, false, 'Invented section'],
  ['section before citation', frameworkRow(`“Invented section” in \`${installedPage}\``), false, 'Invented section'],
]) {
  test(`admission checks ${label}`, async () => {
    const result = await checkLinearCardAdmission('JUL-243', 'reference-only', linearResponse(completeCardDescription, [map]))
    assert.equal(result.admitted, expected)
    if (finding) assert.ok(result.issues.some(issue => issue.includes(finding)), JSON.stringify(result))
  })
}

test('follows a repository map reference and admits the current JUL-243 map', async () => {
  const result = await checkLinearCardAdmission('JUL-243', 'reference-only', linearResponse(
    completeCardDescription + '\nFramework Map: `docs/agents/jul-243-framework-map.md`',
  ))
  assert.equal(result.admitted, true, JSON.stringify(result.issues))
})

test('a later comment page cannot hide a Framework Map refusal', async () => {
  let reads = 0
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body)
    assert.equal(/\bmutation\b/.test(request.query), false)
    reads++
    const comments = reads === 1
      ? { nodes: [{ body: 'Unrelated comment' }], pageInfo: { hasNextPage: true, endCursor: 'next' } }
      : { nodes: [{ body: frameworkRow('Framework gap: no published page') }], pageInfo: { hasNextPage: false } }
    return new Response(JSON.stringify({ data: { issue: {
      identifier: 'JUL-243', description: completeCardDescription, state: { name: 'Triage' }, comments,
    } } }))
  }
  const result = await checkLinearCardAdmission('JUL-243', 'reference-only', fetchImpl)
  assert.equal(reads, 2)
  assert.equal(result.admitted, false)
  assert.ok(result.issues.some(issue => issue.includes('Store data')))
})

test('replays the exact refused JUL-243 map and the settled main map', async () => {
  const settledMap = readFileSync(new URL('../../../../docs/agents/jul-243-framework-map.md', import.meta.url), 'utf8')
  const refused = await checkLinearCardAdmission('JUL-243', 'reference-only', linearResponse(completeCardDescription, [refusedFrameworkMap]))
  const settled = await checkLinearCardAdmission('JUL-243', 'reference-only', linearResponse(completeCardDescription, [settledMap]))
  assert.equal(refused.admitted, false)
  assert.ok(refused.issues.some(issue => issue.includes('Storage exporter')))
  assert.ok(refused.issues.some(issue => issue.includes('Read persisted Mastra traces programmatically')))
  assert.ok(refused.issues.some(issue => issue.includes('Identify live native sessions')))
  assert.equal(settled.admitted, true, JSON.stringify(settled.issues))
})

test('the newest dated Framework Map replaces historical maps regardless of page order', async () => {
  const old = { body: refusedFrameworkMap, createdAt: '2026-10-19T10:00:00Z' }
  const current = { body: '# Framework Map\nSee `docs/agents/jul-243-framework-map.md`', createdAt: '2026-10-20T10:00:00Z' }
  for (const comments of [[old, current], [current, old]]) {
    const result = await checkLinearCardAdmission('JUL-243', 'reference-only', linearResponse(completeCardDescription, comments))
    assert.equal(result.admitted, true, JSON.stringify(result.issues))
  }
  const refused = await checkLinearCardAdmission('JUL-243', 'reference-only', linearResponse(completeCardDescription, [
    current, { ...old, createdAt: '2026-10-21T10:00:00Z' },
    { body: 'I reviewed the Framework Map today.', createdAt: '2026-10-22T10:00:00Z' },
  ]))
  assert.equal(refused.admitted, false)
  assert.ok(refused.issues.some(issue => issue.includes('Storage exporter')))
})
