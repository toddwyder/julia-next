#!/usr/bin/env node
// check-readiness.mjs -- checks every precondition for the julia-coordinator
// skill (.claude/skills/julia-coordinator/SKILL.md) to dispatch through
// Orca on the OVH runner and publish through julia-graph-publisher. Each
// precondition is reported as its own pass/fail line, not folded into one
// generic result -- an unreachable runner and a missing credential are
// different problems with different fixes.
//
// No LINEAR_API_KEY check: the coordinator is a live agent session using
// Linear's MCP tools directly (docs/agents/issue-tracker.md), not a
// headless script that needs its own API key -- that requirement was
// inherited from an earlier session's AI-Stack-headless-script design that
// this route no longer uses.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getPublisherInstallationToken } from './publish-via-github-app.mjs';
import { terminalCreate, terminalRead } from './orca-cli.mjs';

const execFileAsync = promisify(execFile);
const ORCA_BIN = process.env.ORCA_BIN
  || 'C:\\Users\\toddw\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';
const ENVIRONMENT = 'OVH runner';
const JULIA_NEXT_PROJECT_ID = 'github:toddwyder/julia-next';

function check(name, ok, detail) {
  return { name, ok, detail };
}

async function defaultOrcaStatusImpl() {
  const { stdout } = await execFileAsync(ORCA_BIN, ['status', '--environment', ENVIRONMENT, '--json']);
  return JSON.parse(stdout);
}

async function defaultOrcaProjectSetupsImpl() {
  const { stdout } = await execFileAsync(ORCA_BIN, ['project', 'setups', '--environment', ENVIRONMENT, '--json']);
  return JSON.parse(stdout);
}

async function defaultPublisherCheckImpl() {
  try {
    // getPublisherInstallationToken both checks installation and mints a
    // token; a readiness check only needs the first half, but there is no
    // separate installation-only endpoint call worth duplicating here --
    // minting a short-lived token as a side effect of a readiness check is
    // harmless (it is never used) and keeps this check exercising the exact
    // path a real publish will take.
    await getPublisherInstallationToken({
      ...process.env,
      JULIA_PUBLISHER_REPO: 'julia-next',
    });
    return { installed: true, detail: 'julia-graph-publisher is installed on toddwyder/julia-next' };
  } catch (error) {
    return { installed: false, detail: error.message };
  }
}

async function defaultRelayCheckImpl() {
  // The relay binds to 127.0.0.1:8943 on the OVH runner only, so this must
  // run from a terminal on that runner, not from wherever this check
  // itself is invoked.
  const { terminal } = await terminalCreate({
    environment: ENVIRONMENT,
    // path:<path> avoids needing this runner's internal repo UUID -- the
    // main julia-next checkout's real filesystem path, confirmed live via
    // `orca project setups` (see the "julia-next project registered" check
    // above), not a guessed selector.
    worktree: 'path:/home/runner/julia-next',
    command: 'curl -s -m 5 -X POST http://127.0.0.1:8943/events -H "content-type: application/json" -d \'{"event":"journey-relay.readiness-check","attempted":"readiness","reason":"check-readiness.mjs","context":"readiness"}\'',
    title: 'readiness-relay-check',
  });
  const { output } = await terminalRead({ environment: ENVIRONMENT, terminal });
  if (/"sent":\s*true/.test(output ?? '')) {
    return { reachable: true, detail: output };
  }
  return { reachable: false, detail: `journey-relay at 127.0.0.1:8943 did not confirm delivery: ${output ?? '(no output)'}` };
}

export async function checkReadiness({
  orcaStatusImpl = defaultOrcaStatusImpl,
  orcaProjectSetupsImpl = defaultOrcaProjectSetupsImpl,
  publisherCheckImpl = defaultPublisherCheckImpl,
  relayCheckImpl = defaultRelayCheckImpl,
} = {}) {
  const checks = [];

  try {
    const status = await orcaStatusImpl();
    const { reachable, connectionState } = status.result.runtime;
    checks.push(
      reachable && connectionState === 'connected'
        ? check('OVH runner reachable', true, `Orca reports the OVH runner ${connectionState}`)
        : check('OVH runner reachable', false, `Orca reports the OVH runner as ${connectionState} (reachable: ${reachable})`),
    );
  } catch (error) {
    checks.push(check('OVH runner reachable', false, error.message));
  }

  try {
    const setups = await orcaProjectSetupsImpl();
    const julia = setups.result.setups.find((s) => s.projectId === JULIA_NEXT_PROJECT_ID);
    checks.push(
      julia && julia.setupState === 'ready'
        ? check('julia-next project registered', true, `ready at ${julia.path}`)
        : check('julia-next project registered', false, 'no ready setup found for github:toddwyder/julia-next on the OVH runner'),
    );
  } catch (error) {
    checks.push(check('julia-next project registered', false, error.message));
  }

  try {
    const { installed, detail } = await publisherCheckImpl();
    checks.push(check('julia-graph-publisher installed on julia-next', installed, detail));
  } catch (error) {
    checks.push(check('julia-graph-publisher installed on julia-next', false, error.message));
  }

  try {
    const { reachable, detail } = await relayCheckImpl();
    checks.push(check('journey-relay reachable', reachable, detail));
  } catch (error) {
    checks.push(check('journey-relay reachable', false, error.message));
  }

  return { ok: checks.every((c) => c.ok), checks };
}

async function main() {
  const { ok, checks } = await checkReadiness();
  for (const c of checks) console.log(`  [${c.ok ? 'x' : ' '}] ${c.name}: ${c.detail}`);
  console.log(`READY: ${ok}`);
  process.exitCode = ok ? 0 : 1;
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
