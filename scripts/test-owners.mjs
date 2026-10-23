import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function testOwners(root = process.cwd()) {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(path => path && existsSync(join(root, path)));
  const paths = new Set(files);
  const owners = files.filter(path => path === 'package.json' || path.endsWith('/package.json')).map(manifest => {
    const directory = dirname(manifest);
    const npmLock = join(directory, 'package-lock.json');
    const bunLock = join(directory, 'bun.lock');
    const lockfile = paths.has(npmLock) ? npmLock : paths.has(bunLock) ? bunLock : null;
    if (!lockfile) throw new Error(`Dependency owner ${directory} has no committed lockfile`);
    return { directory, lockfile, runtime: lockfile.endsWith('bun.lock') ? 'bun' : 'node', tests: { local: [], server: [], browser: [] } };
  }).sort((a, b) => a.directory.localeCompare(b.directory));
  for (const path of files.filter(path => /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/.test(path))) {
    let directory = dirname(path);
    let owner;
    while (!owner) {
      owner = owners.find(candidate => candidate.directory === directory);
      if (directory === '.') break;
      directory = dirname(directory);
    }
    if (!owner) throw new Error(`Test ${path} has no locked dependency owner`);
    const environment = path.split('/').includes('server') ? 'server' : /\.spec\./.test(path) && owner.runtime === 'node' ? 'browser' : 'local';
    owner.tests[environment].push(path);
  }
  for (const owner of owners) for (const files of Object.values(owner.tests)) files.sort();
  return { owners };
}

function execute(command, args, cwd) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT' && !key.startsWith('GIT_')));
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status ?? result.signal}`);
}

export function runOwnedTests(environment, { root = process.cwd(), plan = testOwners(root) } = {}) {
  if (!['local', 'server', 'browser'].includes(environment)) throw new Error('Test environment must be local, server, or browser');
  for (const owner of plan.owners) {
    const files = owner.tests[environment];
    if (!files.length) continue;
    console.log(JSON.stringify({ owner: owner.directory, lockfile: owner.lockfile, runtime: owner.runtime, environment, tests: files }));
    if (environment === 'browser') {
      const cwd = resolve(root, owner.directory);
      execute('npx', ['--no-install', 'playwright', 'test', ...files.map(path => relative(cwd, resolve(root, path)))], cwd);
    }
    else if (owner.runtime === 'bun') execute('bun', ['test', ...files.map(path => `./${path}`)], root);
    else execute(process.execPath, ['--test', '--test-concurrency=1', ...files], root);
  }
}

export function main(args = process.argv.slice(2)) {
  const plan = testOwners();
  if (args[0] === '--plan') console.log(JSON.stringify(plan, null, 2));
  else if (args[0] === '--install-browsers') {
    const environment = args[1];
    if (environment && !['local', 'server', 'browser'].includes(environment)) throw new Error('Browser install environment must be local, server, or browser');
    for (const owner of plan.owners) {
      if (environment && !owner.tests[environment].length) continue;
      const manifest = JSON.parse(readFileSync(join(owner.directory, 'package.json'), 'utf8'));
      const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
      if (!owner.tests.browser.length && !dependencies.playwright && !dependencies['@playwright/test']) continue;
      execute('npx', ['--no-install', 'playwright', 'install', '--with-deps', 'chromium'], resolve(owner.directory));
    }
  } else if (args[0] === '--install') {
    const environment = args[1];
    if (environment && !['local', 'server', 'browser'].includes(environment)) throw new Error('Install environment must be local, server, or browser');
    for (const owner of plan.owners.filter(owner => !environment || owner.tests[environment].length)) {
      console.log(`Installing locked dependencies for ${owner.directory}`);
      execute(owner.runtime === 'bun' ? 'bun' : 'npm', owner.runtime === 'bun' ? ['install', '--frozen-lockfile'] : ['ci'], resolve(owner.directory));
    }
  } else if (args[0] === '--run') runOwnedTests(args[1], { plan });
  else throw new Error('usage: node scripts/test-owners.mjs --plan | --install [local|server|browser] | --install-browsers [local|server|browser] | --run local|server|browser');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
