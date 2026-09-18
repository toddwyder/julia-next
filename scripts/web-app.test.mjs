import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { emitBootEvents } from '../lib/boot-events.js';

const ROOT = path.resolve(import.meta.dirname, '..');

const REQUIRED_FILES = [
  'package.json',
  'next.config.mjs',
  'app/layout.jsx',
  'app/page.jsx',
  'instrumentation.js',
  'lib/boot-events.js',
  '.env.example',
  '.gitignore',
];

// A real Sentry DSN embeds a hex public key before the host, e.g.
// https://<hex>@o000000.ingest.sentry.io/0000000; a real Axiom token has a
// distinctive prefix. Neither may ever be committed as a literal.
const SENTRY_DSN = /https:\/\/[0-9a-f]+@[^/\s]+\/\d+/;
const AXIOM_TOKEN = /xa[ai]t-/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

test('(a) every required web-app file exists', () => {
  const missing = REQUIRED_FILES.filter((name) => !existsSync(path.join(ROOT, name)));
  assert.deepEqual(missing, [], `missing required files: ${missing.join(', ')}`);
});

test('(b) app/page.jsx contains the exact text "Julia is ready"', () => {
  const page = readFileSync(path.join(ROOT, 'app/page.jsx'), 'utf8');
  assert.ok(page.includes('Julia is ready'), 'app/page.jsx must render "Julia is ready"');
});

test('(c) no literal Sentry DSN or Axiom token under app/ or lib/', () => {
  const offenders = [];
  for (const base of ['app', 'lib']) {
    const dir = path.join(ROOT, base);
    if (!existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const content = readFileSync(file, 'utf8');
      if (SENTRY_DSN.test(content) || AXIOM_TOKEN.test(content)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
  }
  assert.deepEqual(offenders, [], `literal credentials found in: ${offenders.join(', ')}`);
});

test('(d) .env.example lists placeholders only', () => {
  const content = readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  assert.ok(content.includes('REPLACE_ME'), '.env.example must contain REPLACE_ME');

  const entries = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  const values = Object.fromEntries(
    entries.map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1)];
    }),
  );

  assert.deepEqual(Object.keys(values).sort(), [
    'AXIOM_DATASET',
    'AXIOM_TOKEN',
    'NEXT_PUBLIC_SENTRY_DSN',
  ]);
  assert.equal(values.NEXT_PUBLIC_SENTRY_DSN, 'REPLACE_ME');
  assert.equal(values.AXIOM_TOKEN, 'REPLACE_ME');
  assert.equal(values.AXIOM_DATASET, 'julia-next-server');

  // No credential-looking value beyond the placeholders.
  assert.ok(!AXIOM_TOKEN.test(content), '.env.example must not contain an Axiom token');
  assert.ok(!SENTRY_DSN.test(content), '.env.example must not contain a Sentry DSN');
});

test('(e) empty env skips both halves, makes zero fetches, and never throws', async () => {
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return { ok: true };
  };

  const result = await emitBootEvents({ env: {}, fetchImpl });

  assert.deepEqual(result, { sentry: false, axiom: false });
  assert.equal(fetchCalls, 0);
});

test('(f) a configured Axiom half posts exactly one event to the dataset URL', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true };
  };

  const result = await emitBootEvents({
    env: { AXIOM_TOKEN: 'placeholder-token', AXIOM_DATASET: 'placeholder-dataset' },
    fetchImpl,
  });

  assert.equal(result.axiom, true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes('placeholder-dataset'), 'ingest URL must name the dataset');

  const body = JSON.parse(calls[0].options.body);
  assert.ok(Array.isArray(body), 'ingest body must be a JSON array');
  assert.equal(body.length, 1);
  assert.equal(body[0].event, 'julia-next.boot');
  assert.equal(typeof body[0]._time, 'string');
});

test('(h) the credential tripwires match real credential prefixes', () => {
  // Synthetic tokens are assembled at runtime by string concatenation so that
  // no literal credential-like string is ever committed to the repository.
  const xaatToken = ['xa', 'at-', '0123456789abcdef'].join('');
  const xaitToken = ['xa', 'it-', '0123456789abcdef'].join('');
  assert.ok(AXIOM_TOKEN.test(xaatToken), 'tripwire must match an xaat- Axiom token');
  assert.ok(AXIOM_TOKEN.test(xaitToken), 'tripwire must match an xait- Axiom token');

  const selfHostedDsn = ['https://', '0123456789abcdef', '@sentry.example.com/1'].join('');
  assert.ok(SENTRY_DSN.test(selfHostedDsn), 'tripwire must match a self-hosted Sentry DSN');

  const sentryIoDsn = ['https://', '0123456789abcdef', '@o000000.ingest.sentry.io/0000000'].join('');
  assert.ok(SENTRY_DSN.test(sentryIoDsn), 'tripwire must match a sentry.io ingest-host DSN');
});

test('(g) a rejecting fetch implementation is swallowed', async () => {
  const fetchImpl = async () => {
    throw new Error('network unavailable');
  };

  const result = await emitBootEvents({
    env: { AXIOM_TOKEN: 'placeholder-token', AXIOM_DATASET: 'placeholder-dataset' },
    fetchImpl,
  });

  assert.equal(result.axiom, true);
});

test('a configured Sentry half initializes once and captures one boot message', async () => {
  const inits = [];
  const captured = [];
  const sentryImpl = {
    init: (options) => inits.push(options),
    captureMessage: (message, level) => captured.push([message, level]),
  };

  const result = await emitBootEvents({
    env: { NEXT_PUBLIC_SENTRY_DSN: 'placeholder-dsn' },
    sentryImpl,
  });

  assert.equal(result.sentry, true);
  assert.equal(inits.length, 1);
  assert.equal(inits[0].dsn, 'placeholder-dsn');
  assert.deepEqual(captured, [['julia-next: boot', 'info']]);
});

test('a failing Sentry implementation is swallowed', async () => {
  const sentryImpl = {
    init: () => {
      throw new Error('sentry unavailable');
    },
    captureMessage: () => {},
  };

  const result = await emitBootEvents({
    env: { NEXT_PUBLIC_SENTRY_DSN: 'placeholder-dsn' },
    sentryImpl,
  });

  assert.equal(result.sentry, true);
});

test('a rejecting Sentry captureMessage promise is swallowed without an unhandled rejection', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    const sentryImpl = {
      init: () => {},
      captureMessage: async () => {
        throw new Error('sentry capture failed');
      },
    };

    const result = await emitBootEvents({
      env: { NEXT_PUBLIC_SENTRY_DSN: 'placeholder-dsn' },
      sentryImpl,
    });

    assert.equal(result.sentry, true);

    // Let any escaped rejection surface before asserting it never happened.
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, [], 'emitBootEvents must not produce an unhandled rejection');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
