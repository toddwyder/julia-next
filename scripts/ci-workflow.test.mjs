import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..');
const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');

const jobs = Object.fromEntries(
  ci.split(/\r?\n  (?=[a-z-]+:\r?\n)/).slice(1).map(block => [block.slice(0, block.indexOf(':')), block]),
);

function stepNames(job) {
  return jobs[job].split(/\n      - /).slice(1).map(step => step.match(/name: (.+)/)?.[1] ?? '');
}

test('browser-tests container pins the Playwright version locked by every browser owner', () => {
  const image = ci.match(/image:\s*mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-/);
  assert.ok(image, 'expected mcr.microsoft.com/playwright:v<version>-<distro> in ci.yml');
  for (const lockPath of ['package-lock.json', 'dashboard/package-lock.json']) {
    const lock = JSON.parse(readFileSync(join(root, lockPath), 'utf8'));
    assert.equal(image[1], lock.packages['node_modules/@playwright/test']?.version, `${lockPath} Playwright version mismatch`);
  }
});

test('each test or build job runs at most one dependency install step', () => {
  for (const jobName of ['package-tests', 'browser-tests', 'web']) {
    assert.ok(jobs[jobName], `missing ${jobName} job`);
    const installs = jobs[jobName].match(/(?:npm ci|test-owners\.mjs --install\b)/g) ?? [];
    assert.equal(installs.length, 1, `${jobName} should install once, found: ${installs.join(', ')}`);
  }
});

test('every job that builds or runs tests blocks the font hosts first', () => {
  for (const [jobName, lastStep] of [['package-tests', "Run local owners' tests"], ['web', 'Build application']]) {
    const names = stepNames(jobName);
    const block = names.indexOf('Block the font hosts');
    assert.ok(block > -1, `${jobName} never blocks the font hosts`);
    assert.ok(names.includes(lastStep), `${jobName} lost its ${lastStep} step`);
    assert.ok(block < names.indexOf(lastStep), `${jobName} must block the font hosts before ${lastStep}`);
  }
});

test('repository hygiene fails a font loaded from an outside address', () => {
  assert.match(jobs['repository-hygiene'], /node scripts\/check-font-sources\.mjs --all/);
});
