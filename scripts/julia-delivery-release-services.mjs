import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { acquireRunLock, loadText, saveJson } from './julia-delivery-state.mjs';
import { continueRelease } from './julia-delivery-release.mjs';
import { checkedReview } from './julia-delivery-review.mjs';

function serviceFailure(operation, details = {}) {
  return Object.assign(new Error('release service operation failed'), { diagnostic: { operation, ...details } });
}

function command(executable, args, cwd) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  // Commands may contain signed URLs or provider diagnostics: retain only the
  // operation and exit code in errors, never credentials or raw stderr.
  if (result.error || result.status !== 0) throw serviceFailure('command', { executable, command: args[0], exitCode: result.status, code: result.error ? 'COMMAND_START_FAILED' : 'COMMAND_EXIT_FAILED' });
  return result.stdout.trim();
}

export function releaseServices({ issueId, runPath, configuration: config, env = process.env, fetchImpl = fetch, execute = command, sleep = ms => new Promise(done => setTimeout(done, ms)), pollAttempts = 120 }) {
  let productionUrl; try { productionUrl = new URL(config.productionUrl); } catch { throw serviceFailure('release configuration', { code: 'INVALID_PRODUCTION_URL' }); }
  if (!/^[\w.-]+\/[\w.-]+$/.test(config.repository ?? '') || !config.projectId || productionUrl.protocol !== 'https:') throw serviceFailure('release configuration', { code: 'INVALID_REPOSITORY_PROJECT_OR_URL' });
  const directory = dirname(runPath), statePath = join(directory, `${issueId}-release.json`);
  const gh = (args, cwd) => execute('gh', args, cwd);
  const api = (path, fields = [], method = 'GET') => JSON.parse(gh(['api', '--method', method, path, ...fields.flatMap(([key, value]) => ['-f', `${key}=${value}`])]));
  const vercel = async (path, options = {}) => {
    if (!env.VERCEL_TOKEN) throw serviceFailure('Vercel credentials', { code: 'MISSING_TOKEN' });
    const url = new URL(path, 'https://api.vercel.com');
    if (config.teamId) url.searchParams.set('teamId', config.teamId);
    let response;
    try { response = await fetchImpl(url, { ...options, headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000) }); }
    catch { throw serviceFailure('Vercel HTTP', { method: options.method ?? 'GET', path: url.pathname, code: 'NETWORK_ERROR' }); }
    if (!response.ok) throw serviceFailure('Vercel HTTP', { method: options.method ?? 'GET', path: url.pathname, status: response.status });
    return response.json();
  };
  const deployment = value => ({ id: value.id ?? value.uid, url: `https://${value.url}`, commit: value.meta?.githubCommitSha, ready: (value.readyState ?? value.state) === 'READY', projectId: value.projectId });
  const currentProduction = async () => {
    const value = await vercel(`/v13/deployments/${encodeURIComponent(new URL(config.productionUrl).hostname)}`);
    if (value.projectId !== config.projectId) throw serviceFailure('production identity', { code: 'PROJECT_MISMATCH' });
    return deployment(value);
  };
  const find = async (sha, target) => {
    const value = await vercel(`/v7/deployments?projectId=${encodeURIComponent(config.projectId)}&sha=${sha}&target=${target}&limit=20`);
    const matches = (value.deployments ?? []).filter(item => item.meta?.githubCommitSha === sha).sort((a, b) => b.created - a.created);
    // A failed build is actionable rather than an endless wait.
    const failed = ['ERROR', 'CANCELED'].includes(matches[0]?.state) ? matches[0] : null;
    if (failed) {
      if (target === 'preview') throw serviceFailure('preview build', { code: failed.state, deploymentId: failed.uid ?? failed.id });
      return { ...deployment(failed), ready: true, failed: true, reason: `production deployment ${failed.state}` };
    }
    const found = matches[0]?.state === 'READY' ? matches[0] : null;
    return found ? deployment(found) : null;
  };
  return {
    load: async () => { const text = await loadText(statePath); return text == null ? null : JSON.parse(text); },
    save: value => saveJson(statePath, value),
    verify: async ({ issueId, commit, handoffPath, worktree }) => {
      const record = JSON.parse(await loadText(join(directory, `${issueId}-state.json`)));
      const handoff = JSON.parse(await loadText(handoffPath));
      const review = record.actions.find(action => action.kind === 'review' && action.round === handoff.round && action.status === 'done');
      return record.result?.outcome === 'pass' && record.result.commit === commit && record.result.handoffPath === handoffPath &&
        handoff.candidate.commit === commit && checkedReview(review?.outcome?.text, handoff.input).verdict === 'PASS' &&
        execute('git', ['rev-parse', 'HEAD'], worktree.path) === commit && !execute('git', ['status', '--porcelain'], worktree.path) &&
        execute('git', ['branch', '--show-current'], worktree.path) === worktree.branch &&
        ['https://github.com/' + config.repository, 'git@github.com:' + config.repository].includes(execute('git', ['remote', 'get-url', 'origin'], worktree.path).replace(/\.git$/, ''));
    },
    publish: async ({ issueId, commit, worktree }) => {
      execute('git', ['push', 'origin', `${commit}:refs/heads/${worktree.branch}`], worktree.path);
      let prs = JSON.parse(gh(['pr', 'list', '--repo', config.repository, '--head', worktree.branch, '--state', 'open', '--json', 'number,url,headRefOid'], worktree.path));
      if (!prs.length) {
        gh(['pr', 'create', '--repo', config.repository, '--base', 'main', '--head', worktree.branch, '--title', `${issueId}: independently reviewed candidate`, '--body', `Reviewed commit: ${commit}\nAwaiting Todd UAT on the matching Vercel preview. The saved run contains the independent review and check evidence.`], worktree.path);
        prs = JSON.parse(gh(['pr', 'list', '--repo', config.repository, '--head', worktree.branch, '--state', 'open', '--json', 'number,url,headRefOid'], worktree.path));
      }
      if (prs.length !== 1 || prs[0].headRefOid !== commit) throw serviceFailure('PR identity', { code: 'REVIEWED_HEAD_MISMATCH' });
      return { number: prs[0].number, url: prs[0].url };
    },
    preview: ({ commit }) => find(commit, 'preview'),
    mergeGate: async ({ commit, pr, handoffPath }) => {
      const value = api(`repos/${config.repository}/pulls/${pr.number}`);
      const handoff = JSON.parse(await loadText(handoffPath));
      const protection = api(`repos/${config.repository}/branches/main/protection`);
      const checks = JSON.parse(gh(['pr', 'checks', String(pr.number), '--repo', config.repository, '--required', '--json', 'bucket,name']));
      const previous = await currentProduction();
      return { head: value.head.sha, previous, pass: value.state === 'open' && value.base.ref === 'main' && value.base.sha === handoff.candidate.base && protection.required_status_checks?.strict === true && protection.enforce_admins?.enabled === true && !value.draft && value.head.sha === commit && value.mergeable === true && value.mergeable_state === 'clean' && checks.length > 0 && checks.every(check => check.bucket === 'pass') && previous.ready };
    },
    merge: ({ commit, pr }) => {
      const result = api(`repos/${config.repository}/pulls/${pr.number}/merge`, [['sha', commit], ['merge_method', 'squash']], 'PUT');
      if (!result.merged) throw serviceFailure('GitHub merge', { code: 'MERGE_REFUSED' });
      const reviewed = api(`repos/${config.repository}/git/commits/${commit}`);
      const merged = api(`repos/${config.repository}/git/commits/${result.sha}`);
      return { commit: result.sha, treeMatches: reviewed.tree.sha === merged.tree.sha };
    },
    production: async ({ mergedCommit }) => {
      let found = null;
      for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
        found = await find(mergedCommit, 'production');
        if (found) break;
        await sleep(5000);
      }
      if (!found) return null;
      if (found.failed) return found;
      const current = await currentProduction();
      if (current.id !== found.id) throw serviceFailure('production identity', { code: 'MERGED_DEPLOYMENT_NOT_SERVING' });
      return found;
    },
    smoke: async ({ worktree, mergedCommit }) => {
      // Use the reviewed checkout's existing home journey plus a deployment
      // identity check. No local dev server and no alternate test substitute.
      const args = [join(worktree.path, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', '--config', 'playwright.release.config.mjs'];
      const result = spawnSync(process.execPath, args, { cwd: worktree.path, env: { ...env, JULIA_SMOKE_URL: config.productionUrl, JULIA_SMOKE_COMMIT: mergedCommit }, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
      await saveJson(join(directory, `${issueId}-production-smoke.json`), { commit: mergedCommit, url: config.productionUrl, exitCode: result.status, stdout: result.stdout, stderr: result.stderr });
      return { pass: result.status === 0, evidencePath: join(directory, `${issueId}-production-smoke.json`) };
    },
    rollback: async ({ previous, failed }) => {
      const current = await currentProduction();
      if (current.id === previous.id) return { pass: true, deploymentId: previous.id, reason: 'prior deployment is already serving' };
      if (current.id !== failed.id) return { pass: false, reason: 'production moved; refusing to replace another release' };
      await vercel(`/v9/projects/${encodeURIComponent(config.projectId)}/rollback/${encodeURIComponent(previous.id)}`, { method: 'POST', body: '{}' });
      // Vercel applies rollback asynchronously; bounded observation never
      // repeats the rollback POST.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if ((await currentProduction()).id === previous.id) return { pass: true, deploymentId: previous.id };
        await sleep(1000);
      }
      return { pass: false, reason: 'rollback requested but prior deployment was not observed serving' };
    },
  };
}

export async function startRelease({ issueId, runPath, result, configuration, decision }) {
  const lock = await acquireRunLock(join(dirname(runPath), `${issueId}-lock.json`));
  if (!lock.ok) return { outcome: 'park', reason: lock.reason };
  try {
    const record = JSON.parse(await loadText(join(dirname(runPath), `${issueId}-state.json`)));
    return await continueRelease({ issueId, commit: result.commit, handoffPath: result.handoffPath, worktree: record.worktree, configuration, decision }, releaseServices({ issueId, runPath, configuration }));
  } catch (error) {
    const refused = { outcome: 'park', reason: 'release operation failed; inspect saved release journal and service diagnostics before resuming', diagnostic: error.diagnostic ?? { operation: 'release', code: 'UNEXPECTED_ERROR' } };
    await saveJson(join(dirname(runPath), `${issueId}-release-error.json`), refused);
    return refused;
  } finally { await lock.release(); }
}
