import { appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const WRITE_LIMIT_BYTES = 24000;
export function guardWrite(input) {
  const bytes = typeof input.tool_input?.content === 'string' ? Buffer.byteLength(input.tool_input.content, 'utf8') : 0;
  const blocked = /^(?:write_file|workspace_write_file)$/.test(input.tool_name) && bytes > WRITE_LIMIT_BYTES;
  return { decision: blocked ? 'block' : 'allow', ...(blocked ? { reason: 'write this in parts' } : {}), bytes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  const input = JSON.parse(text);
  const stop = process.env.DASHBOARD_PROGRAM_STOP;
  if (stop && existsSync(stop)) {
    process.stdout.write(JSON.stringify({ decision: 'block', reason: 'Program STOP is present' }));
    process.exitCode = 2;
  } else {
    const result = guardWrite(input);
    if (process.env.DASHBOARD_GUARD_LOG) appendFileSync(process.env.DASHBOARD_GUARD_LOG, JSON.stringify({ at: new Date().toISOString(), tool: input.tool_name, path: input.tool_input?.path, ...result }) + '\n', { mode: 0o600 });
    process.stdout.write(JSON.stringify(result));
    process.exitCode = result.decision === 'block' ? 2 : 0;
  }
}
