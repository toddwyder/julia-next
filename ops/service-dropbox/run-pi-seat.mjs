// run-pi-seat.mjs -- launches Pi for a backup seat (builder-on-DeepSeek,
// reviewer/orchestrator-on-GLM) with the seat's secret injected into the
// child process's environment only -- never as an argv entry, never
// interpolated into a shell string. See read-secret.mjs for why: JUL-72's
// incident was exactly a secret reaching a shell/argv position.
import { spawn } from 'node:child_process';
import { readSecret } from './read-secret.mjs';

export const SEATS = {
  'builder-backup': {
    envVar: 'DEEPSEEK_API_KEY',
    secretField: 'deepseek',
    piArgs: (prompt, mode) => ['--provider', 'deepseek', '--model', 'deepseek-v4-flash', '-p', prompt, '--mode', mode],
  },
  'reviewer-backup': {
    envVar: 'ZAI_PAYG_API_KEY',
    secretField: 'zai',
    piArgs: (prompt, mode) => ['--provider', 'glm-5-3', '--model', 'glm-5.3', '-p', prompt, '--mode', mode],
  },
  'orchestrator-backup': {
    envVar: 'ZAI_PAYG_API_KEY',
    secretField: 'zai',
    piArgs: (prompt, mode) => ['--provider', 'glm-5-3', '--model', 'glm-5.3', '-p', prompt, '--mode', mode],
  },
};

export function buildPiSpawnSpec(seat, prompt, { mode = 'json', readSecretImpl = readSecret } = {}) {
  const def = SEATS[seat];
  if (!def) {
    throw new Error(`buildPiSpawnSpec: unknown seat '${seat}' -- must be one of ${Object.keys(SEATS).join('|')}`);
  }
  return {
    command: 'pi',
    args: def.piArgs(prompt, mode),
    env: { ...process.env, [def.envVar]: readSecretImpl(def.secretField) },
  };
}

export function runPiSeat(seat, prompt, opts = {}) {
  const spec = buildPiSpawnSpec(seat, prompt, opts);
  return spawn(spec.command, spec.args, { env: spec.env, ...(opts.spawnOpts || {}) });
}
