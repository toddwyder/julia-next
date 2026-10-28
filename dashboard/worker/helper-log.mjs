import { appendFileSync, existsSync } from 'node:fs';
let input = '';
for await (const chunk of process.stdin) input += chunk;
if (!existsSync(process.env.DASHBOARD_PROGRAM_STOP)) {
  const event = JSON.parse(input);
  appendFileSync(process.env.DASHBOARD_HELPER_LOG, JSON.stringify({ at: new Date().toISOString(), type: event.hook_event_name, toolCallId: event.tool_call_id, agentType: event.agent_type, model: event.model_id }) + '\n', { mode: 0o600 });
}
console.log('{"decision":"allow"}');
