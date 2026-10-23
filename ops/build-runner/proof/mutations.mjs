import { createHash } from 'node:crypto';
import { mkdirSync, openSync, closeSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const evidence = resolve(root, process.argv[2] ?? 'docs/agents/jul-251/evidence/build');
const ledger = 'ops/build-runner/ledger.mjs';
const transport = 'ops/build-runner/transport.mjs';
const adapter = 'ops/build-runner/adapter.mjs';
const boundary = 'ops/build-runner/command-boundary.py';
const session = 'ops/build-runner/pstack-session.mjs';
const machineSettings = 'ops/build-runner/machine-settings.json';
const tests = file => `ops/build-runner/test/${file}.test.mjs`;
const edit = (file, before, after, occurrences = 1) => ({ file, before, after, occurrences });
const cases = [
  {
    id: 'unreachable-long-context-rate-reserved', file: 'transport', test: 'reservation uses only context tiers reachable within 150000 input tokens',
    edits: [edit(transport, '(spec.priceTiers ?? []).filter(tier => inputBound > tier.aboveInputTokens)', '(spec.priceTiers ?? [])')],
  },
  {
    id: 'logged-request-forwarded-after-body-transfer', file: 'request-observer', test: 'observing a stock streamed Request preserves its body for accounting and dispatch',
    edits: [edit('ops/build-runner/request-observer.mjs', 'transportFetch(request)', 'transportFetch(input, init)')],
  },
  {
    id: 'raw-model-provider-route-not-checked', file: 'pstack-session', test: 'a raw model ID cannot silently change the selected provider route',
    edits: [edit(session, 'expected != null && actual != null && expected !== actual', 'false')],
  },
  {
    id: 'unavailable-subscription-offered', file: 'connections', test: 'an explicitly unavailable or invalidly priced configured model is not advertised',
    edits: [edit('ops/build-runner/connections.mjs', ' || spec.unavailable', '')],
  },
  {
    id: 'local-estimate-not-used', file: 'transport', test: 'local text estimate reserves framing and UTF-8 bytes without a credential or count request',
    edits: [edit(transport, 'inputBound = units * estimate.multiplier + estimate.framingTokens;', 'inputBound = spec.maxInputTokens;')],
  },
  {
    id: 'local-estimate-padding-removed', file: 'transport', test: 'bundled local tokenizer reserves padded complete request for hello',
    edits: [edit(transport, 'inputBound = units * estimate.multiplier + estimate.framingTokens;', 'inputBound = units;')],
  },
  {
    id: 'local-estimate-overrun-ignored', file: 'transport', test: 'a provider input count above the local estimate settles actual cost and stops later work',
    edits: [edit(transport, 'spec.inputTokenEstimate && inputTokens > inputBound', 'false')],
  },
  {
    id: 'stock-sse-without-content-type-not-parsed', file: 'transport', test: 'a stock Codex stream without a content-type header settles its completed usage',
    edits: [edit(transport, "response.headers.get('content-type') ?? (bounded.stream ? 'text/event-stream' : '')", "response.headers.get('content-type') ?? ''")],
  },
  {
    id: 'hidden-conversation-not-refused', file: 'transport', test: 'local estimates include tools and refuse hidden conversation state before dispatch',
    edits: [edit(transport, "if (body.previous_response_id || body.conversation) throw fail('Local input estimate requires explicit conversation input');", '')],
  },
  {
    id: 'stock-hosted-search-not-disabled', file: 'subscription-tools', test: 'stock subscription requests can dispatch without unpriced hosted search',
    edits: [edit(adapter, ", disabledTools: ['web_search']", '')],
  },
  {
    id: 'cache-ttl-mismatch-accepted', file: 'transport', test: 'stock Claude conversation caching uses its configured one-hour API price',
    edits: [edit(transport, "if (value.cache_control && (value.cache_control.ttl ?? '5m') !== cacheWriteTtl) return true;", '')],
  },
  {
    id: 'one-hour-cache-write-charged-at-five-minute-rate', file: 'transport', test: 'stock Claude conversation caching uses its configured one-hour API price',
    edits: [edit(machineSettings, '"cacheWrite": 0.2', '"cacheWrite": 0.125')],
  },
  {
    id: 'maximum-charge-recovery-not-final', file: 'ledger', test: 'charging an unknown request at its full maximum never releases budget or invents usage',
    edits: [edit(ledger, "if (current.state === 'unknown' && current.costNano !== null) throw new Error('Maximum-charge recovery is final; actual usage remains unknown');", '')],
  },
  {
    id: 'configured-panel-replaced-by-unrelated-model', file: 'pstack-session', test: 'an unrelated review model cannot replace the configured Sol and DeepSeek panel',
    edits: [edit(session, 'return start.modelId === model', 'return start.modelId !== coderModel')],
  },
  {
    id: 'unknown-maximum-charged-as-zero', file: 'ledger', test: 'charging an unknown request at its full maximum never releases budget or invents usage',
    edits: [edit(ledger, 'cost_nano = maximum_nano, reason = ?', 'cost_nano = 0, reason = ?')],
  },
  ...['chat SSE', 'responses SSE', 'messages JSON', 'messages SSE'].map(protocol => ({
    id: `${protocol.replaceAll(' ', '-').toLowerCase()}-charge-corrupted`, file: 'transport', test: `${protocol} settles cache categories once`,
    edits: [edit(transport, 'const costNano = Math.max(usage ? totalCharge', 'const costNano = 1 + Math.max(usage ? totalCharge')],
  })),
  {
    id: 'invalid-money-defaulted-to-zero', file: 'ledger', test: 'invalid monetary inputs cannot change durable budget',
    edits: [edit(ledger, "integer(maximumNano, 'maximumNano');", 'maximumNano = 0;')],
  },
  {
    id: 'concurrent-admission-checks-removed', file: 'ledger', test: 'separate processes cannot jointly reserve beyond the ceiling',
    edits: [
      edit(ledger, "if (maximumNano > 0 && snapshot.pricedBlocked) throw new Error('Priced requests blocked by unresolved accounting');", ''),
      edit(ledger, 'BigInt(snapshot.spentNano) + BigInt(snapshot.heldNano) + BigInt(maximumNano) > BigInt(CEILING_NANO)', 'false'),
    ],
  },
  {
    id: 'connection-failure-not-marked-unknown', file: 'transport', test: 'connection failure after arrival retains the paid reservation',
    edits: [edit(transport, "if (!settled) await ledgerCall('unknown', id, 'Request outcome unavailable');", '')],
  },
  {
    id: 'card-ceiling-removed', file: 'ledger', test: 'all roles share the two-dollar card ceiling across reopen and settle once',
    edits: [edit(ledger, 'BigInt(snapshot.spentNano) + BigInt(snapshot.heldNano) + BigInt(maximumNano) > BigInt(CEILING_NANO)', 'false')],
  },
  {
    id: 'unresolved-priced-block-removed', file: 'ledger', test: 'free requests remain usable without usage when priced accounting is unknown',
    edits: [edit(ledger, "if (maximumNano > 0 && snapshot.pricedBlocked) throw new Error('Priced requests blocked by unresolved accounting');", '')],
  },
  {
    id: 'zero-settlement-corrupted', file: 'ledger', test: 'free requests remain usable without usage when priced accounting is unknown',
    edits: [edit(ledger, ".run(failure ? 'accounting_failure' : 'settled', usageJson, costNano,", ".run(failure ? 'accounting_failure' : 'settled', usageJson, costNano === 0 ? 1 : costNano,")],
  },
  {
    id: 'persistent-storage-replaced-with-memory', file: 'ledger', test: 'reopening retains unresolved holds, snapshots, and settled costs per card',
    edits: [edit(ledger, "new DatabaseSync(nonempty(path, 'path'))", "new DatabaseSync(':memory:')")],
  },
  {
    id: 'process-exit-hold-not-persisted', file: 'ledger', test: 'a process exit after reservation never releases an uncertain request',
    edits: [edit(ledger, "new DatabaseSync(nonempty(path, 'path'))", "new DatabaseSync(':memory:')")],
  },
  {
    id: 'priced-settlement-usage-check-removed', file: 'ledger', test: 'free requests remain usable without usage when priced accounting is unknown',
    edits: [edit(ledger, "if (current.maximumNano > 0 && (usage === undefined || usage === null)) throw new Error('Priced settlement requires usage');", '')],
  },
  {
    id: 'settlement-idempotency-check-removed', file: 'ledger', test: 'all roles share the two-dollar card ceiling across reopen and settle once',
    edits: [edit(ledger, 'current.costNano !== costNano || !isDeepStrictEqual(current.usage, usageJson === null ? null : JSON.parse(usageJson))', 'false')],
  },
  {
    id: 'overrun-block-removed', file: 'ledger', test: 'actual cost above a reservation is durable and blocks priced work',
    edits: [edit(ledger, 'const failure = costNano > current.maximumNano;', 'const failure = false;')],
  },
  {
    id: 'unpriced-model-defaulted-to-free', file: 'transport', test: 'wrong model, endpoint, missing prices and bounds send nothing',
    edits: [edit(transport, 'const prices = [spec.price, ...tiers.map(tier => tier.price)];', 'spec.price ??= Object.fromEntries(categories.map(key => [key, 0])); const prices = [spec.price, ...tiers.map(tier => tier.price)];')],
  },
  {
    id: 'ceiling-http-dispatch-allowed', file: 'transport', test: 'card ceiling refuses an oversized reservation before HTTP',
    edits: [edit(ledger, 'BigInt(snapshot.spentNano) + BigInt(snapshot.heldNano) + BigInt(maximumNano) > BigInt(CEILING_NANO)', 'false')],
  },
  {
    id: 'http-attempt-identifier-reused', file: 'transport', test: 'separate HTTP attempts create separate durable records',
    edits: [edit(ledger, 'const id = randomUUID();', "const id = 'reused-attempt-id';")],
  },
  {
    id: 'unknown-route-falls-back-to-first-model', file: 'transport', test: 'wrong model, endpoint, missing prices and bounds send nothing',
    edits: [edit(transport, 'const spec = routes.get(JSON.stringify([endpoint, body.model]));', 'const spec = routes.get(JSON.stringify([endpoint, body.model])) ?? routes.values().next().value;')],
  },
  {
    id: 'chat-output-limit-removed', file: 'transport', test: 'free requests arrive with enforced limits and settle without usage',
    edits: [edit(transport, 'bounded.max_tokens = spec.maxOutputTokens;', '')],
  },
  {
    id: 'responses-output-limit-removed', file: 'transport', test: 'responses JSON settles cache categories once',
    edits: [edit(transport, 'bounded.max_output_tokens = spec.maxOutputTokens;', '')],
  },
  {
    id: 'missing-paid-usage-accepted', file: 'transport', test: 'paid missing usage refuses result and prevents the next arrival',
    edits: [
      edit(transport, "if (spec.paid) throw fail('Paid request usage is unavailable');", ''),
      edit(ledger, "if (current.maximumNano > 0 && (usage === undefined || usage === null)) throw new Error('Priced settlement requires usage');", ''),
    ],
  },
  {
    id: 'reported-cost-not-counted', file: 'transport', test: 'provider cost above a configured free reservation is recorded and stops its card',
    edits: [edit(transport, 'reportedNano);', '0);')],
  },
  {
    id: 'over-reservation-stop-not-persisted', file: 'transport', test: 'provider cost above a configured free reservation is recorded and stops its card',
    edits: [edit(transport, "await ledgerCall('stop', 'Request cost exceeds configured reservation');", '')],
  },
  {
    id: 'stop-marker-not-persisted', file: 'review-regressions', test: 'review durable stop survives reopen and blocks free and paid routes only for its card',
    edits: [edit(ledger, "this.db.prepare('INSERT OR IGNORE INTO stops (card, reason) VALUES (?, ?)').run(this.card, reason);", 'void reason;')],
  },
  {
    id: 'stop-marker-lost-on-reopen', file: 'review-regressions', test: 'review durable stop survives reopen and blocks free and paid routes only for its card',
    edits: [edit(ledger, "new DatabaseSync(nonempty(path, 'path'))", "new DatabaseSync(':memory:')")],
  },
  {
    id: 'stopped-card-metadata-allowed', file: 'review-regressions', test: 'review stopped card blocks allowlisted metadata GET',
    edits: [edit(transport, "if ((await ledgerCall('snapshot')).stopped) throw fail('STOP WORK: card account is stopped');", '')],
  },
  {
    id: 'known-overbound-usage-not-recorded', file: 'review-regressions', test: 'review oversized known usage records actual cost and refuses result',
    edits: [edit(transport, "await ledgerCall('settle', id, { usage: usage ?? null, costNano });", '')],
  },
  {
    id: 'known-overbound-result-accepted', file: 'review-regressions', test: 'review oversized known usage records actual cost and refuses result',
    edits: [edit(transport, 'if (costNano > maximumNano) {', 'if (false) {')],
  },
  {
    id: 'cached-input-double-counted', file: 'transport', test: 'chat JSON settles cache categories once',
    edits: [edit(transport, 'input: raw.prompt_tokens - cached,', 'input: raw.prompt_tokens,')],
  },
  {
    id: 'nano-dollar-conversion-corrupted', file: 'transport', test: 'decimal rates round nano dollars upward without floating point drift',
    edits: [edit(transport, 'BigInt(tokens) * BigInt(whole + fraction) * 1000n', 'BigInt(tokens) * BigInt(whole + fraction) * 100n')],
  },
  {
    id: 'cache-write-input-double-counted', file: 'transport', test: 'responses JSON settles cache categories once',
    edits: [edit(transport, 'if (usage.cacheWrite !== 0) usage.input -= usage.cacheWrite;', '', 2)],
  },
  {
    id: 'truncated-paid-sse-accepted', file: 'transport', test: 'a truncated paid stream retains the reservation despite partial usage',
    edits: [edit(transport, "if (!completed) throw fail('Incomplete request stream');", '')],
  },
  {
    id: 'redirects-followed', file: 'transport', test: 'allowlisted authentication cannot carry inference payloads and redirects never follow',
    edits: [
      edit(transport, "redirect: 'error'", "redirect: 'follow'", 4),
      edit(transport, "if (response.status >= 300 && response.status < 400) throw fail('Redirect refused');", ''),
    ],
  },
  {
    id: 'response-buffer-bound-removed', file: 'transport', test: 'bounded buffering refuses a large result without releasing its reservation',
    edits: [edit(transport, "if (length > maximum) throw fail('Response exceeds configured limit');", '')],
  },
  {
    id: 'metadata-child-url-allowed', file: 'transport', test: 'authentication and catalog are confined to their exact allowlisted URL',
    edits: [edit(transport, "if (request.method === 'GET' && allowed.has(endpoint))", "if (request.method === 'GET')")],
  },
  {
    id: 'ledger-errors-no-longer-sanitized', file: 'transport', test: 'ledger errors never reveal their underlying body or credentials',
    edits: [edit(transport, "catch { throw fail('Request ledger refused operation'); }", 'catch (error) { throw error; }')],
  },
  {
    id: 'state-and-ledger-paths-not-canonicalized', file: 'review-regressions', test: 'review stock adapter rejects state symlink into builder before runtime',
    edits: [
      edit(adapter, 'stateDir = await realpath(stateDir)', 'stateDir = resolve(stateDir)'),
      edit(adapter, `  try { ledgerPath = await realpath(ledgerPath) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    ledgerPath = join(await realpath(dirname(ledgerPath)), basename(ledgerPath))
  }`, ''),
    ],
  },
  {
    id: 'auth-file-not-canonicalized', file: 'review-regressions', test: 'review stock adapter rejects auth-file symlink into builder before runtime',
    edits: [edit(adapter, 'try { authPath = await realpath(authPath) }', 'try { authPath = resolve(authPath) }')],
  },
  {
    id: 'auth-parent-not-canonicalized', file: 'review-regressions', test: 'review stock adapter rejects auth-parent symlink into builder before runtime',
    edits: [edit(adapter, 'authPath = join(await realpath(dirname(authPath)), basename(authPath))', 'authPath = join(dirname(authPath), basename(authPath))')],
  },
  {
    id: 'mutable-home-granted-outside-workspace', file: 'review-regressions', test: 'review replacing builder home after boot cannot expose outside auth',
    edits: [edit(boundary, 'paths += [(workspace, access)]', 'paths += [(workspace, access), (home, access)]')],
  },
  {
    id: 'credential-filesystem-boundary-removed', file: 'adapter', test: 'stock adapter request works while direct and nested builder commands cannot read credentials',
    edits: [edit(boundary, '        restrict(config["workspace"], config["home"], config["executable"])', '        pass')],
  },
];

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function run(args, expectedTest) {
  const result = spawnSync(process.execPath, args, {
    cwd: root, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const failed = [...output.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1].trim());
  const passed = [...output.matchAll(/^ok \d+ - (.+)$/gm)].map(match => match[1].trim());
  return {
    command: ['node', ...args], exitCode: result.status, signal: result.signal,
    status: result.error ? 'execution-error' : result.status === 0 ? 'green' : 'red',
    selectedTest: expectedTest ?? null,
    selectedPassed: expectedTest ? passed.includes(expectedTest) : null,
    selectedFailed: expectedTest ? failed.includes(expectedTest) : null,
    passedCount: passed.length, failedCount: failed.length,
  };
}

mkdirSync(evidence, { recursive: true });
const lock = join(evidence, '.mutations.lock');
const descriptor = openSync(lock, 'wx');
const originals = new Map([...new Set(cases.flatMap(item => item.edits.map(change => change.file)))].map(file => [file, readFileSync(join(root, file), 'utf8')]));
const allTests = readdirSync(join(root, 'ops/build-runner/test')).filter(name => name.endsWith('.test.mjs')).sort().map(name => `ops/build-runner/test/${name}`);
const report = {
  schema: 1,
  plannedMutations: cases.length,
  sourceHashes: Object.fromEntries([...originals].map(([file, source]) => [file, createHash('sha256').update(source).digest('hex')])),
  baseline: null, mutations: [], final: null,
  gaps: ['Removing the transaction lock is not tested here. The current process race has no deterministic barrier.'],
};
let failed = false;
try {
  report.baseline = run(['--test', '--test-reporter=tap', ...allTests]);
  if (report.baseline.status !== 'green') throw new Error('baseline-not-green');
  for (const candidate of cases) {
    const record = { id: candidate.id, files: [...new Set(candidate.edits.map(change => change.file))], test: candidate.test, status: 'pending' };
    report.mutations.push(record);
    try {
      const mutated = new Map();
      for (const change of candidate.edits) {
        const source = mutated.get(change.file) ?? originals.get(change.file);
        if (source.split(change.before).length - 1 !== change.occurrences) throw new Error('source-drift');
        mutated.set(change.file, source.replaceAll(change.before, change.after));
      }
      for (const [file, source] of mutated) writeFileSync(join(root, file), source);
      record.result = run(['--test', '--test-reporter=tap', `--test-name-pattern=^${escape(candidate.test)}$`, tests(candidate.file)], candidate.test);
      record.status = record.result.status === 'red' && record.result.selectedFailed ? 'caught' : 'not-proven';
      if (record.status !== 'caught') failed = true;
    } catch (error) {
      record.status = error.message === 'source-drift' ? 'source-drift' : 'mutation-error';
      failed = true;
    } finally {
      for (const file of record.files) writeFileSync(join(root, file), originals.get(file));
    }
    writeFileSync(join(evidence, 'mutations.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ mutation: record.id, test: record.test, status: record.status }));
    if (record.status === 'source-drift') break;
  }
} catch {
  failed = true;
} finally {
  for (const [file, source] of originals) writeFileSync(join(root, file), source);
  report.final = run(['--test', '--test-reporter=tap', ...allTests]);
  if (report.final.status !== 'green') failed = true;
  report.restored = [...originals].every(([file, source]) => readFileSync(join(root, file), 'utf8') === source);
  if (!report.restored) failed = true;
  report.status = failed ? 'failed' : 'passed';
  writeFileSync(join(evidence, 'mutations.json'), JSON.stringify(report, null, 2) + '\n');
  closeSync(descriptor);
  rmSync(lock);
}
console.log(JSON.stringify({ status: report.status, caught: report.mutations.filter(item => item.status === 'caught').length, total: cases.length, restored: report.restored, final: report.final.status }));
if (failed) process.exitCode = 1;
