import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Starts the Auth and Firestore emulators from firebase.json under the
// demo-julia project, which needs no Google account or credentials.
export const EMULATOR_PROJECT_ID = 'demo-julia';
export const EMULATOR_HOSTS = { auth: '127.0.0.1:9099', firestore: '127.0.0.1:8080' };
const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function reachable(host) {
  try {
    await fetch(`http://${host}/`);
    return true;
  } catch {
    return false;
  }
}

/**
 * An aborted `signal` stops the emulators even while they are still starting.
 * @returns {Promise<{ stop: () => Promise<void> }>}
 */
export async function startEmulators({ timeoutMs = 120_000, signal } = {}) {
  const child = spawn('npx', ['--no-install', 'firebase', 'emulators:start', '--only', 'auth,firestore', '--project', EMULATOR_PROJECT_ID], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const exited = new Promise(resolve => child.once('exit', resolve));
  async function stop() {
    if (child.exitCode !== null) return;
    process.kill(-child.pid, 'SIGTERM');
    // The CLI runs Java in its own process group, so only the CLI's own shutdown
    // stops it; that can take ~30 s if it is still starting. SIGKILL is the last resort.
    const timer = setTimeout(() => process.kill(-child.pid, 'SIGKILL'), 45_000);
    await exited;
    clearTimeout(timer);
  }
  signal?.addEventListener('abort', stop, { once: true });
  const deadline = Date.now() + timeoutMs;
  while (!output.includes('All emulators ready')) {
    if (child.exitCode !== null) throw new Error(`Firebase emulators exited early:\n${output}`);
    if (Date.now() > deadline) {
      process.kill(-child.pid, 'SIGKILL');
      throw new Error(`Firebase emulators did not start in ${timeoutMs} ms:\n${output}`);
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!(await reachable(EMULATOR_HOSTS.firestore)) || !(await reachable(EMULATOR_HOSTS.auth))) {
    process.kill(-child.pid, 'SIGKILL');
    throw new Error(`Firebase emulators reported ready but are not reachable:\n${output}`);
  }
  return { stop };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const shutdown = new AbortController();
  for (const name of ['SIGINT', 'SIGTERM']) {
    process.once(name, () => {
      shutdown.abort();
      setTimeout(() => process.exit(0), 46_000).unref();
    });
  }
  await startEmulators({ signal: shutdown.signal });
  console.log(`Firebase emulators ready: ${JSON.stringify(EMULATOR_HOSTS)}`);
}
