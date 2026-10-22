import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const skillDirectory = join(import.meta.dirname, '..', '.agents', 'skills', 'verify-machine');
const featuresDirectory = join(skillDirectory, 'features');

test('verify-machine skill and feature map keep the generated public contract', async () => {
  const generatorPath = join(skillDirectory, '..', 'create-verification-skill', 'SKILL.md');
  const generator = await readFile(generatorPath, 'utf8');
  const generation = JSON.parse(await readFile(join(skillDirectory, 'generation.json'), 'utf8'));
  assert.equal(generation.generator, '.agents/skills/create-verification-skill/SKILL.md');
  assert.equal(generation.generatorSha256, createHash('sha256').update(generator).digest('hex'));
  assert.match(generation.interviewRecord, /^\.artifacts\/verify-machine\/[^/]+\/interview\.md$/);
  assert.deepEqual(generation.generatedFiles, [
    'generation.json',
    'SKILL.md',
    'drive-initialization.mjs',
    'initialization-driver-support.mjs',
    'features/README.md',
    'features/check-permanent-prerequisites.md',
    'features/initialize-ready-card.md',
    'features/run-named-secret-command.md',
    'features/verify-restricted-secrets.md',
  ]);

  const skill = await readFile(join(skillDirectory, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\r?\nname: verify-machine\r?\n/m);
  for (const heading of ['Launch', 'Doctor', 'Drive', 'Evidence', 'Cleanup', 'Helpers']) {
    assert.match(skill, new RegExp(`^## ${heading}$`, 'm'));
  }
  assert.doesNotMatch(skill, /<(?:harness|run-id|evidence-path|json-path|id)>/i);

  const index = await readFile(join(featuresDirectory, 'README.md'), 'utf8');
  for (const source of ['docs', 'commands', 'tests', 'laptop installed state']) {
    assert.match(index, new RegExp(source, 'i'));
  }
  for (const command of ['doctor', 'rehearsal', 'connections', 'models', 'init', '-Verify', '-JuliaArguments', '-RunArguments', '-Provision', 'readIssue']) {
    assert.match(index, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  for (const operation of ['init', 'readIssue', 'verify', 'run', 'migrate']) {
    assert.match(index, new RegExp(`julia-vault\\.mjs[^\\n]*${operation}`, 'i'));
  }

  const featureFiles = (await readdir(featuresDirectory))
    .filter(file => file.endsWith('.md') && file !== 'README.md')
    .sort();
  assert.ok(featureFiles.length > 0);
  assert.deepEqual(featureFiles, [
    'check-permanent-prerequisites.md',
    'initialize-ready-card.md',
    'run-named-secret-command.md',
    'server-agents-command.md',
    'verify-restricted-secrets.md',
  ]);

  const indexedLinks = [...index.matchAll(/\]\(\.\/([^)]+\.md)\)/g)].map(match => match[1]).sort();
  assert.deepEqual(indexedLinks, featureFiles);
  assert.equal(new Set(indexedLinks).size, indexedLinks.length);

  for (const file of featureFiles) {
    const feature = await readFile(join(featuresDirectory, file), 'utf8');
    const headings = [...feature.matchAll(/^## (.+)$/gm)].map(match => match[1]);
    assert.equal(headings.length, 4, `${file} must have exactly four H2 sections`);
    assert.deepEqual(headings.slice(0, 2), ['Sub-features', 'How to get to it (user POV)']);
    assert.match(headings[2], /^Driving it with (?!<harness>|TODO|TBD).+/);
    assert.equal(headings[3], 'Gotchas');
    assert.match(feature, /```(?:powershell|sh)\r?\n[\s\S]+?\r?\n```/, `${file} must include a literal PowerShell drive`);
    assert.match(feature, /observable (?:success|result)|success (?:is|looks like)|succeeds when/i, `${file} must state observable success`);
  }

  assert.match(index, /connections[\s\S]+Unavailable today/i);
  assert.match(index, /models[\s\S]+Unavailable today/i);
  assert.match(index, /init Start[\s\S]+initialize-ready-card\.md/i);

  const initializationDriver = await readFile(join(skillDirectory, 'drive-initialization.mjs'), 'utf8');
  const initializationSupport = await readFile(join(skillDirectory, 'initialization-driver-support.mjs'), 'utf8');
  assert.doesNotMatch(initializationDriver, /boundary[12]\.stop\(\)\.catch/);
  assert.match(initializationSupport, /Wait-Process/);
});
