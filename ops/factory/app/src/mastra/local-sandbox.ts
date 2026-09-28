import { LocalSandbox } from '@mastra/core/workspace';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function createLocalFactorySandbox(sessionId: string, env: NodeJS.ProcessEnv): LocalSandbox {
  const sandbox = new LocalSandbox({
    workingDirectory: join(
      process.env.MASTRACODE_LOCAL_SANDBOX_ROOT?.trim() || join(homedir(), '.mastracode', 'web', 'sandboxes'),
      sessionId,
    ),
    env,
    isolation: 'bwrap',
    nativeSandbox: { allowNetwork: true },
  });
  console.info('Factory local sandbox: isolation=bwrap network=on');
  return sandbox;
}
