import { spawnSync } from 'node:child_process';

const [executable, ...args] = process.argv.slice(2);
if (!executable) {
  console.error('Julia vault command executable is required');
  process.exitCode = 1;
} else {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('OP_') && name !== 'JULIA_VAULT_WINDOWS_HELPER'));
  const result = spawnSync(executable, args, { stdio: 'inherit', env: environment, shell: false, windowsHide: true });
  if (result.error) {
    console.error('Julia vault command could not start');
    process.exitCode = 1;
  } else process.exitCode = result.status ?? 1;
}
