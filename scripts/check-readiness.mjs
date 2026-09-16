#!/usr/bin/env node
// check-readiness.mjs -- one command, checks every precondition a JUL-43
// coordinator run needs, and fails clearly and separately on each one.
// An HTTP 200 from the relay is not enough: the relay can accept the
// request and still report `sent: false` (Axiom delivery itself failed,
// e.g. a bad/missing token) -- that must show up as a failed check here,
// not a silent pass.
//
// Uses its own distinct event name (coordinator_readiness_check), never
// coordinator_started, so running this probe can never be mistaken for a
// hung run by the stalled-run query in docs/agents/jul43-coordinator-runbook.md.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const RELAY_URL = process.env.JOURNEY_RELAY_URL || 'http://127.0.0.1:8943/events';

function check(name, ok, detail) {
  return { name, ok, detail };
}

export async function checkReadiness({ config, env = process.env, fetchImpl = fetch } = {}) {
  const checks = [];

  checks.push(
    config?.tracker === 'linear' && config?.linear?.teamKey
      ? check('project config', true, `tracker=linear, team=${config.linear.teamKey}`)
      : check('project config', false, 'config did not load as a tracker: "linear" project config'),
  );

  const credentialEnvVar = config?.handoff?.credentialEnvVar ?? 'JULIA_NEXT_GRAPH_WRITE_TOKEN';
  checks.push(
    env[credentialEnvVar]
      ? check('publisher credential', true, `${credentialEnvVar} is set`)
      : check('publisher credential', false, `${credentialEnvVar} is not set`),
  );

  checks.push(
    env.LINEAR_API_KEY
      ? check('linear credential', true, 'LINEAR_API_KEY is set')
      : check('linear credential', false, 'LINEAR_API_KEY is not set'),
  );

  // Deliberately not going through journey-events.mjs's recordEvent() here:
  // that function catches network errors and returns {sent:false} for both
  // "couldn't reach the relay" and "relay said sent:false" alike -- fine for
  // a builder script that must never throw, wrong for a readiness check that
  // needs to tell those two failures apart and report each distinctly.
  try {
    const response = await fetchImpl(RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'julia.journey0.coordinator_readiness_check',
        attempted: 'readiness-check',
        reason: 'manual readiness probe',
        context: 'check-readiness.mjs',
      }),
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      checks.push(check('relay reachable and accepted the event', false, `relay responded HTTP ${response.status}`));
    } else if (body.sent !== true) {
      checks.push(check(
        'relay reachable and accepted the event',
        false,
        'relay responded HTTP 200 but sent:false -- request reached the relay but Axiom delivery failed (check AXIOM_DATASET/AXIOM_TOKEN on the runner)',
      ));
    } else {
      checks.push(check('relay reachable and accepted the event', true, 'relay responded and reported sent:true (delivered to Axiom)'));
    }
  } catch (error) {
    checks.push(check('relay reachable and accepted the event', false, `relay request failed: ${error.message}`));
  }

  return { ok: checks.every((c) => c.ok), checks };
}

async function main() {
  const aiStackDir = process.argv.includes('--ai-stack-dir')
    ? process.argv[process.argv.indexOf('--ai-stack-dir') + 1]
    : null;
  if (!aiStackDir) {
    console.error('READY: false');
    console.error('  [ ] --ai-stack-dir is required (path to a toddwyder/AI-Stack checkout)');
    process.exitCode = 1;
    return;
  }
  const { defineProjectConfig } = await import(pathToFileURL(resolve(aiStackDir, 'orchestrator/lib/project-config.mjs')).href);
  let config = null;
  try {
    const mod = await import(pathToFileURL(resolve('graph/julia-next.project.mjs')).href);
    config = defineProjectConfig(mod.default);
  } catch (error) {
    console.error(`config failed to load: ${error.message}`);
  }

  const { ok, checks } = await checkReadiness({ config: config ?? {} });
  for (const c of checks) console.log(`  [${c.ok ? 'x' : ' '}] ${c.name}: ${c.detail}`);
  console.log(`READY: ${ok}`);
  process.exitCode = ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
