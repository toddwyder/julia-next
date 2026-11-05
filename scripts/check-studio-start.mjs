import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKFLOW = 'card-path';
export const FORM_FIELDS = ['card', 'kind'];

function unwrapSchema(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return parsed?.json ?? parsed ?? {};
}

export function runForm(workflows) {
  const list = Array.isArray(workflows) ? workflows : Object.values(workflows ?? {});
  const entry = list.find(workflow => workflow?.name === WORKFLOW || workflow?.id === WORKFLOW);
  if (!entry) return { fields: [], failures: [`The server does not serve a workflow named ${WORKFLOW}.`] };
  const schema = unwrapSchema(entry.inputSchema);
  const fields = Object.keys(schema.properties ?? {});
  const failures = [];
  if (fields.join(',') !== FORM_FIELDS.join(',')) {
    failures.push(`The run form asks for ${fields.join(', ') || 'nothing'} instead of ${FORM_FIELDS.join(' and ')}.`);
  }
  for (const field of FORM_FIELDS) {
    if (schema.required?.includes(field) !== true) failures.push(`The run form does not require ${field}.`);
  }
  if (schema.additionalProperties !== false) failures.push('The run form accepts fields the card does not name.');
  return { fields, failures };
}

async function freePort() {
  const server = createServer();
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', done);
  });
  const { port } = server.address();
  await new Promise(done => server.close(done));
  return port;
}

async function fetchWorkflows(port) {
  const response = await fetch(`http://localhost:${port}/api/workflows`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`the server answered ${response.status} at /api/workflows`);
  return response.json();
}

async function waitForWorkflows(port, child, log, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (child.exitCode !== null) {
      const reason = /Another development server instance is already running/.test(log.text)
        ? 'another Studio server is already running in this directory; stop it, then run this check'
        : `the Studio server exited with code ${child.exitCode}`;
      throw new Error(reason);
    }
    try {
      return await fetchWorkflows(port);
    } catch (error) {
      if (Date.now() > deadline) throw new Error(`the Studio server did not answer within ${timeoutMs} ms: ${error.message}`);
      await new Promise(done => setTimeout(done, 1000));
    }
  }
}

export async function checkStudioStart({ root = process.cwd(), timeoutMs = 180000, env = process.env } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'studio-check-'));
  const port = await freePort();
  const log = { text: '' };
  const child = spawn('npm', ['exec', '--yes', 'mastra@1.38.0', 'dev'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...env, PORT: String(port), FLOW_DIR: dir, MASTRA_TELEMETRY_DISABLED: '1' },
  });
  const keep = chunk => {
    log.text = (log.text + chunk).slice(-20000);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  try {
    const workflows = await waitForWorkflows(port, child, log, timeoutMs);
    const form = runForm(workflows);
    return { port, fields: form.fields, failures: form.failures, log: log.text, dir };
  } finally {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
    await new Promise(done => setTimeout(done, 2000));
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { port, fields, failures } = await checkStudioStart();
  if (failures.length) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
  } else {
    console.log(`The run form on the server at port ${port} asks only for ${fields.join(' and ')}, and both are required.`);
  }
}
