// Where the Mastra Code program lives, asked once for every script that loads its packages.
//
// Mastra Code is installed from npm like any other command (`npm install -g mastracode`),
// and its own update check replaces that copy in place. `npm root -g` names the directory
// that install writes to, so the program found there is the one the update check maintains.
// `MASTRACODE_PROGRAM_DIR` or `MASTRACODE_PROGRAM` still win, for a checkout that is not the
// global one.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

let root;

export function globalNodeModules() {
  if (root === undefined) {
    try {
      root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      root = '';
    }
  }
  return root;
}

// `~/.local` is where this server's npm prefix points, so it is the stock location here even
// when npm cannot be called (a service whose PATH leaves it out).
export function programCandidates(env = process.env) {
  const home = env.HOME || homedir();
  const names = [env.MASTRACODE_PROGRAM_DIR, env.MASTRACODE_PROGRAM].filter(Boolean);
  const roots = [globalNodeModules(), join(home, '.local', 'lib', 'node_modules'), '/usr/local/lib/node_modules', '/usr/lib/node_modules'];
  return [...names, ...roots.filter(Boolean).map(dir => join(dir, 'mastracode'))];
}

function isProgram(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name === 'mastracode';
  } catch {
    return false;
  }
}

export function programDir(env = process.env) {
  const found = programCandidates(env).find(isProgram);
  if (!found) {
    throw new Error(`No installed mastracode program was found in ${programCandidates(env).join(' or ')}. Run npm install -g mastracode, or set MASTRACODE_PROGRAM_DIR to the directory that holds its node_modules.`);
  }
  return found;
}

export function codeSdkPath(env = process.env) {
  const relative = join('node_modules', '@mastra', 'code-sdk', 'dist', 'index.js');
  const found = programCandidates(env).map(dir => join(dir, relative)).find(existsSync);
  if (!found) {
    throw new Error(`The Mastra Code SDK was not found in ${programCandidates(env).join(' or ')}. Run npm install -g mastracode, or set MASTRACODE_PROGRAM_DIR to the directory that holds its node_modules.`);
  }
  return found;
}
