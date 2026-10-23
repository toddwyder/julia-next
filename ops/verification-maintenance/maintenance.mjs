import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export function command(name, args, cwd, options = {}) {
  const result = spawnSync(name, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(`${name} failed (${result.status}): ${result.error?.message ?? result.stderr?.slice(-4000)}`);
  return result.stdout?.trimEnd() ?? '';
}
const git = (repo, ...args) => command('git', args, repo);
function save(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.new`, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(`${file}.new`, file);
}
function json(file) { return JSON.parse(readFileSync(file, 'utf8')); }
export function skills(repo) {
  const root = join(repo, '.agents/skills');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter(name => name.startsWith('verify-') && existsSync(join(root, name, 'SKILL.md')) && existsSync(join(root, name, 'features/README.md'))).sort().map(name => `.agents/skills/${name}`);
}
export function sandbox(repo, targets, scratch) {
  const args = ['--die-with-parent', '--ro-bind', '/', '/', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--ro-bind', repo, repo, '--bind', scratch, scratch];
  for (const target of targets) args.push('--bind', join(repo, target), join(repo, target));
  for (const folder of ['.next', '.artifacts', 'test-results', 'playwright-report', '.playwright-cli', 'node_modules']) {
    mkdirSync(join(repo, folder), { recursive: true });
    args.push('--bind', join(repo, folder), join(repo, folder));
  }
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
  args.push('--bind', codexHome, codexHome, '--chdir', repo);
  return args;
}
function safeEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/API_KEY|ACCESS_TOKEN|SERVICE_ACCOUNT_TOKEN|^(GH_TOKEN|GITHUB_TOKEN|OPENAI_BASE_URL|OPENAI_API_BASE)$/.test(key)) delete env[key];
  return env;
}
export function launch(config, record, runDir) {
  const repo = join(runDir, 'repository');
  const scratch = join(runDir, 'scratch');
  mkdirSync(scratch, { recursive: true });
  git(undefined, 'clone', '--no-hardlinks', '--no-checkout', config.cache, repo);
  git(repo, 'checkout', '--detach', record.sha);
  git(repo, 'remote', 'set-url', 'origin', config.repository);
  const targets = skills(repo);
  if (!targets.length) throw new Error('No project verification skill has a skill-local feature map');
  const auth = json(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json'));
  if (auth.auth_mode !== 'chatgpt' || !auth.tokens) throw new Error('Signed-in ChatGPT plan authentication is required for $0 maintenance');
  if (existsSync(join(repo, 'package-lock.json'))) command('npm', ['ci', '--no-audit', '--no-fund'], repo, { env: safeEnvironment() });
  const schema = join(scratch, 'result-schema.json');
  const resultPath = join(scratch, 'result.json');
  save(schema, { type: 'object', additionalProperties: false, required: ['outcome', 'summary', 'coverage', 'proof'], properties: { outcome: { enum: ['clean', 'changed', 'blocked'] }, summary: { type: 'string' }, coverage: { type: 'array', items: { type: 'string' } }, proof: { type: 'array', items: { type: 'string' } } } });
  const prompt = `Run .agents/skills/maintain-verification-skill/SKILL.md separately on each of these project verification skills: ${targets.join(', ')}. Read that skill in full and execute its source wave and live pass. This is automatic maintenance after merge ${record.sha} to ${config.branch}. Product source is mounted read-only. Only the target skill folders may change. Scratch notes and live evidence belong in ${scratch}. No API provider calls or spending. Use the existing signed-in Codex plan and inherited model for subagents. Do not publish, commit, or create a branch; the controller alone publishes at most one combined PR after validating all changes. Return clean only after every feature has source and live coverage and nothing needs shipping. Return changed only with re-driven live proof for every correction, and put absolute evidence paths in proof. Return blocked with one plain-English line if coverage or correction cannot finish. Never edit product code. Preserve evidence. Clean and blocked produce no PR.`;
  writeFileSync(join(scratch, 'prompt.txt'), prompt);
  const stdout = openSync(join(runDir, 'events.jsonl'), 'w');
  const stderr = openSync(join(runDir, 'stderr.log'), 'w');
  record.targets = targets;
  record.state = 'running';
  record.launchedAt = new Date().toISOString();
  save(join(runDir, 'run.json'), record);
  const args = [...sandbox(repo, targets, scratch), '--', 'codex', 'exec', '--json', '-c', 'model_provider="openai"', '--sandbox', 'danger-full-access', '--output-schema', schema, '--output-last-message', resultPath, '--cd', repo, prompt];
  let result;
  try { result = spawnSync('bwrap', args, { cwd: repo, env: safeEnvironment(), stdio: ['ignore', stdout, stderr], timeout: config.timeoutMs ?? 1800000 }); }
  finally { closeSync(stdout); closeSync(stderr); }
  const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  record.sessions = events.filter(event => event.type === 'thread.started').map(event => event.thread_id);
  if (result.error || result.status !== 0) throw new Error(`Codex execution failed (${result.status}): ${result.error?.message ?? readFileSync(join(runDir, 'stderr.log'), 'utf8').slice(-2000)}`);
  if (record.sessions.length !== 1) throw new Error('Expected exactly one fresh coordinator thread');
  const outcome = json(resultPath);
  if (!['clean', 'changed', 'blocked'].includes(outcome.outcome)) throw new Error('Invalid maintenance outcome');
  if (git(repo, 'rev-parse', 'HEAD') !== record.sha) throw new Error('Maintenance altered the candidate commit');
  const changed = git(repo, 'status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean).map(line => line.slice(3));
  if (changed.some(path => !targets.some(target => path.startsWith(`${target}/`)))) throw new Error('Maintenance changed a path outside a target skill');
  if (outcome.outcome === 'clean' && changed.length) throw new Error('Clean maintenance left corrections');
  if (outcome.outcome === 'changed') {
    if (!changed.length || !outcome.proof.length || outcome.proof.some(path => !path.startsWith(`${scratch}/`) || !existsSync(path))) throw new Error('Changed maintenance requires corrections and retained live evidence');
    git(repo, 'checkout', '-b', `maintenance/verification-${record.sha.slice(0, 12)}`);
    git(repo, 'add', '--', ...targets);
    git(repo, 'commit', '-m', `Maintain verification skills after ${record.sha.slice(0, 12)}`);
    git(repo, 'push', '-u', 'origin', 'HEAD');
    const body = join(scratch, 'pull-request.md');
    writeFileSync(body, `${outcome.summary}\n\nLive verification evidence\n\n${outcome.proof.map(path => `- ${path}`).join('\n')}\n`);
    record.pr = command('gh', ['pr', 'create', '--repo', config.githubRepository, '--base', config.branch, '--head', `maintenance/verification-${record.sha.slice(0, 12)}`, '--title', 'Maintain project verification skills', '--body-file', body], repo);
  }
  return { ...record, state: outcome.outcome, result: outcome, finishedAt: new Date().toISOString() };
}
export function mergedPullRequests(config, sha) {
  if (!config.githubRepository) return [];
  const prs = JSON.parse(command('gh', ['api', `repos/${config.githubRepository}/commits/${sha}/pulls?per_page=100`], undefined));
  return prs.filter(pr => pr.merged_at && pr.base.ref === config.branch && pr.merge_commit_sha === sha);
}
function notifyBlocked(config, record, runDir) {
  if (record.state !== 'blocked' || record.notification) return record;
  const body = `Verification maintenance blocked after ${record.sha.slice(0, 12)}: ${String(record.error ?? record.result.summary).replace(/\s+/g, ' ').trim()} (maintenance ${record.sha})`;
  writeFileSync(join(runDir, 'TODD.txt'), `${body}\n`);
  if (!config.notification) return record;
  try {
    const { program, root, issue } = config.notification;
    const [executable, ...args] = program ?? [process.execPath, join(root, 'scripts/julia-agents.mjs'), '--', process.execPath, join(here, 'notify-blocked.mjs'), root, issue, record.sha];
    const notification = JSON.parse(command(executable, [...args, body], root));
    if (!notification.id) throw new Error('Blocked notification returned no Linear comment identity');
    const { notificationError, ...previous } = record;
    record = { ...previous, notification, notifiedAt: new Date().toISOString() };
  } catch (error) { record = { ...record, notificationError: error.message }; }
  save(join(runDir, 'run.json'), record);
  return record;
}
export function poll(input, run = launch) {
  const config = { ...input, state: resolve(input.state), cache: join(resolve(input.state), 'cache.git') };
  mkdirSync(config.state, { recursive: true });
  const lock = join(config.state, 'observer.lock');
  try { const fd = openSync(lock, 'wx'); writeFileSync(fd, String(process.pid)); closeSync(fd); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    try { process.kill(Number(readFileSync(lock, 'utf8')), 0); return { busy: true }; }
    catch (failure) { if (failure.code !== 'ESRCH') throw failure; unlinkSync(lock); return poll(config, run); }
  }
  try {
    const runs = join(config.state, 'runs');
    if (existsSync(runs)) for (const sha of readdirSync(runs)) {
      const runDir = join(runs, sha);
      notifyBlocked(config, json(join(runDir, 'run.json')), runDir);
    }
    if (!existsSync(config.cache)) git(undefined, 'init', '--bare', config.cache);
    git(config.cache, 'fetch', config.repository, `+refs/heads/${config.branch}:refs/heads/watched`);
    const head = git(config.cache, 'rev-parse', 'refs/heads/watched');
    const cursorFile = join(config.state, 'cursor.json');
    if (!existsSync(cursorFile)) { save(cursorFile, { sha: head }); return { baseline: head, launched: 0 }; }
    const cursor = json(cursorFile).sha;
    git(config.cache, 'merge-base', '--is-ancestor', cursor, head);
    const commits = git(config.cache, 'rev-list', '--first-parent', '--reverse', `${cursor}..${head}`).split('\n').filter(Boolean);
    let launched = 0;
    for (const sha of commits) {
      const parents = git(config.cache, 'rev-list', '--parents', '-n', '1', sha).split(' ').slice(1);
      const associated = mergedPullRequests(config, sha);
      if (parents.length > 1 || associated.length) {
        const runDir = join(config.state, 'runs', sha);
        const recordFile = join(runDir, 'run.json');
        if (!existsSync(recordFile)) {
          let record = { sha, branch: config.branch, repository: config.repository, state: 'claimed', parents, pullRequests: associated.map(pr => pr.number), claimedAt: new Date().toISOString() };
          save(recordFile, record);
          try { launched++; record = run(config, record, runDir); }
          catch (error) { record = { ...json(recordFile), state: 'blocked', error: error.message }; }
          save(recordFile, record);
          notifyBlocked(config, record, runDir);
        } else {
          const record = json(recordFile);
          if (['claimed', 'running'].includes(record.state)) {
            save(recordFile, { ...record, state: 'blocked', error: 'Previous observer stopped after claiming this merge; inspect retained session evidence before recovery.' });
            notifyBlocked(config, json(recordFile), runDir);
          }
        }
      }
      save(cursorFile, { sha });
    }
    return { head, commits: commits.length, launched };
  } finally { unlinkSync(lock); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, configFile] = process.argv.slice(2);
  if (!['poll', 'status'].includes(action) || !configFile) throw new Error('Usage: node maintenance.mjs <poll|status> <config.json>');
  const config = json(resolve(configFile));
  if (action === 'poll') console.log(JSON.stringify(poll(config)));
  else console.log(JSON.stringify({ cursor: existsSync(join(config.state, 'cursor.json')) ? json(join(config.state, 'cursor.json')) : null, runs: existsSync(join(config.state, 'runs')) ? readdirSync(join(config.state, 'runs')).map(sha => json(join(config.state, 'runs', sha, 'run.json'))) : [] }, null, 2));
}
