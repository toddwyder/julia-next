import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const checker = fileURLToPath(new URL('../../../scripts/check-agent-links.mjs', import.meta.url));
const cases = [
  { ref: 'dbfb572', messages: ['CLAUDE.md:24: AGENTS.md#building-and-reviewing has no matching heading'] },
  { ref: 'd87e80c', messages: ['AGENTS.md:8: framework/ does not exist', 'CLAUDE.md:24: AGENTS.md#building-and-reviewing has no matching heading'] },
  { ref: 'a451f73', messages: ['CLAUDE.md:24: AGENTS.md#building-and-reviewing has no matching heading'] },
];
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));

for (const { ref, messages } of cases) {
  const root = mkdtempSync(join(tmpdir(), 'correct-history-'));
  try {
    const commit = execFileSync('git', ['rev-parse', ref], { env, encoding: 'utf8' }).trim();
    const archive = execFileSync('git', ['archive', commit], { env, maxBuffer: 128 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', root], { input: archive });
    const result = spawnSync(process.execPath, [checker], { cwd: root, env, encoding: 'utf8' });
    const sourceSha256 = createHash('sha256').update(readFileSync(checker)).digest('hex');
    console.log(JSON.stringify({ commit, command: 'node scripts/check-agent-links.mjs', sourceSha256, exitCode: result.status, stdout: result.stdout, stderr: result.stderr }, null, 2));
    assert.equal(result.status, 1, result.stderr);
    for (const message of messages) assert.ok(result.stderr.includes(message), `Missing historical failure: ${message}`);
  } finally { rmSync(root, { force: true, recursive: true }); }
}
