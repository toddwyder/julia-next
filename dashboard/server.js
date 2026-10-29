#!/usr/bin/env node
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import next from 'next';

const dir = fileURLToPath(new URL('.', import.meta.url));
const host = process.env.DASHBOARD_HOST || '127.0.0.1';
const port = Number(process.env.DASHBOARD_PORT || 4313);
const where = `http://${host}:${port}`;

const log = message => console.log(`julia-dashboard: ${message}`);
const fail = message => {
  process.stderr.write(`julia-dashboard: ${message}\n`);
  process.exit(1);
};

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  fail(`DASHBOARD_PORT ${JSON.stringify(process.env.DASHBOARD_PORT ?? '')} is not a port number`);
}

log(`starting from ${dir}`);
const app = next({ dev: false, dir, hostname: host, port });
try {
  await app.prepare();
} catch (error) {
  fail(`next build output in ${dir} could not be prepared, so nothing was served: ${error.message}`);
}

const handle = app.getRequestHandler();
const server = createServer((request, response) => {
  handle(request, response).catch(error => {
    console.error(`julia-dashboard: request ${request.method} ${request.url} failed: ${error.message}`);
    if (!response.headersSent) response.statusCode = 500;
    response.end('Internal server error');
  });
});

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
} catch (error) {
  fail(`could not listen on ${where}: ${error.message}`);
}

log(`listening on ${where}`);

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    log(`stopping on ${signal}`);
    server.closeAllConnections();
    server.close(() => process.exit(0));
  });
}
