import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const skillDirectory = join(import.meta.dirname, '..', '.agents', 'skills', 'verify-machine');
const featuresDirectory = join(skillDirectory, 'features');

test('verify-machine skill and feature map keep the generated public contract', async () => {
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

  const featureFiles = (await readdir(featuresDirectory))
    .filter(file => file.endsWith('.md') && file !== 'README.md')
    .sort();
  assert.ok(featureFiles.length > 0);

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
    assert.match(feature, /```powershell\r?\n[\s\S]+?\r?\n```/, `${file} must include a literal PowerShell drive`);
    assert.match(feature, /observable (?:success|result)|success (?:is|looks like)|succeeds when/i, `${file} must state observable success`);
  }

  const connections = await readFile(join(featuresDirectory, 'manage-model-connections.md'), 'utf8');
  assert.match(connections, /function Invoke-ConnectionCommand[\s\S]+if \(\$exitCode -ne 0\)/);
  assert.match(connections, /try \{[\s\S]+\} finally \{[\s\S]+JULIA_CONFIG_DIRECTORY[\s\S]+Remove-Item -LiteralPath/);
  assert.match(connections, /lastTest\.ok[\s\S]+lastTest\.modelCount[\s\S]+lastTest\.testedAt/);

  const models = await readFile(join(featuresDirectory, 'choose-role-models.md'), 'utf8');
  assert.match(models, /'models', 'save'[\s\S]+'models', 'list'/);
  assert.match(models, /saved defaults differ from requested defaults/);
  assert.match(models, /try \{[\s\S]+\} finally \{[\s\S]+JULIA_CONFIG_DIRECTORY[\s\S]+Remove-Item -LiteralPath/);
});
