#!/usr/bin/env node
// check-readiness.mjs -- checks every precondition for dispatching
// julia-next-supervised-worker-manual.yml (AI-Stack), the existing
// BERTHA/GitHub-Actions coordinator this run goes through. Each
// precondition is reported as its own pass/fail line, not folded into one
// generic result -- a missing secret and an offline runner are different
// problems with different fixes.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const REQUIRED_SECRETS = ['JULIA_NEXT_DEPLOY_KEY', 'JULIA_PUBLISHER_APP_ID', 'JULIA_PUBLISHER_APP_PRIVATE_KEY', 'LINEAR_API_KEY'];

async function defaultGhImpl(args) {
  const { stdout } = await execFileAsync('gh', args, { maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

function check(name, ok, detail) {
  return { name, ok, detail };
}

export async function checkReadiness({ ghImpl = defaultGhImpl } = {}) {
  const checks = [];

  try {
    const runnersJson = await ghImpl(['api', 'repos/toddwyder/AI-Stack/actions/runners']);
    const { runners } = JSON.parse(runnersJson);
    const bertha = runners.find((r) => r.name === 'BERTHA');
    if (!bertha) {
      checks.push(check('BERTHA runner online', false, 'no runner named BERTHA is registered on toddwyder/AI-Stack'));
    } else if (bertha.status !== 'online') {
      checks.push(check('BERTHA runner online', false, `BERTHA is registered but status is "${bertha.status}", not online -- start its runner service before dispatching`));
    } else {
      checks.push(check('BERTHA runner online', true, 'BERTHA is registered and online'));
    }
  } catch (error) {
    checks.push(check('BERTHA runner online', false, `could not query AI-Stack's registered runners: ${error.message}`));
  }

  try {
    const secretListing = await ghImpl(['secret', 'list', '-R', 'toddwyder/AI-Stack']);
    const configured = new Set(secretListing.split(/\r?\n/).map((line) => line.split(/\s+/)[0]).filter(Boolean));
    for (const name of REQUIRED_SECRETS) {
      checks.push(
        configured.has(name)
          ? check(`${name} configured`, true, `present in toddwyder/AI-Stack's Actions secrets`)
          : check(`${name} configured`, false, `not found in toddwyder/AI-Stack's Actions secrets`),
      );
    }
  } catch (error) {
    for (const name of REQUIRED_SECRETS) {
      checks.push(check(`${name} configured`, false, `could not list toddwyder/AI-Stack's secrets: ${error.message}`));
    }
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
