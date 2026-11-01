// The machine borrows Mastra Code's own pieces instead of carrying copies of
// them: the same program the harness runs, the stock `subagent` tool, and the
// stock Execute subagent definition. The modules are loaded from the installed
// program because that is the only copy whose version matches the harness that
// made the changes this machine reviews (see docs/plans/path-forward.md and
// the deviation rows in docs/pstack-deviations.md).

import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const programDir = process.env.MASTRACODE_PROGRAM_DIR || path.join(os.homedir(), '.local', 'lib', 'mastracode-program');
const modules = path.join(programDir, 'node_modules');

async function load(relative) {
  return import(pathToFileURL(path.join(modules, relative)).href);
}

export const harness = { programDir, modules };

export async function loadMastra() {
  const [codeSdk, project, threadLock, workflows, requestContext, zod, core, libsql, libsqlClient] = await Promise.all([
    load('@mastra/code-sdk/dist/index.js'),
    load('@mastra/code-sdk/dist/utils/project.js'),
    load('@mastra/code-sdk/dist/utils/thread-lock.js'),
    load('@mastra/core/dist/workflows/index.js'),
    load('@mastra/core/dist/request-context/index.js'),
    load('zod/index.js'),
    load('@mastra/core/dist/index.js'),
    load('@mastra/libsql/dist/index.js'),
    load('@libsql/client/lib-esm/node.js'),
  ]);
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
    databasePath: project.getDatabasePath,
    threadLockOwner: threadLock.getThreadLockOwner,
    createClient: libsqlClient.createClient,
  };
}

// A caller that supplies storage owns the database the harness reads and writes,
// so a run can be given its own file instead of the one the store defaults to.
export async function bootHarness({ cwd, storage, createInitialThread = true, modes }) {
  const mastraTools = await loadMastra();
  const config = { cwd, createInitialThread };
  if (storage) config.storage = storage;
  if (modes !== undefined) config.modes = modes;
  const booted = await mastraTools.bootLocalAgentController(config);
  const session = booted.session;
  const mastra = booted.controller.getMastra?.() ?? booted.mastra;
  const requestContext = new mastraTools.RequestContext();
  const toolsets = await session.machinery.buildToolsets(requestContext);
  const subagent = Object.values(toolsets).find(toolset => toolset && typeof toolset === 'object' && toolset.subagent)?.subagent;
  if (!subagent) throw new Error('The harness built no subagent tool, so the machine cannot start a Shipping agent.');
  return { ...mastraTools, booted, session, mastra, requestContext, subagent };
}

export async function stopHarness(booted) {
  await booted.observability?.flush?.();
  await new Promise(resolve => setTimeout(resolve, 2000));
  await booted.observability?.shutdown?.();
  await booted.storageMaintenance?.closeStorage?.();
  await new Promise(resolve => setTimeout(resolve, 1000));
}
