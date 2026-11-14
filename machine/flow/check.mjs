import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

import { buildSpans } from './trace.mjs';

const COMMAND_TOOLS = new Set(['mastra_workspace_execute_command', 'execute_command', 'bash', 'shell', 'run_command']);
const TASK_TOOLS = new Set(['task_write', 'task_update', 'task_complete']);
const MEDIA_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.webm', '.mp4', '.svg']);
const TEXT_EXT = new Set(['.json', '.txt', '.log', '.md', '.tsv', '.csv', '.html']);
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was',
  'one', 'our', 'out', 'has', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see',
  'two', 'way', 'who', 'did', 'get', 'let', 'put', 'say', 'she', 'too', 'use', 'run',
  'that', 'this', 'with', 'from', 'into', 'your', 'have', 'when', 'then', 'only',
  'each', 'must', 'should', 'runs', 'show', 'shows', 'check', 'proof', 'verify',
  'save', 'saved', 'file', 'files', 'output', 'command', 'evidence',
  'after', 'before', 'open', 'page', 'site', 'text', 'like', 'such', 'also',
  'will', 'would', 'could', 'there', 'their', 'them', 'than', 'they', 'what',
  'where', 'which', 'while', 'about', 'above', 'below', 'between', 'under', 'again',
  'here', 'same', 'both', 'more', 'most', 'other', 'some', 'very', 'just', 'being',
  'been', 'does', 'doing', 'done', 'make', 'made', 'still', 'even', 'ever', 'never',
  'every', 'many', 'much', 'well', 'back', 'look', 'looks', 'seem', 'seems',
]);

const normalizePath = value => String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '').trim();

const toolName = span => String(span.attributes?.toolId ?? span.name ?? '').replace(/^tool:\s*'?|'?$/gi, '').trim();

const isFlowBuild = span => /flow-build/i.test(`${span?.name ?? ''} ${span?.attributes?.agentId ?? ''}`);

const isMemory = span => /memory|observational/i.test(`${span?.name ?? ''} ${span?.attributes?.agentId ?? ''}`);

const isHelperAgent = span => Boolean(span && span.spanType === 'agent_run' && !isFlowBuild(span) && !isMemory(span));

const isCommandOrBrowser = span => {
  if (span.spanType !== 'tool_call') return false;
  const name = toolName(span).toLowerCase();
  return COMMAND_TOOLS.has(name) || /screenshot|browser|playwright|control-ui|control-cli/.test(name);
};

const owningAgentRun = (byId, span) => {
  const walk = (cursor, seen) => {
    if (!cursor || seen.has(cursor.spanId)) return null;
    if (cursor.spanType === 'agent_run') return cursor;
    return cursor.parentSpanId ? walk(byId.get(cursor.parentSpanId), new Set([...seen, cursor.spanId])) : null;
  };
  return walk(span, new Set());
};

const matchesFile = (written, target) =>
  written === target || written.endsWith(`/${target}`) || target.endsWith(`/${written}`) || target.startsWith(`${written}/`);

const taskText = item => String(item?.content ?? '').trim();

const applyTaskEvent = (tasks, span, index) => {
  const name = toolName(span);
  const input = span.input ?? {};
  if (name === 'task_write') {
    const raw = Array.isArray(input.tasks) ? input.tasks : [];
    return raw.filter(item => taskText(item)).map((item, pos) => {
      const id = String(item.id ?? pos + 1);
      const status = String(item.status ?? 'pending');
      const prev = tasks.find(t => t.id === id);
      return {
        id,
        content: taskText(item),
        status,
        completedAtIndex: status === 'completed' ? (prev?.completedAtIndex ?? index) : null,
      };
    });
  }
  const targetId = String(input.id ?? '');
  const nextStatus = name === 'task_complete' ? 'completed' : String(input.status ?? '');
  return tasks.map(task => {
    if (task.id !== targetId) return task;
    const status = nextStatus || task.status;
    return {
      ...task,
      content: taskText(input) || task.content,
      status,
      completedAtIndex: status === 'completed' ? (task.completedAtIndex ?? index) : null,
    };
  });
};

const checkTaskWork = (task, prior) => {
  const text = task.content;
  const needsSkill = /\bskill\b|\b(how|architect|arena|interrogate|deslop|no-comments|unslop|technical-writing|opening a pr)\b/i.test(text);
  const needsHelper = /delegate|handover|hand off|helper|subagent|poteto-agent|arena|swarm|architect|interrogate/i.test(text);
  const needsProof = /\b(proof|prove|verify|verification|test|matching surface)\b/i.test(text);

  if (needsSkill) {
    const hasSkill = prior.some(s => {
      if (s.spanType !== 'tool_call') return false;
      const name = toolName(s).toLowerCase();
      if (name === 'skill' || name.startsWith('skill_')) return true;
      return /read|view|file|command|bash|shell/.test(name) && /\.agents\/skills\/|SKILL\.md/i.test(JSON.stringify(s.input ?? ''));
    });
    if (!hasSkill) return `task list: "${text}" ticked without skill read`;
  }
  if (needsHelper) {
    const hasHelper = prior.some(s => isHelperAgent(s) || (s.spanType === 'tool_call' && /^agent[-_]/i.test(toolName(s))));
    if (!hasHelper) return `task list: "${text}" ticked without helper run`;
  }
  if (needsProof) {
    const hasProof = prior.some(isCommandOrBrowser);
    if (!hasProof) return `task list: "${text}" ticked without command or browser verification`;
  }
  return null;
};

const checkTaskList = (spans, byId) => {
  const tasks = spans.reduce((acc, span, index) => {
    if (span.spanType !== 'tool_call' || !TASK_TOOLS.has(toolName(span))) return acc;
    const owner = owningAgentRun(byId, span);
    if (owner && !isFlowBuild(owner)) return acc;
    return applyTaskEvent(acc, span, index);
  }, []);
  if (tasks.length === 0) return ['task list: no tasks recorded'];
  return tasks.flatMap(task => {
    if (/\bskip\s*:\s*\S/i.test(task.content)) return [];
    if (task.status !== 'completed') return [`task list: "${task.content}" is ${task.status}`];
    const failure = checkTaskWork(task, spans.slice(0, task.completedAtIndex));
    return failure ? [failure] : [];
  });
};

const isValidEvidence = file => {
  const ext = extname(String(file?.path ?? '')).toLowerCase();
  if (MEDIA_EXT.has(ext)) return Number(file.size ?? 0) > 0;
  if (TEXT_EXT.has(ext)) {
    const trimmed = String(file.content ?? '').trim();
    return trimmed.length > 0 && !/^(pass|ok|true|\[x\])$/i.test(trimmed);
  }
  return false;
};

const proofKeywords = text =>
  [...new Set((String(text).toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter(w => !STOP_WORDS.has(w)))];

const checkEvidence = (spans, cardDescription, evidenceFiles) => {
  const proofs = proofsFromCard(cardDescription);
  if (proofs.length === 0) return [];
  if (!spans.some(isCommandOrBrowser)) {
    return [`evidence: no command or browser verification ran for ${proofs.join(', ')}`];
  }
  const valid = evidenceFiles.filter(isValidEvidence);
  if (valid.length === 0) {
    return proofs.map(proof => `evidence: "${proof}" has no valid saved evidence`);
  }
  return proofs.flatMap(proof => {
    const keywords = proofKeywords(proof);
    if (keywords.length === 0) return [];
    const matched = valid.some(file => {
      const pathTokens = new Set(String(file.path ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? []);
      const contentTokens = new Set(String(file.content ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? []);
      const allTokens = new Set([...pathTokens, ...contentTokens]);
      const hits = keywords.filter(kw => allTokens.has(kw)).length;
      if (MEDIA_EXT.has(extname(String(file.path ?? '')).toLowerCase())) return hits >= 1;
      return pathTokens.size > 0 && keywords.some(kw => pathTokens.has(kw))
        ? hits >= 1
        : hits >= Math.min(2, keywords.length);
    });
    return matched ? [] : [`evidence: "${proof}" has no matching saved evidence`];
  });
};

export function proofsFromCard(description) {
  const text = String(description ?? '');
  const heading = /^#{1,6}[ \t]*(?:proof|uat[ \t]+steps)[ \t]*$/im.exec(text);
  if (!heading) return [];
  const after = text.slice(heading.index + heading[0].length);
  const next = /^#{1,6}[ \t]+\S/m.exec(after);
  const section = next ? after.slice(0, next.index) : after;
  const lines = section.split(/\r?\n/);
  const bullets = lines
    .map(line => line.match(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?(.+)$/))
    .filter(Boolean)
    .map(m => m[1].trim())
    .filter(Boolean);
  if (bullets.length > 0) return bullets;
  return lines.map(line => line.trim()).filter(Boolean);
}

export function evaluateBuildCheck({ spans = [], cardDescription = '', evidenceFiles = [] }) {
  const byId = new Map(spans.map(s => [s.spanId, s]));
  const reasons = [
    ...checkTaskList(spans, byId),
    ...checkEvidence(spans, cardDescription, evidenceFiles),
  ];
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons, reason: reasons.join('; ') };
}

const collectEvidenceFrom = root => {
  if (!root || !existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => {
      const full = join(entry.parentPath ?? entry.path ?? root, entry.name);
      const ext = extname(entry.name).toLowerCase();
      if (!MEDIA_EXT.has(ext) && !TEXT_EXT.has(ext)) return null;
      const size = statSync(full).size;
      const content = TEXT_EXT.has(ext) ? readFileSync(full, 'utf8').slice(0, 65_536) : '';
      return { path: normalizePath(full), size, content };
    })
    .filter(Boolean);
};

const gitChangedFiles = (copy, base) => {
  if (!copy || !existsSync(copy)) return [];
  const diff = base
    ? execFileSync('git', ['diff', '--name-only', `${base}..HEAD`], { cwd: copy, encoding: 'utf8' }).split(/\r?\n/)
    : [];
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: copy, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => line.slice(3).split(' -> ').at(-1));
  return [...new Set([...diff, ...status].map(normalizePath).filter(Boolean))];
};

export const realCheck = {
  async run({ mastra, traceId, traceFile, card, copy, base, cardDir, review }) {
    const spans = await buildSpans({ mastra, traceId, traceFile });
    const changedFiles = gitChangedFiles(copy, base);
    const cardDescription = (await review?.readCard?.(card))?.description ?? '';
    const dirs = [
      ...(cardDir ? [join(cardDir, 'evidence'), join(cardDir, 'proof'), join(cardDir, 'reports')] : []),
      ...(copy ? [join(copy, '.artifacts')] : []),
    ];
    const docEvidence = copy
      ? collectEvidenceFrom(join(copy, 'docs/agents')).filter(f => changedFiles.some(cf => matchesFile(cf, f.path)))
      : [];
    const evidenceFiles = [...dirs.flatMap(collectEvidenceFrom), ...docEvidence];
    return evaluateBuildCheck({ spans, cardDescription, evidenceFiles });
  },
};
