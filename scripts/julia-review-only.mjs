// The vault allows this narrow launcher, not arbitrary `op run` commands.
// It creates a clean detached view of an existing PR, then asks the review-only
// runner to examine that immutable commit through its read-only Mastra tools.
import { mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startReviewOnly } from './julia-delivery-runner.mjs';

const ISSUE = /^JUL-\d+$/;
const POSITIVE = /^[1-9]\d*$/;

function reject(message) { throw new Error(`startReviewOnly: ${message}`); }
function execute(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || result.error?.message || '').trim()}`);
  return result.stdout.trim();
}

export function parseReviewOnlyCommand(args) {
  const [issueId, flag, pullRequest, ...rest] = args;
  if (!ISSUE.test(issueId ?? '')) reject('must name a Julia card such as JUL-206');
  if (flag !== '--pr' || !POSITIVE.test(pullRequest ?? '') || rest.length) reject('use JUL-nnn --pr positive-number');
  return { issueId, pullRequest: Number(pullRequest) };
}

export function authorizedReviewConfiguration() {
  return {
    builder: { identity: 'anthropic-builder', model: 'opus', maker: 'Anthropic', harness: 'claude-code', thinking: 'high', connection: { route: 'native', provider: null, endpoint: null, protocol: null, authReference: null } },
    reviewer: { identity: 'commandcode-deepseek-reviewer', model: 'deepseek/deepseek-v4.1-flash', maker: 'DeepSeek', harness: 'omp', thinking: null, connection: { route: 'api', provider: 'commandcode', endpoint: 'https://api.commandcode.ai/provider/v1', protocol: 'openai-completions', authReference: 'env:COMMANDCODE_API_KEY' } },
  };
}

export function authorizedReviewSpending() {
  return { builder: { mode: 'subscription', maxUsd: 0 }, reviewer: { mode: 'paid', maxUsd: 0.50, cumulativeMaxUsd: 1 } };
}

export async function runReviewOnly(args, { root = resolve(fileURLToPath(new URL('..', import.meta.url))), stateDirectory = process.env.JULIA_RUN_DIRECTORY ?? join(homedir(), '.julia', 'runs'), start = startReviewOnly } = {}) {
  const { issueId, pullRequest } = parseReviewOnlyCommand(args);
  const target = JSON.parse(execute('gh', ['pr', 'view', String(pullRequest), '--json', 'headRefOid'], { cwd: root }));
  if (!/^[0-9a-f]{40}$/i.test(target.headRefOid ?? '')) reject(`PR ${pullRequest} has no immutable head commit`);
  const workspace = join(stateDirectory, `${issueId}-pr-${pullRequest}-review`);
  await mkdir(stateDirectory, { recursive: true });
  // The candidate cannot be checked out from a mutable PR branch after this point.
  execute('git', ['fetch', 'origin', target.headRefOid], { cwd: root });
  execute('git', ['worktree', 'add', '--detach', workspace, target.headRefOid], { cwd: root });
  try {
    const checksText = execute('gh', ['pr', 'checks', String(pullRequest), '--required'], { cwd: root });
    const configuration = authorizedReviewConfiguration();
    const authorization = { issueId, explicitStart: true, authorizedBy: 'Todd: JUL-206 reviewer authorization', spending: authorizedReviewSpending(), configuration };
    return await start(issueId, configuration, {
      pullRequest, workspace: { path: workspace },
      checks: { pass: true, summary: 'GitHub required checks passed' },
      runs: [{ commit: target.headRefOid, status: 0, output: checksText }],
      runPath: join(stateDirectory, `${issueId}-review-pr-${pullRequest}.json`), authorization,
    });
  } finally {
    execute('git', ['worktree', 'remove', '--force', workspace], { cwd: root });
    await rm(workspace, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runReviewOnly(process.argv.slice(2)).then(result => console.log(JSON.stringify(result)), error => { console.error(error.message); process.exitCode = 1; });
}
