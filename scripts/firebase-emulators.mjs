import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Starts the Auth and Firestore emulators from firebase.json under the
// demo-julia project, which needs no Google account or credentials.
export const EMULATOR_PROJECT_ID = 'demo-julia';
export const EMULATOR_HOSTS = { auth: '127.0.0.1:9099', firestore: '127.0.0.1:8080' };
const ROOT = fileURLToPath(new URL('..', import.meta.url));
// firebase-tools 15 refuses to start the emulators on an older runtime, and some
// machines (CI images included) keep a newer JDK beside the one on PATH.
const MINIMUM_JAVA = 21;

function javaMajor(home) {
  const binary = home ? join(home, 'bin/java') : 'java';
  const result = spawnSync(binary, ['-version'], { encoding: 'utf8' });
  const version = /version "(\d+)/.exec(`${result.stdout}${result.stderr}`);
  return version ? Number(version[1]) : 0;
}

function supportedJavaHome() {
  const jvm = '/usr/lib/jvm';
  const candidates = [
    process.env.JAVA_HOME,
    ...Object.entries(process.env).filter(([name]) => name.startsWith('JAVA_HOME_') && name !== 'JAVA_HOME').map(([, value]) => value),
    ...(existsSync(jvm) ? readdirSync(jvm).map(name => join(jvm, name)) : []),
  ].filter(Boolean);
  const found = candidates.find(home => existsSync(join(home, 'bin/java')) && javaMajor(home) >= MINIMUM_JAVA);
  if (found) return found;
  return javaMajor(null) >= MINIMUM_JAVA ? 'mine' : null;
}

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
  const javaHome = supportedJavaHome();
  const child = spawn('npx', ['--no-install', 'firebase', 'emulators:start', '--only', 'auth,firestore', '--project', EMULATOR_PROJECT_ID], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: javaHome && javaHome !== 'mine'
      ? { ...process.env, JAVA_HOME: javaHome, PATH: `${join(javaHome, 'bin')}${delimiter}${process.env.PATH}` }
      : process.env,
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

export { supportedJavaHome };

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
