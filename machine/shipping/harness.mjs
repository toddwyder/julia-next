// The machine borrows Mastra Code's own pieces instead of carrying copies of
// them: the same program the harness runs, the stock `subagent` tool, and the
// stock Execute subagent definition. The modules are loaded from the installed
// program because that is the only copy whose version matches the harness that
// made the changes this machine reviews (see docs/plans/path-forward.md and
// the deviation rows in docs/pstack-deviations.md).
//
// The next build stopped registering subagents unless the caller asked for
// them, so the harness asks, passing the three stock definitions to the boot.
// It reads them file by file because the package root only re-exports them on
// some versions.

import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const programDir = process.env.MASTRACODE_PROGRAM_DIR || path.join(os.homedir(), '.local', 'lib', 'mastracode-program');
const modules = path.join(programDir, 'node_modules');
const NEEDED = ['@mastra/code-sdk', '@mastra/core', '@mastra/libsql', '@libsql/client', 'zod'];

// The stock definitions the machine's stages hand work to, each with the file
// under dist/agents/subagents/ that exports it. One list, so the file name and
// the export cannot drift apart.
const SUBAGENTS = [
  ['explore', 'exploreSubagent'],
  ['plan', 'planSubagent'],
  ['execute', 'executeSubagent'],
];

// The agent controller gives a subagent definition no limit of its own and then
// stops the run at 50 steps (`definition.maxSteps ?? (definition.stopWhen ? void
// 0 : 50)`), and a stopped run writes no answer. The stock definitions name no
// limit, so a review of a long change spent all 50 steps on reading and came
// back empty: six attempts on PR #433, each ending at `stopReason: max_steps`,
// each with no verdict. Interactive runs in the same program stream with
// `maxSteps: 1e3` (@mastra/code-sdk/dist/index.js, the session's own run
// options), so a review gets that same ceiling instead of the default.
export const SUBAGENT_MAX_STEPS = 1000;

// A definition that already names its own limit keeps it; the stock ones get the
// interactive limit written down so no stage depends on the controller default.
export function subagentDefinitions(loaded) {
  return loaded.map(definition => ({ ...definition, maxSteps: definition.maxSteps ?? SUBAGENT_MAX_STEPS }));
}

async function load(relative) {
  return import(pathToFileURL(path.join(modules, relative)).href);
}

export const harness = { programDir, modules };

// A checkout without the installed program cannot boot anything, which is how a
// runner without Mastra Code fails: name the missing packages instead of dying
// on the first import.
export function missingProgram() {
  const missing = NEEDED.filter(name => !existsSync(path.join(modules, name)));
  return missing.length ? `the installed Mastra Code program has no ${missing.join(', ')} under ${programDir}` : null;
}

export async function loadMastra() {
  const [codeSdk, project, threadLock, workflows, requestContext, zod, core, libsql, libsqlClient, contextStorage] = await Promise.all([
    load('@mastra/code-sdk/dist/index.js'),
    load('@mastra/code-sdk/dist/utils/project.js'),
    load('@mastra/code-sdk/dist/utils/thread-lock.js'),
    load('@mastra/core/dist/workflows/index.js'),
    load('@mastra/core/dist/request-context/index.js'),
    load('zod/index.js'),
    load('@mastra/core/dist/index.js'),
    load('@mastra/libsql/dist/index.js'),
    load('@libsql/client/lib-esm/node.js'),
    load('@mastra/core/dist/observability/context-storage.js'),
  ]);
  // The package is marked side-effect free, so the span context the workflow
  // runner reads and writes has to be switched on by the caller.
  contextStorage.initContextStorage();
  return {
    bootLocalAgentController: codeSdk.bootLocalAgentController,
    createWorkflow: workflows.createWorkflow,
    createStep: workflows.createStep,
    RequestContext: requestContext.RequestContext,
    Mastra: core.Mastra,
    LibSQLStore: libsql.LibSQLStore,
    z: zod.z,
    // The store the harness defaults to, and who is writing it, for callers that
    // need to find a thread before booting: a boot claims the newest thread, so
    // the thread a caller wants has to be chosen in the store first.
    getCurrentSpan: contextStorage.getCurrentSpan,
    databasePath: project.getDatabasePath,
    threadLockOwner: threadLock.getThreadLockOwner,
    createClient: libsqlClient.createClient,
  };
}

// A caller that supplies storage owns the database the harness reads and writes,
// so a run can be given its own file instead of the one the store defaults to.
export async function bootHarness({ cwd, storage, createInitialThread = true, modes }) {
  const [mastraTools, subagents] = await Promise.all([
    loadMastra(),
    Promise.all(SUBAGENTS.map(async ([file, name]) => (await load(`@mastra/code-sdk/dist/agents/subagents/${file}.js`))[name])),
  ]);
  const config = { cwd, createInitialThread, subagents: subagentDefinitions(subagents) };
  if (storage) config.storage = storage;
  if (modes !== undefined) config.modes = modes;
  const booted = await mastraTools.bootLocalAgentController(config);
  const session = booted.session;
  const mastra = booted.controller.getMastra?.() ?? booted.mastra;
  const requestContext = new mastraTools.RequestContext();
  const toolsets = await session.machinery.buildToolsets(requestContext);
  const subagent = Object.values(toolsets).find(toolset => toolset && typeof toolset === 'object' && toolset.subagent)?.subagent;
  if (!subagent) throw new Error('The harness built no subagent tool, so the machine cannot start a review, retro or fix agent.');
  return { ...mastraTools, booted, session, mastra, requestContext, subagent };
}

// A workflow step runs inside an observability span. The stock subagent tool
// forwards `context.tracingContext` to the agent it starts, so a stage that names
// the step's span puts the agent's records inside the step's trace tree instead
// of a second root beside it. Proven by spikes/stock-workflow-proof/trace-tree.mjs:
// without the span the agent run sits in its own trace with no parent, with it the
// run nests under the workflow step in the workflow's trace.
export function agentContext(base, span) {
  return span ? { ...base, tracingContext: { currentSpan: span } } : base;
}

export async function stopHarness(booted) {
  // The boot starts a notification timer that ticks every 10s and reads thread
  // rows. Shutdown has to stop it before the storage goes: a tick that lands on
  // a closed libsql client throws CLIENT_CLOSED, and the delivery pass it is in
  // aborts the rest of the pass, so no notification — including a stop ping —
  // reaches anyone from this process after that.
  await booted.stopNotificationDispatch?.();
  await booted.observability?.flush?.();
  await new Promise(resolve => setTimeout(resolve, 2000));
  await booted.observability?.shutdown?.();
  await booted.storageMaintenance?.closeStorage?.();
  await new Promise(resolve => setTimeout(resolve, 1000));
}
