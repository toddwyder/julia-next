import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvePlaybook } from './playbook.mjs';

const TASK_STATE_TYPE = 'task';
const SKIP_PATTERN = /\b(?:skip|n\/a)\s*:\s*\S/i;

const matchesPlaybookStep = (taskContent, step) => {
  const text = String(taskContent ?? '').trim();
  if (text === step) return true;
  if (!text.startsWith(step)) return false;
  return /^skip\s*:\s*\S/i.test(text.slice(step.length).trim());
};

export function evaluateBuildCheck({ tasks = [], steps = [], playbook = '' } = {}) {
  if (!playbook || !Array.isArray(steps) || steps.length === 0) {
    return { ok: false, reasons: ['playbook: no playbook chosen'], reason: 'playbook: no playbook chosen' };
  }
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { ok: false, reasons: ['task list: no tasks recorded'], reason: 'task list: no tasks recorded' };
  }

  const reasons = [];
  for (const [index, step] of steps.entries()) {
    const task = tasks.find(t => t?.id === `playbook_${index + 1}`)
      ?? tasks.find(t => matchesPlaybookStep(t?.content, step));
    if (!task) {
      reasons.push(`playbook: missing step "${step}"`);
      continue;
    }
    const content = String(task.content ?? '').trim();
    if (SKIP_PATTERN.test(content)) continue;
    if (task.status !== 'completed') {
      reasons.push(`task list: "${content}" is ${task.status ?? 'pending'}`);
    }
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons, reason: reasons.join('; ') };
}

const selfScript = () => {
  const fromRoot = resolve(process.env.MASTRA_PROJECT_ROOT ?? process.cwd(), 'machine/flow/check.mjs');
  return existsSync(fromRoot) ? fromRoot : fileURLToPath(import.meta.url);
};

const crashCause = (error, stderr) => {
  const text = String(stderr ?? '');
  if (/heap out of memory|allocation failed/i.test(text)) return 'JavaScript heap out of memory';
  const lastLine = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1);
  if (lastLine) return lastLine;
  if (error?.signal) return `process killed by ${error.signal}`;
  return String(error?.message ?? error ?? 'unknown check failure');
};

const runCheckInChild = (payload) =>
  new Promise((resolvePromise) => {
    const child = execFile(
      process.execPath,
      [selfScript(), '--eval'],
      { maxBuffer: 50 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          resolvePromise({ ok: false, fatal: true, reason: crashCause(error, stderr) });
          return;
        }
        try {
          resolvePromise(JSON.parse(stdout));
        } catch (parseError) {
          resolvePromise({ ok: false, fatal: true, reason: `invalid check output: ${parseError.message}` });
        }
      },
    );
    child.stdin.end(JSON.stringify(payload));
  });

export const realCheck = {
  async run({ mastra, threadId, playbook, repo }) {
    const entry = playbook ? resolvePlaybook(repo, playbook) : null;
    const store = await mastra?.getStorage?.()?.getStore?.('threadState');
    const tasks = store && threadId ? await store.getState({ threadId, type: TASK_STATE_TYPE }) : [];
    return runCheckInChild({
      tasks: Array.isArray(tasks) ? tasks : [],
      steps: entry?.steps ?? [],
      playbook: entry?.slug ?? String(playbook ?? ''),
    });
  },
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--eval')) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  process.stdout.write(`${JSON.stringify(evaluateBuildCheck(payload))}\n`);
}
