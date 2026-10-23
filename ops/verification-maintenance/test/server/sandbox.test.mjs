import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command, skills, sandbox } from '../../maintenance.mjs';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'maintenance-mount-'));
  const repo = join(root, 'repository');
  mkdirSync(repo);
  writeFileSync(join(repo, 'app.mjs'), 'console.log("ready");\n');
  return { root, repo };
}
test('discovery follows skill-local feature maps and real sandbox rejects product edits', () => {
  const { repo, root } = fixture();
  const target = '.agents/skills/verify-fixture';
  mkdirSync(join(repo, target, 'features'), { recursive: true });
  writeFileSync(join(repo, target, 'SKILL.md'), 'fixture');
  writeFileSync(join(repo, target, 'features/README.md'), 'fixture');
  mkdirSync(join(repo, '.agents/skills/other'), { recursive: true });
  writeFileSync(join(repo, '.agents/skills/other/SKILL.md'), 'sibling');
  assert.deepEqual(skills(repo), [target]);
  const scratch = join(root, 'scratch'); mkdirSync(scratch);
  const output = command('bwrap', [...sandbox(repo, [target], scratch), '--', 'node', '--input-type=module', '-e', `import {writeFileSync} from 'node:fs'; try { writeFileSync('app.mjs','bad'); throw Error('product writable'); } catch(e) { if(e.code !== 'EROFS') throw e; } try { writeFileSync('.agents/skills/other/SKILL.md','bad'); throw Error('sibling writable'); } catch(e) { if(e.code !== 'EROFS') throw e; } writeFileSync('${target}/allowed.txt','allowed'); console.log('product read-only; skill writable');`], repo);
  assert.equal(output, 'product read-only; skill writable');
  assert.equal(readFileSync(join(repo, 'app.mjs'), 'utf8'), 'console.log("ready");\n');
  assert.equal(readFileSync(join(repo, target, 'allowed.txt'), 'utf8'), 'allowed');
});
