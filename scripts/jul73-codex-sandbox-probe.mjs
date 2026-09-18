#!/usr/bin/env node
// jul73-codex-sandbox-probe.mjs -- JUL-73: a deterministic, no-LLM check of
// exactly the two things the codex orchestrator branch needs from its own
// sandbox: read access to the publisher credential file, and reachability
// of the Orca runtime. Meant to be invoked as the literal command argument
// to `codex exec -- node scripts/jul73-codex-sandbox-probe.mjs` (the
// `codex exec [COMMAND] [ARGS]` form runs the command directly under
// Codex's own sandbox, without asking the model to interpret or relay a
// prompt) -- so a pass/fail here reflects Codex's sandbox permissions
// themselves, not the outer orchestrator-svc process that dispatched it.
import { accessSync, constants } from 'node:fs';
import { checkReadiness } from './check-readiness.mjs';

const PUBLISHER_ENV_FILE = '/etc/orchestrator-svc/.env.publisher';

export async function probeCodexSandbox({
  accessImpl = accessSync,
  checkReadinessImpl = checkReadiness,
  publisherEnvFile = PUBLISHER_ENV_FILE,
} = {}) {
  let publisherReadable;
  try {
    accessImpl(publisherEnvFile, constants.R_OK);
    publisherReadable = true;
  } catch {
    publisherReadable = false;
  }

  let orcaReachable;
  try {
    const { checks } = await checkReadinessImpl();
    const orcaCheck = checks.find((c) => c.name === 'OVH runner reachable');
    orcaReachable = Boolean(orcaCheck?.ok);
  } catch {
    orcaReachable = false;
  }

  return { publisherReadable, orcaReachable };
}

async function main() {
  const result = await probeCodexSandbox();
  console.log(JSON.stringify(result));
  process.exitCode = result.publisherReadable && result.orcaReachable ? 0 : 1;
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
