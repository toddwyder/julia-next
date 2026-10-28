import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { retryTurn } from './retry.mjs';
import { classifyEvent, mapStatus } from './run-state.mjs';

export const EFFORTS = { Small: 'low', Medium: 'medium', Large: 'high', Unlimited: 'max' };
const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_STOP = resolve('program/STOP');
export function checkStop(path = process.env.DASHBOARD_PROGRAM_STOP ?? DEFAULT_STOP) {
  if (existsSync(path)) throw new Error(`Program STOP is present at ${path}`);
}
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

export function prepareRun(config) {
  checkStop();
  if (!config.id || !/^[a-zA-Z0-9_-]+$/.test(config.id)) throw new Error('Run id must contain only letters, numbers, underscores and hyphens');
  if (!Object.hasOwn(EFFORTS, config.effort)) throw new Error('Unknown effort level');
  if (!config.model || !config.helperModel || !config.prompt) throw new Error('model, helperModel and prompt are required');
  if (!Number.isFinite(config.deadlineMs) || config.deadlineMs < 1000 || config.deadlineMs > 1800000) throw new Error('deadlineMs must be between 1000 and 1800000');
  if (![config.runDir, config.cwd, config.sourceAppData].every(isAbsolute)) throw new Error('runDir, cwd and sourceAppData must be absolute paths');
  if (!existsSync(join(config.sourceAppData, 'auth.json'))) throw new Error("Didn't start. Source auth.json is missing");
  const repository = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: config.cwd, encoding: 'utf8' });
  if (repository.status !== 0 || resolve(repository.stdout.trim()) !== resolve(config.cwd)) throw new Error('cwd must be an isolated repository root, not a directory inside another repository');
  const settings = JSON.parse(readFileSync(join(config.sourceAppData, 'settings.json'), 'utf8'));
  const dir = config.runDir;
  mkdirSync(dir, { recursive: false, mode: 0o700 });
  const app = join(dir, 'app');
  const home = join(dir, 'home');
  mkdirSync(app, { mode: 0o700 });
  mkdirSync(join(home, '.mastracode'), { recursive: true, mode: 0o700 });
  copyFileSync(join(config.sourceAppData, 'auth.json'), join(app, 'auth.json'));
  chmodSync(join(app, 'auth.json'), 0o600);
  const packId = `custom:${config.id}`;
  const models = { plan: config.model, build: config.model, fast: config.helperModel, memory: config.observerModel ?? config.model };
  settings.customModelPacks = [{ name: config.id, models }];
  settings.models = { ...settings.models, activeModelPackId: packId, subagentModels: {}, packFallbacks: {} };
  settings.preferences = { ...settings.preferences, thinkingLevel: EFFORTS[config.effort], subagentsEnabled: true };
  settings.onboarding = { ...settings.onboarding, completed: true };
  writeFileSync(join(app, 'settings.json'), JSON.stringify(settings), { mode: 0o600 });
  const hooks = {
    PreToolUse: [{ type: 'command', matcher: { tool_name: '^(write_file|workspace_write_file)$' }, command: `${quote(process.execPath)} ${quote(join(HERE, 'guarded-write.mjs'))}` }],
    SubagentStart: [{ type: 'command', command: `${quote(process.execPath)} ${quote(join(HERE, 'helper-log.mjs'))}` }],
  };
  writeFileSync(join(home, '.mastracode', 'hooks.json'), JSON.stringify(hooks), { mode: 0o600 });
  return { app, home, packId, models, tracePath: join(dir, 'observability.duckdb') };
}

export async function runBuild(config) {
  const paths = prepareRun(config);
  process.chdir(config.cwd);
  Object.assign(process.env, {
    MASTRA_APP_DATA_DIR: paths.app,
    MASTRA_OBSERVABILITY_DB_PATH: paths.tracePath,
    DASHBOARD_GUARD_LOG: join(config.runDir, 'guard.jsonl'),
    DASHBOARD_HELPER_LOG: join(config.runDir, 'helpers.jsonl'),
    DASHBOARD_PROGRAM_STOP: process.env.DASHBOARD_PROGRAM_STOP ?? DEFAULT_STOP,
  });
  let boot, result, failure, stopped = false, threadId;
  const controller = new AbortController();
  const note = event => {
    checkStop();
    appendFileSync(join(config.runDir, 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n', { mode: 0o600 });
  };
  const status = phase => {
    checkStop();
    writeFileSync(join(config.runDir, 'status.json'), JSON.stringify({ id: config.id, pid: process.pid, status: mapStatus({ phase, result, stopped, error: failure }), threadId, at: new Date().toISOString() }), { mode: 0o600 });
  };
  const stop = () => { stopped = true; controller.abort(new Error('Run stopped')); };
  const deadline = setTimeout(() => controller.abort(new Error('Run deadline exceeded')), config.deadlineMs);
  const watch = setInterval(() => { if (existsSync(process.env.DASHBOARD_PROGRAM_STOP)) stop(); }, 250);
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  status('starting');
  try {
    const sdk = await import('@mastra/code-sdk');
    const sdkRoot = new URL('.', import.meta.resolve('@mastra/code-sdk'));
    const { loadSettings } = await import(new URL('onboarding/settings.js', sdkRoot));
    const { resolvePackSelection } = await import(new URL('onboarding/pack-activation.js', sdkRoot));
    const { runThinkingLevel } = await import(new URL('thinking.js', sdkRoot));
    const settings = loadSettings();
    boot = await sdk.bootLocalAgentController({ cwd: config.cwd, homeDir: paths.home, initialState: { homeDir: paths.home }, disableEnvFile: true, disablePlugins: true, disableGithubSignals: true, crossAgentSignals: false, scheduleTools: false });
    if (boot.observabilityWarning || boot.storageWarning) throw new Error(boot.observabilityWarning ?? boot.storageWarning);
    controller.signal.throwIfAborted();
    status('running');
    const selection = mode => resolvePackSelection(settings, paths.packId, mode);
    const effectiveThinking = runThinkingLevel(config.model, EFFORTS[config.effort]);
    note({ type: 'pack', id: paths.packId, plan: selection('plan'), build: selection('build'), requestedThinking: EFFORTS[config.effort], effectiveThinking });
    result = await retryTurn(async attempt => {
      checkStop();
      note({ type: 'attempt', attempt });
      const run = sdk.runMC({ controller: boot.controller, session: boot.session, prompt: config.prompt, mode: 'build', pack: { id: paths.packId, resolve: selection }, thinkingLevel: effectiveThinking, ...(threadId ? { thread: { id: threadId } } : {}), signal: controller.signal });
      for await (const event of run) {
        if (event.type === 'thread_changed') threadId = event.threadId;
        note(classifyEvent(event));
      }
      const outcome = await run.result;
      threadId = outcome.threadId ?? threadId;
      note({ type: 'attempt_end', attempt, status: outcome.status, exitCode: outcome.exitCode, error: outcome.error, finishReason: outcome.finishReason });
      return outcome;
    }, { signal: controller.signal, note });
  } catch (error) {
    failure = error;
    if (!existsSync(process.env.DASHBOARD_PROGRAM_STOP)) note({ type: 'worker_error', message: error.message });
  } finally {
    clearTimeout(deadline);
    clearInterval(watch);
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    if (boot) {
      try {
        boot.releaseThreadClaims();
        boot.threadScheduler.stop();
        await boot.stopNotificationDispatch();
        boot.stopPluginSignalProviders();
        await boot.controller.getMastra().shutdown();
        if (!existsSync(process.env.DASHBOARD_PROGRAM_STOP)) note({ type: 'shutdown_complete' });
      } catch (error) { failure ??= error; }
    }
  }
  checkStop();
  const summary = { id: config.id, effort: config.effort, model: config.model, helperModel: config.helperModel, pack: { id: paths.packId, ...paths.models }, tracePath: paths.tracePath, threadId, status: mapStatus({ result, stopped, error: failure }), exitCode: stopped ? 130 : failure ? 1 : result?.exitCode ?? 1, error: failure?.message, result };
  writeFileSync(join(config.runDir, 'result.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });
  status();
  return summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const config = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
    const result = await runBuild(config);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
