import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

function annotationData(value) {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function annotationProperty(value) {
  return annotationData(value).replaceAll(':', '%3A').replaceAll(',', '%2C');
}

export function annotateFailure({ file, name, message }, root = process.cwd()) {
  const path = relative(root, resolve(file)).replaceAll('\\', '/');
  console.log(`::error file=${annotationProperty(path)},title=${annotationProperty(name)}::${annotationData(`${name}: ${message.split(/\r?\n/)[0]}`)}`);
}

function xmlText(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity[1] === 'x' ? `0x${entity.slice(2)}` : entity.slice(1)));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity];
  });
}

function reportFailures(report, root, cwd) {
  for (const [, attributes, body] of report.matchAll(/<testcase\b((?:"[^"]*"|'[^']*'|[^'">])*)(?<!\/)>([\s\S]*?)<\/testcase>/g)) {
    const failure = body.match(/<(?:failure|error)\b((?:"[^"]*"|'[^']*'|[^'">])*)(?:\/>|>)/);
    if (!failure) continue;
    const parse = value => Object.fromEntries([...value.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, text]) => [name, xmlText(text)]));
    const test = parse(attributes);
    const error = parse(failure[1]);
    annotateFailure({ file: resolve(cwd, test.file), name: test.name, message: error.message ?? error.type ?? 'test failed' }, root);
  }
}

function execute(command, args, cwd, { report, root = cwd, environment = {} } = {}) {
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT' && !key.startsWith('GIT_'))), ...environment };
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (report && existsSync(report)) reportFailures(readFileSync(report, 'utf8'), root, cwd);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status ?? result.signal}`);
}

export function runOwnedTests(environment, { root = process.cwd(), plan = testOwners(root) } = {}) {
  if (!['local', 'server', 'browser'].includes(environment)) throw new Error('Test environment must be local, server, or browser');
  for (const owner of plan.owners) {
    const files = owner.tests[environment];
    if (!files.length) continue;
    console.log(JSON.stringify({ owner: owner.directory, lockfile: owner.lockfile, runtime: owner.runtime, environment, tests: files }));
    const directory = mkdtempSync(join(tmpdir(), 'test-owners-report-'));
    const report = join(directory, 'results.xml');
    try {
      if (environment === 'browser') {
        const cwd = resolve(root, owner.directory);
        const reporter = fileURLToPath(new URL('./test-owners-playwright.mjs', import.meta.url));
        execute('npx', ['--no-install', 'playwright', 'test', `--reporter=line,${reporter}`, ...files.map(path => relative(cwd, resolve(root, path)))], cwd, { environment: { TEST_OWNERS_ROOT: root } });
      }
      else if (owner.runtime === 'bun') execute('bun', ['test', '--reporter=junit', `--reporter-outfile=${report}`, ...files.map(path => `./${path}`)], root, { report, environment: { GITHUB_ACTIONS: '' } });
      else execute(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=junit', `--test-reporter-destination=${report}`, ...files], root, { report });
    } finally { rmSync(directory, { recursive: true, force: true }); }
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
