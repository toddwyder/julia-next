import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

function skillHash(directory, base = directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) skillHash(path, base, files);
    else files.push({ path, relative: relative(base, path).replaceAll('\\', '/') });
  }
  if (directory !== base) return undefined;
  const hash = createHash('sha256');
  for (const file of files.sort((left, right) => left.relative.localeCompare(right.relative))) {
    hash.update(file.relative);
    hash.update(readFileSync(file.path));
  }
  return hash.digest('hex');
}

test('the Factory installer pins the 0.19.1 release family without the retired WorkOS patch', () => {
  const packageJson = JSON.parse(read('ops/factory/app/package.json'));

  assert.deepEqual(
    Object.fromEntries(
      [
        '@mastra/factory',
        '@mastra/code-sdk',
        '@mastra/auth-workos',
        '@mastra/core',
        '@mastra/pg',
        '@mastra/libsql',
        '@mastra/memory',
        '@mastra/duckdb',
        '@mastra/observability',
      ].map(name => [name, packageJson.dependencies[name]]),
    ),
    {
      '@mastra/factory': '0.19.1',
      '@mastra/code-sdk': '1.10.1',
      '@mastra/auth-workos': '1.6.6',
      '@mastra/core': '1.74.0',
      '@mastra/pg': '1.29.0',
      '@mastra/libsql': '1.25.0',
      '@mastra/memory': '1.35.0',
      '@mastra/duckdb': '1.12.1',
      '@mastra/observability': '1.18.3',
    },
  );

  assert.doesNotMatch(read('ops/factory/install.sh'), /apply-install-patches|workos-cookie-identity\.check/);
});

test('the Factory-visible Pocock skills are pinned to 1.3.1 and use the repository glossary', () => {
  const lock = JSON.parse(read('skills-lock.json'));
  const packageLock = JSON.parse(read('ops/factory/app/package-lock.json'));
  const codeSdkWorkspaceSourceMap = new URL('ops/factory/app/node_modules/@mastra/code-sdk/dist/agents/workspace.js.map', root);

  assert.ok(existsSync(new URL('GLOSSARY.md', root)));
  assert.ok(!existsSync(new URL('CONTEXT.md', root)));
  assert.equal(packageLock.packages['node_modules/@mastra/code-sdk']?.version, '1.10.1');
  assert.ok(existsSync(codeSdkWorkspaceSourceMap), 'the pinned Code SDK must retain its workspace source map');
  const codeSdkWorkspaceSource = JSON.parse(readFileSync(codeSdkWorkspaceSourceMap, 'utf8')).sourcesContent.join('\n');
  assert.match(codeSdkWorkspaceSource, /\.claude\/skills/, 'the pinned Code SDK must discover the Factory-visible skill root');
  assert.ok(!('implement-spec' in lock.skills));
  assert.ok(!('resolving-merge-conflicts' in lock.skills));

  for (const [name, entry] of Object.entries(lock.skills)) {
    assert.equal(entry.ref, 'v1.3.1', `${name} must be pinned to the requested release`);
    for (const skillRoot of ['.claude/skills']) {
      const skill = new URL(`${skillRoot}/${name}/SKILL.md`, root);
      assert.ok(existsSync(skill), `${name} must be available in ${skillRoot}`);
      assert.equal(
    skillHash(fileURLToPath(new URL(`${skillRoot}/${name}/`, root))),
        entry.computedHash,
        `${name} must match its pinned upstream content`,
      );
    }
  }

  for (const name of ['tdd', 'code-review', 'diagnosing-bugs', 'implement', 'retro']) {
    assert.match(read(`.claude/skills/${name}/SKILL.md`), new RegExp(`^name: ${name}$`, 'm'));
  }

  for (const path of [
    '.claude/skills/tdd/SKILL.md',
    '.claude/skills/diagnosing-bugs/SKILL.md',
    '.claude/skills/domain-modeling/SKILL.md',
    '.claude/skills/ask-matt/SKILL.md',
  ]) {
    assert.doesNotMatch(read(path), /CONTEXT\.md/);
  }
});
