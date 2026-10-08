// Read-only native session provenance for the opt-in builder proof. No calls,
// launches or decisions: the interruption test owns its existing runner seam.
import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const toolOutputText = output => typeof output === 'string' ? output : Array.isArray(output)
  ? output.filter(block => block && ['text', 'input_text'].includes(block.type) && typeof block.text === 'string').map(block => block.text).join('\n')
  : '';

export async function nativeBuilderEvidence(proof, { root = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions') } = {}) {
  const paths = [];
  const walk = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) paths.push(path);
    }
  };
  try { await walk(root); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const evidence = [];
  for (const path of paths) {
    const lines = (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean);
    let first; try { first = JSON.parse(lines[0]); } catch { continue; }
    const meta = first.type === 'session_meta' ? first.payload : null;
    if (!meta?.cwd || resolve(meta.cwd).toLowerCase() !== resolve(proof.worktree).toLowerCase()) continue;
    const records = lines.flatMap((line, index) => {
      try { return [JSON.parse(line)]; }
      catch (cause) {
        if (index === lines.length - 1) return []; // the active writer can leave its final record incomplete
        throw new Error(`corrupt native session evidence in ${path} at line ${index + 1}`, { cause });
      }
    });
    const turns = records.filter(event => event.type === 'turn_context').map(event => event.payload);
    const calls = records.filter(event => event.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(event.payload?.type)).map(event => event.payload);
    const responses = records.filter(event => event.type === 'response_item' && ['function_call_output', 'custom_tool_call_output'].includes(event.payload?.type)).map(event => event.payload);
    const read = (file, expected) => calls.find(call => {
      const args = String(call.arguments ?? call.input).replaceAll('\\\\', '/').replaceAll('\\', '/');
      const output = toolOutputText(responses.find(response => response.call_id === call.call_id)?.output);
      return args.includes(file) && output.includes(expected);
    });
    const skillRead = read('.claude/skills/implement/SKILL.md', 'Implement the work described by the user') ?? read('.agents/skills/implement/SKILL.md', 'Implement the work described by the user');
    const approvedRead = read('JUL-196-approved.json', proof.marker);
    evidence.push({ path, thread: meta.id, provider: meta.model_provider, models: [...new Set(turns.map(turn => turn.model))], efforts: [...new Set(turns.map(turn => turn.reasoning_effort ?? turn.effort))],
      canonicalSavedRead: Boolean(skillRead && approvedRead), readCallIds: [skillRead?.call_id, approvedRead?.call_id].filter(Boolean),
      noLinearCalls: !calls.some(call => /linear-cli|LINEAR_API_KEY|mcp[^\s]*linear/i.test(`${call.name} ${call.arguments ?? call.input}`)),
    });
  }
  return evidence;
}
