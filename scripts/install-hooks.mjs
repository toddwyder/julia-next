#!/usr/bin/env node
// Installs the global Mastra Code hook that pings Todd from a session started outside this
// repository. Without it a stop in a chat opened from the home directory posts nothing.
// Safe to re-run: it replaces its own entry and keeps every other global hook.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_DIR = resolve(here, '..');

export function globalHooksPath(home = homedir()) {
  return join(home, '.mastracode', 'hooks.json');
}

export function globalStopPing(repoDir = REPO_DIR) {
  return {
    type: 'command',
    command: `node ${join(repoDir, 'scripts', 'julia-agents.mjs')} -- node ${join(repoDir, 'scripts', 'stop-ping.mjs')} --global`,
    timeout: 30000,
    description: 'Julia stop ping for sessions started outside the repository',
  };
}

// Keep the other global hooks; replace only the stop-ping one.
export function withGlobalStopPing(existing, repoDir = REPO_DIR) {
  const config = {};
  for (const [event, hooks] of Object.entries(existing ?? {})) {
    const rest = Array.isArray(hooks) ? hooks.filter(hook => !String(hook?.command ?? '').includes('stop-ping.mjs')) : [];
    if (rest.length) config[event] = rest;
  }
  config.Notification = [...(config.Notification ?? []), globalStopPing(repoDir)];
  return config;
}

export function installGlobalHooks({ home = homedir(), repoDir = REPO_DIR } = {}) {
  const file = globalHooksPath(home);
  const existing = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const config = withGlobalStopPing(existing, repoDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  return { file, config };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { file } = installGlobalHooks();
  console.log(`global hooks written to ${file}`);
}
