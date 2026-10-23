import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const [root, issue, sha, body] = process.argv.slice(2);
if (!root || !issue || !/^[0-9a-f]{40}$/.test(sha ?? '') || !body || /[\r\n]/.test(body)) throw new Error('Invalid blocked notification');
const { getIssue } = await import(pathToFileURL(join(root, 'scripts/linear-cli.mjs')));
const card = await getIssue(issue, { apiKey: process.env.LINEAR_API_KEY, includeComments: true });
if (!card) throw new Error('Blocked notification card does not exist');
const existing = card.comments.nodes.find(comment => comment.body.includes(`(maintenance ${sha})`));
if (existing) console.log(JSON.stringify({ id: existing.id, recovered: true }));
else {
  const result = spawnSync(process.execPath, [join(root, 'scripts/linear-cli.mjs'), 'comment', issue, body], { encoding: 'utf8', env: process.env });
  if (result.status !== 0 || result.error) throw new Error(result.error?.message ?? result.stderr);
  console.log(result.stdout.trim());
}
