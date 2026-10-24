import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const cli = join(import.meta.dirname, 'check-agent-links.mjs');

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agent-links-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  for (const file of ['AGENTS.md', 'CLAUDE.md', 'CODING_STANDARDS.md']) writeFileSync(join(root, file), '# Work\n');
  const write = (file, content) => {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), content);
  };
  const run = () => spawnSync(process.execPath, [cli, root], { encoding: 'utf8' });
  return { root, write, run };
}

test('agent entry points resolve their actual destinations', () => {
  const result = spawnSync(process.execPath, ['scripts/check-agent-links.mjs'], { cwd: join(import.meta.dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('missing learning directories and removed headings fail with the source line and repair', t => {
  const f = fixture(t);
  f.write('AGENTS.md', '# Work\nLearning tests under framework/.\n');
  f.write('CLAUDE.md', '[Build](AGENTS.md#building-and-reviewing)\n');
  let result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /AGENTS\.md:2: framework\/ does not exist; fix the reference/);
  assert.match(result.stderr, /CLAUDE\.md:1: AGENTS\.md#building-and-reviewing has no matching heading/);
  mkdirSync(join(f.root, 'framework'));
  f.write('CLAUDE.md', '[Build](AGENTS.md#work)\n');
  result = f.run();
  assert.equal(result.status, 0, result.stderr);
});

test('relative links, duplicate headings and source paths are checked without treating external URLs or templates as local files', t => {
  const f = fixture(t);
  mkdirSync(join(f.root, 'docs'));
  f.write('docs/guide.md', '# A guide\n# A guide\n');
  f.write('AGENTS.md', '[Guide](docs/guide.md#a-guide-1)\nhttps://example.com/missing/\n`node_modules/next/dist/docs/`\n`docs/agents/<card>/`\n');
  assert.equal(f.run().status, 0);
  f.write('CODING_STANDARDS.md', 'Run `scripts/missing.mjs`.\n');
  assert.equal(f.run().status, 1);
  f.write('CODING_STANDARDS.md', '[Missing](docs/missing.md)\n');
  assert.equal(f.run().status, 1);
  rmSync(join(f.root, 'CLAUDE.md'));
  assert.match(f.run().stderr, /CLAUDE\.md:1: missing entry point/);
});

test('root file references and source files beyond JavaScript must exist', t => {
  const f = fixture(t);
  f.write('AGENTS.md', 'Domain words: [GLOSSARY.md](GLOSSARY.md).\nRun scripts/windows.ps1.\n');
  let result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /AGENTS\.md:1: GLOSSARY\.md does not exist/);
  assert.match(result.stderr, /AGENTS\.md:2: scripts\/windows\.ps1 does not exist/);
  mkdirSync(join(f.root, 'scripts'));
  f.write('GLOSSARY.md', '# Domain\n');
  f.write('scripts/windows.ps1', '');
  result = f.run();
  assert.equal(result.status, 0, result.stderr);
});

test('skill instructions cannot point agents at missing files', t => {
  const f = fixture(t);
  f.write('.agents/skills/recovery/SKILL.md', 'Read `.agents/skills/diagnosing-bugs/SKILL.md`.\n');
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\.agents\/skills\/recovery\/SKILL\.md:1: \.agents\/skills\/diagnosing-bugs\/SKILL\.md does not exist/);
});
