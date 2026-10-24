#!/usr/bin/env node
// Fails when a test stands in for an outside service. The rule is structural:
// a test that names an outside service and replaces it with a local server,
// a mock, a stub, a fake or an offline fixture is refused.
//
// The repository test suite runs this against the tests added or changed by the
// commit under test, so existing local unit fixtures stay where they are while
// new stand-ins stop.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_FILE = /(?:^|\/)(?:[^/]+\.(?:test|spec)\.[cm]?[jt]sx?|(?:test|tests|__tests__|fixtures|support)\/[^/]+\.[cm]?[jt]sx?)$/;
const SKIPPED = new Set([
  'scripts/check-no-fakes.mjs',
  'scripts/check-no-fakes.test.mjs',
  'scripts/no-fakes-repository.test.mjs',
]);

const SERVICE = /\b(?:linear|github|google|firebase|firestore|gmail|vercel|axiom|sentry|openai|anthropic|claude|chatgpt|deepseek|commandcode|tailscale|rclone|supabase|powersync|dropbox|stripe|slack|workos|oauth|provider|llm|reviewer)\b/i;
const STANDIN_WORD = /\b(?:mock|mocked|mocking|stub|stubbed|fake|faked|stand-in|offline|canned|synthetic)\b/i;
const MOCK_LIBRARY = /\b(?:nock|msw|sinon|proxyquire|fetch-mock|MockAgent|setupServer)\b|\b(?:vi|jest)\.mock\s*\(|\bmock\.module\s*\(/i;
const GLOBAL_FETCH = /\b(?:globalThis|global|window)\.fetch\s*=/;
const LOCAL_SERVER = /\b(?:createServer|createSecureServer)\s*\(|\.listen\s*\(|\b(?:127\.0\.0\.1|localhost|0\.0\.0\.0)\b/;

export function isTestFile(path) {
  const file = String(path).replaceAll('\\', '/');
  return TEST_FILE.test(file) && !SKIPPED.has(file);
}

function lineNumber(lines, index) {
  return index + 1;
}

function finding(file, line, message) {
  return `${file}:${line}: ${message}`;
}

function nearbyService(lines, index) {
  const from = Math.max(0, index - 4);
  const to = Math.min(lines.length - 1, index + 4);
  for (let cursor = from; cursor <= to; cursor += 1) {
    if (SERVICE.test(lines[cursor])) return cursor + 1;
  }
  return null;
}

export function findFakeOutsideServices({ file, text }) {
  if (!isTestFile(file)) return [];
  const lines = String(text ?? '').split(/\r?\n/);
  const found = new Set();
  const localServerFor = new Set();
  const globalFetchFor = new Set();
  const serviceLine = lines.findIndex(line => SERVICE.test(line));
  if (serviceLine === -1) return [];

  lines.forEach((line, index) => {
    if (SERVICE.test(line) && STANDIN_WORD.test(line)) {
      found.add(finding(file, lineNumber(lines, index), 'a test names an outside service and a stand-in together'));
    }
    if (LOCAL_SERVER.test(line)) {
      const service = nearbyService(lines, index);
      if (service && !localServerFor.has(service)) {
        localServerFor.add(service);
        found.add(finding(file, lineNumber(lines, index), `a local server stands in for the outside service named on line ${service}`));
      }
    }
    if (GLOBAL_FETCH.test(line)) {
      const service = nearbyService(lines, index);
      if (service && !globalFetchFor.has(service)) {
        globalFetchFor.add(service);
        found.add(finding(file, lineNumber(lines, index), `the global fetch is replaced for the outside service named on line ${service}`));
      }
    }
  });

  const mockLine = lines.findIndex(line => MOCK_LIBRARY.test(line));
  if (mockLine > -1) {
    found.add(finding(file, lineNumber(lines, mockLine), `a mocking library stands in for an outside service named on line ${lineNumber(lines, serviceLine)}`));
  }

  return [...found];
}

function trackedTestFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(path => path && isTestFile(path));
}

function changedTestFiles(root, base) {
  const diff = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', base, 'HEAD'], { cwd: root, encoding: 'utf8' });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  return [...new Set([...diff.split('\n'), ...untracked.split('\0')])].filter(path => path && isTestFile(path));
}

function baseFromGit(root) {
  try {
    execFileSync('git', ['rev-parse', '--verify', 'HEAD^'], { cwd: root, stdio: 'ignore' });
    return 'HEAD^';
  } catch {
    return null;
  }
}

export function checkNoFakes({ root = process.cwd(), base = null, all = false } = {}) {
  const compared = base || baseFromGit(root);
  if (!all && !compared) return [];
  const files = all ? trackedTestFiles(root) : changedTestFiles(root, compared);
  if (!files) return [];
  const findings = [];
  for (const file of files) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue;
    findings.push(...findFakeOutsideServices({ file, text: readFileSync(path, 'utf8') }));
  }
  return findings;
}

function main(args) {
  const root = resolve(args.includes('--root') ? args[args.indexOf('--root') + 1] : '.');
  const all = args.includes('--all');
  const baseIndex = args.indexOf('--base');
  const base = baseIndex > -1 ? args[baseIndex + 1] : process.env.NO_FAKES_BASE || null;
  if (!all && !base && !baseFromGit(root)) {
    console.log('No earlier commit to compare; no changed tests to check.');
    return;
  }
  const findings = checkNoFakes({ root, base, all });
  if (!findings.length) {
    console.log('No changed test stands in for an outside service.');
    return;
  }
  console.error(findings.join('\n'));
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
