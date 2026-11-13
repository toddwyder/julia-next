import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const reference = readFileSync(resolve(root, 'scripts/julia-agents.env'), 'utf8').split('\n').find(line => line.startsWith('CMD_API_KEY='))?.slice('CMD_API_KEY='.length);
if (!reference?.startsWith('op://') || !process.argv[2]) throw Error('CommandCode secret reference and command required');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OP_') && !key.startsWith('LINEAR_')));
env.OP_SERVICE_ACCOUNT_TOKEN = readFileSync('/home/ubuntu/.config/julia-agents/service-account-token', 'utf8').trim();
env.OP_CACHE = 'false';
env.CMD_API_KEY = reference;
const result = spawnSync('op', ['run', '--', ...process.argv.slice(2)], {env, stdio:'inherit'});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
