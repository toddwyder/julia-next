#!/usr/bin/env node
// jul73-codex-sandbox-probe.mjs -- JUL-73: a deterministic check of exactly
// the two things the codex orchestrator branch needs from its own sandbox:
// read access to the publisher credential file, and reachability of the
// Orca runtime. Meant to be run by asking Codex, in a narrow prompt, to
// execute `node scripts/jul73-codex-sandbox-probe.mjs` and relay its exact
// stdout (see scripts/jul73-quota-reset-run.mjs's buildSandboxProbeCommand
// and the runbook's "Second vendor" section) -- `codex exec` has no
// separate "run this literal command, bypass the model" form (its
// `<COMMAND> [ARGS]` alternate usage line names its own subcommands --
// resume/fork/review/help -- not an arbitrary shell command; an earlier
// draft of this comment claimed otherwise and was wrong, caught by
// review). A pass/fail here still reflects Codex's own sandbox permissions
// (this script runs inside whatever process Codex's sandbox spawned for
// it), just via a trusted model relay rather than a hard bypass.
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
