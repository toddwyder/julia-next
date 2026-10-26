import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIRROR = 'https://github.com/backnotprop/pstack';
export const JULIA_SKILLS = new Set(['adversarial-review', 'playwright-cli', 'verify-julia']);
const ALLOWED_TOP_LEVEL_FILES = new Set(['PSTACK-SOURCE.md', 'PSTACK-LICENSE.txt']);

export function readPin(root = process.cwd()) {
  const text = readFileSync(join(root, '.agents/skills/PSTACK-SOURCE.md'), 'utf8');
  const mirror = text.match(/^Mirror: (\S+)$/m)?.[1];
  const commit = text.match(/^Commit: ([0-9a-f]{40})$/m)?.[1];
  if (mirror !== MIRROR) throw new Error(`PSTACK-SOURCE.md must name ${MIRROR}, found ${mirror ?? 'nothing'}`);
  if (!commit) throw new Error('PSTACK-SOURCE.md must record a 40-character commit');
  return { mirror, commit };
}

function filesUnder(directory, prefix = '') {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...filesUnder(join(directory, entry.name), path));
    else files.push(path);
  }
  return files.sort();
}

function sameFile(left, right) {
  return readFileSync(left).equals(readFileSync(right));
}

export function compareSkillTrees(mirrorSkills, installedSkills) {
  const problems = [];
  const roots = Array.isArray(mirrorSkills) ? mirrorSkills : [mirrorSkills];
  if (!existsSync(installedSkills)) return [`installed skills directory is missing: ${installedSkills}`];
  const sources = new Map();
  for (const root of roots) {
    if (!existsSync(root)) {
      problems.push(`mirror skills directory is missing: ${root}`);
      continue;
    }
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) sources.set(entry.name, join(root, entry.name));
    }
  }
  const expected = [...sources.keys()].sort();
  const installed = readdirSync(installedSkills, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  for (const skill of expected) {
    if (!installed.includes(skill)) {
      problems.push(`missing installed pstack skill: ${skill}`);
      continue;
    }
    const mirrorFiles = filesUnder(sources.get(skill));
    const installedFiles = filesUnder(join(installedSkills, skill));
    for (const file of mirrorFiles) {
      const target = join(installedSkills, skill, file);
      if (!installedFiles.includes(file)) problems.push(`missing pstack file: ${skill}/${file}`);
      else if (lstatSync(target).isSymbolicLink()) problems.push(`pstack file is a symlink, not a copy: ${skill}/${file}`);
      else if (!sameFile(join(sources.get(skill), file), target)) problems.push(`pstack file differs from the mirror: ${skill}/${file}`);
    }
    for (const file of installedFiles) if (!mirrorFiles.includes(file)) problems.push(`unexpected pstack file: ${skill}/${file}`);
  }
  for (const skill of installed) {
    if (!expected.includes(skill) && !JULIA_SKILLS.has(skill)) problems.push(`installed skill is not in the pstack mirror or Julia's own set: ${skill}`);
  }
  for (const entry of readdirSync(installedSkills, { withFileTypes: true })) {
    if (!entry.isDirectory() && !ALLOWED_TOP_LEVEL_FILES.has(entry.name)) problems.push(`unexpected file in .agents/skills: ${entry.name}`);
  }
  return problems;
}

export function compareTree(mirrorPath, installedPath, label) {
  if (!existsSync(mirrorPath)) return [`mirror path is missing: ${mirrorPath}`];
  if (!existsSync(installedPath)) return [`installed path is missing: ${installedPath}`];
  if (lstatSync(mirrorPath).isFile()) {
    if (lstatSync(installedPath).isSymbolicLink()) return [`${label} is a symlink, not a copy`];
    return sameFile(mirrorPath, installedPath) ? [] : [`${label} differs from the mirror`];
  }
  const problems = [];
  const mirrorFiles = filesUnder(mirrorPath);
  const installedFiles = filesUnder(installedPath);
  for (const file of mirrorFiles) {
    const target = join(installedPath, file);
    if (!installedFiles.includes(file)) problems.push(`missing pstack file: ${label}/${file}`);
    else if (lstatSync(target).isSymbolicLink()) problems.push(`pstack file is a symlink, not a copy: ${label}/${file}`);
    else if (!sameFile(join(mirrorPath, file), target)) problems.push(`pstack file differs from the mirror: ${label}/${file}`);
  }
  for (const file of installedFiles) if (!mirrorFiles.includes(file)) problems.push(`unexpected pstack file: ${label}/${file}`);
  return problems;
}

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

export function sdkPinProblems({ manifest, lock, installedVersion, patchesExist, packageIsSymlink, patchesMentionSdk }) {
  const problems = [];
  const declared = manifest.dependencies?.['@mastra/code-sdk'];
  if (!declared) problems.push('ops/build-runner/package.json does not declare @mastra/code-sdk');
  else if (!EXACT_VERSION.test(declared)) problems.push(`@mastra/code-sdk must be an exact version, found "${declared}"`);
  if (!installedVersion) problems.push('@mastra/code-sdk is not installed');
  else if (!EXACT_VERSION.test(installedVersion)) problems.push(`installed @mastra/code-sdk version is not exact: "${installedVersion}"`);
  const locked = lock.packages?.['node_modules/@mastra/code-sdk'];
  const rootLocked = lock.packages?.['']?.dependencies?.['@mastra/code-sdk'];
  if (!locked) problems.push('package-lock.json has no node_modules/@mastra/code-sdk entry');
  else {
    if (!EXACT_VERSION.test(locked.version ?? '')) problems.push(`lockfile @mastra/code-sdk version is not exact: "${locked.version}"`);
    if (installedVersion && locked.version !== installedVersion) problems.push(`lockfile has ${locked.version}, install has ${installedVersion}`);
    if (!String(locked.resolved ?? '').startsWith('https://registry.npmjs.org/@mastra/code-sdk/-/')) problems.push('@mastra/code-sdk does not resolve from the public npm registry');
    if (!locked.integrity) problems.push('@mastra/code-sdk lock entry has no integrity hash');
  }
  if (rootLocked && rootLocked !== declared) problems.push(`lockfile root declares "${rootLocked}", package.json declares "${declared}"`);
  if (patchesExist) problems.push('ops/build-runner/patches exists; @mastra/code-sdk must not carry local patches');
  if (patchesMentionSdk) problems.push('a patch-package script patches @mastra/code-sdk');
  if (packageIsSymlink) problems.push('node_modules/@mastra/code-sdk is a symlink; install it from the registry');
  for (const field of ['overrides', 'resolutions']) {
    const value = manifest[field]?.['@mastra/code-sdk'] ?? manifest[field]?.['@mastra'];
    if (value) problems.push(`package.json ${field} rewrites @mastra/code-sdk`);
  }
  return problems;
}

export function checkPstackPin(root = process.cwd(), { fetchMirror = cloneMirror } = {}) {
  const pin = readPin(root);
  const runner = join(root, 'ops/build-runner');
  const manifest = JSON.parse(readFileSync(join(runner, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(runner, 'package-lock.json'), 'utf8'));
  const installedManifest = join(runner, 'node_modules/@mastra/code-sdk/package.json');
  const installedVersion = existsSync(installedManifest)
    ? JSON.parse(readFileSync(installedManifest, 'utf8')).version
    : undefined;
  const problems = [];
  const patchScripts = ['postinstall', 'prepare', 'preinstall', 'install']
    .map(name => manifest.scripts?.[name] ?? '').join(' ');
  problems.push(...sdkPinProblems({
    manifest,
    lock,
    installedVersion,
    patchesExist: existsSync(join(runner, 'patches')),
    packageIsSymlink: existsSync(join(runner, 'node_modules/@mastra/code-sdk'))
      && lstatSync(join(runner, 'node_modules/@mastra/code-sdk')).isSymbolicLink(),
    patchesMentionSdk: /patch-package/.test(patchScripts) && readFileSync(join(runner, 'package.json'), 'utf8').includes('@mastra/code-sdk'),
  }));

  const checkout = mkdtempSync(join(tmpdir(), 'pstack-pin-'));
  try {
    fetchMirror(pin, checkout);
    problems.push(...compareSkillTrees(
      [join(checkout, 'skills'), join(checkout, 'automations/benny/skills')],
      join(root, '.agents/skills'),
    ));
    problems.push(...compareTree(join(checkout, 'docs'), join(root, '.agents/docs'), 'docs'));
    problems.push(...compareTree(join(checkout, 'README.md'), join(root, '.agents/README.md'), 'README.md'));
    problems.push(...compareTree(join(checkout, 'LICENSE'), join(root, '.agents/skills/PSTACK-LICENSE.txt'), 'PSTACK-LICENSE.txt'));
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
  return { pin, problems };
}

export function cloneMirror(pin, destination) {
  execFileSync('git', ['init', '-q', destination]);
  execFileSync('git', ['-C', destination, 'remote', 'add', 'origin', pin.mirror]);
  execFileSync('git', ['-C', destination, 'fetch', '--depth', '1', 'origin', pin.commit], { stdio: ['ignore', 'ignore', 'inherit'] });
  execFileSync('git', ['-C', destination, 'checkout', '-q', '--detach', 'FETCH_HEAD']);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { pin, problems } = checkPstackPin(resolve(process.argv[2] ?? '.'));
    if (problems.length) {
      console.error(`pstack/sdk pin check failed at ${pin.mirror}@${pin.commit}:\n${problems.join('\n')}`);
      process.exitCode = 1;
    } else console.log(`Installed pstack matches ${pin.mirror}@${pin.commit}, and @mastra/code-sdk is an exact registry install.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
