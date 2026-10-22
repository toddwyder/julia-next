import assert from 'node:assert/strict';
import { readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { openRunner } from '../adapter.mjs';

const { options, scenario } = JSON.parse(await readFile(process.argv[2], 'utf8'));
if (scenario !== 'mutable-home') {
  process.env.REVIEW_RUNTIME_MARKER = 'must survive boundary rejection';
  await assert.rejects(openRunner(options), /outside builder workspace/);
  assert.equal(process.env.REVIEW_RUNTIME_MARKER, 'must survive boundary rejection');
} else {
  const runner = await openRunner(options);
  try {
    const marker = 'synthetic-private-auth-review-marker';
    await writeFile(join(options.stateDir, 'auth.json'), marker);
    const home = join(options.cwd, '.builder-home');
    await rm(home, { recursive: true, force: true });
    await symlink(options.stateDir, home);
    const result = String(await runner.execute("node -e 'try{console.log(require(\"fs\").readFileSync(\".builder-home/auth.json\",\"utf8\"))}catch(e){if(e.code!==\"EACCES\")throw e;console.log(\"outside-auth-denied\")}'"));
    assert.equal(result.includes(marker), false, result);
    assert.match(result, /outside-auth-denied|builder command refused/);
  } finally {
    await runner.close();
  }
}
console.log('review adapter proof passed');
