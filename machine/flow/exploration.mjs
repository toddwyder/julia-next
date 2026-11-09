import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

export const SHELL_INSPECTION_LIMIT = 'Inspects literal commands, including quoted nested shell text; does not resolve aliases, variables, encoded programs or arbitrary shell indirection.';
const NUDGE = 'Use graphify query for codebase questions; narrow the query or increase --budget until the answer is complete.';
const SEARCH = new Set(['grep', 'rg', 'egrep', 'fgrep', 'find', 'fd', 'fdfind', 'ls']);
const READ = new Set(['cat', 'head', 'tail', 'sed', 'awk']);
const SHELL = new Set(['execute_command', 'mastra_workspace_execute_command']);
const TOOLS = new Map([
  ['mastra_workspace_grep', 'search'], ['mastra_workspace_list_files', 'search'],
  ['mastra_workspace_read_file', 'read'],
]);

function words(command) {
  return (command.match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s;&|()<>`]+|[\n;&|()<>`]/g) ?? [])
    .map(word => /^['"]/.test(word) ? word.slice(1, -1).replace(/\\(["\\])/g, '$1') : word);
}

function inspectShell(command, depth = 0) {
  const result = { queries: 0, graphOnly: true, readOnly: true, search: false, read: false, paths: [], unsupported: false };
  const tokensWithRedirects = words(command);
  let redirecting = false;
  const commandTokens = tokensWithRedirects.filter(token => {
    if (token === '>' || token === '<') {
      if (token === '>') result.readOnly = false;
      redirecting = true;
      return false;
    }
    if (redirecting) { redirecting = false; return false; }
    return true;
  });
  const segments = [[]];
  for (const token of commandTokens) {
    if (/^[\n;&|()`]$/.test(token)) segments.push([]);
    else segments.at(-1).push(token);
  }
  for (const tokens of segments) {
    const unwrap = (remaining, nesting = 0) => {
      if (!remaining.length) return [];
      if (nesting > 12) { result.unsupported = true; return []; }
      const [first, ...rest] = remaining;
      if (/^[\w]+=/.test(first)) return unwrap(rest, nesting + 1);
      if (basename(first) === 'env') {
        const skip = (items) => {
          if (!items.length) return [];
          if (items[0] === '--') return items.slice(1);
          if (['-u', '--unset', '-C', '--chdir', '-S', '--split-string'].includes(items[0])) {
            if (['-S', '--split-string'].includes(items[0])) {
              result.unsupported = true; return [];
            }
            return skip(items.slice(2));
          }
          return items[0].startsWith('-') || /^[\w]+=/.test(items[0]) ? skip(items.slice(1)) : items;
        };
        return unwrap(skip(rest), nesting + 1);
      }
      if (['sudo', 'command', 'exec', 'timeout', 'nice'].includes(basename(first))) {
        const launcher = basename(first);
        const operandOptions = {
          sudo: ['-u', '--user', '-g', '--group', '-h', '--host', '-p', '--prompt', '-C', '--close-from', '-T', '--command-timeout'],
          exec: ['-a'], timeout: ['-s', '--signal', '-k', '--kill-after'], nice: ['-n', '--adjustment'], command: [],
        };
        const skipOptions = items => {
          if (!items.length) return [];
          if (items[0] === '--') return items.slice(1);
          if (operandOptions[launcher].includes(items[0])) return skipOptions(items.slice(2));
          return items[0].startsWith('-') ? skipOptions(items.slice(1)) : items;
        };
        let remainingArgs = skipOptions(rest);
        if (launcher === 'timeout') remainingArgs = remainingArgs.slice(1);
        return unwrap(remainingArgs, nesting + 1);
      }
      return remaining;
    };
    const args = unwrap(tokens);
    if (!args.length) continue;
    const executable = basename(args[0]);
    if (executable === 'graphify') {
      if (args[1] === 'query') result.queries += 1;
      continue;
    }
    if (executable === 'cd') continue;
    let graphOnly = false;
    let readOnly = READ.has(executable) && !(executable === 'sed' && args.some(arg => /^-.*i/.test(arg)));
    result.search ||= SEARCH.has(executable) || (executable === 'git' && args.includes('grep'));
    result.read ||= READ.has(executable) && !(executable === 'sed' && args.some(arg => /^-.*i/.test(arg)));
    if (READ.has(executable)) result.paths.push(...args.slice(1).filter(arg => !arg.startsWith('-')));
    result.search ||= args.some(arg => /[*?]|\[[^\]]+\]/.test(arg))
      && ['echo', 'printf', 'ls'].includes(executable);
    if (['sh', 'bash', 'zsh', 'dash', 'python', 'python3', 'node'].includes(executable)) {
      if (depth >= 4) { result.unsupported = true; continue; }
      const index = args.findIndex(arg => /^-.*[ce]/.test(arg));
      if (index >= 0 && args[index + 1]) {
        const nested = inspectShell(args[index + 1], depth + 1);
        result.unsupported ||= nested.unsupported;
        result.queries += nested.queries;
        result.search ||= nested.search;
        result.read ||= nested.read;
        result.paths.push(...nested.paths);
        graphOnly = nested.graphOnly;
        readOnly = nested.readOnly;
        if (['python', 'python3', 'node'].includes(executable)) {
          for (const literal of args[index + 1].matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g)) {
            const embedded = inspectShell(literal[0].slice(1, -1), depth + 1);
            result.unsupported ||= embedded.unsupported;
            result.search ||= embedded.search;
            result.read ||= embedded.read;
            result.paths.push(...embedded.paths);
          }
          graphOnly = false;
          readOnly = false;
        }
      }
    }
    result.graphOnly &&= graphOnly;
    result.readOnly &&= readOnly;
  }
  return result;
}

function usableGraph(path) {
  try {
    const graph = JSON.parse(readFileSync(path, 'utf8'));
    const ids = Array.isArray(graph.nodes) ? graph.nodes.map(node => node?.id) : [];
    const knownIds = new Set(ids);
    return ids.length > 0 && ids.every(id => typeof id === 'string' && id.length > 0)
      && knownIds.size === ids.length
      && Array.isArray(graph.links)
      && graph.links.every(link => link && knownIds.has(link.source) && knownIds.has(link.target));
  } catch {
    return false;
  }
}

function textOutput(output) {
  if (typeof output === 'string') return output;
  if (!output || typeof output !== 'object') return '';
  if (Array.isArray(output)) return output.map(textOutput).join('\n');
  return ['stdout', 'stderr', 'text', 'output', 'content'].map(key => textOutput(output[key])).join('\n');
}

// Stock hooks: @mastra/core/dist/docs/references/docs-agents-tools.md:400-419.
// Workspace shell/grep/read/list outputs are strings; refusals preserve that contract.
export function createExplorationGate({ root = process.cwd(), graphPath = 'graphify-out/graph.json', onNudge = () => {}, onUpdate = () => {} } = {}) {
  const graph = resolve(root, graphPath);
  const counters = {
    graphQueries: 0, graphRetries: 0, refusedCalls: 0, allowedSearches: 0,
    allowedReads: 0, truncatedAnswers: 0, resolutions: 0,
  };
  let firstRefused = false;
  let answered = false;
  let awaitingAnswer = false;
  let truncated = false;
  const answerFiles = new Set();
  const nudges = [];
  const truncations = [];
  const snapshot = () => ({ ...counters, awaitingAnswer, truncated, answered, nudges: [...nudges], truncations: truncations.map(item => ({ ...item })), shellInspectionLimit: SHELL_INSPECTION_LIMIT });
  const update = () => onUpdate(snapshot());

  function describe({ toolName, workspaceToolName, input = {} }) {
    const name = workspaceToolName ?? toolName;
    if (SHELL.has(name)) return inspectShell(input.command ?? '');
    if (/^(julia|mastra)_query_graph$/.test(name)) {
      return { queries: 1, graphOnly: true, search: false, read: false, paths: [] };
    }
    const kind = TOOLS.get(name);
    return { queries: 0, graphOnly: false, search: kind === 'search', read: kind === 'read', paths: [input.path].filter(Boolean) };
  }

  function graphRead(call, action) {
    return action.read && action.readOnly !== false && action.paths.length > 0 && action.paths.every(path => {
      const absolute = resolve(call.input?.cwd ?? root, path);
      return absolute === graph || answerFiles.has(absolute)
        || absolute.startsWith(resolve(root, 'graphify-out') + '/');
    });
  }

  function refuse(reason) {
    counters.refusedCalls += 1;
    update();
    return { proceed: false, output: `${reason} ${NUDGE}` };
  }

  function beforeToolCall(call) {
    const action = describe(call);
    if (usableGraph(graph) && action.unsupported) return refuse('Shell nesting or launcher syntax exceeds literal inspection. Submit a direct command.');
    if (awaitingAnswer && !(action.graphOnly && action.queries > 0) && !graphRead(call, action)) {
      return refuse('The graph answer is incomplete or still pending. Other actions are blocked.');
    }
    if (!usableGraph(graph)) return;
    if (action.queries > 0 && !action.search && !action.read) {
      if (!action.graphOnly) return refuse('Run graph queries separately before other actions.');
      counters.graphQueries += action.queries;
      if (awaitingAnswer) counters.graphRetries += action.queries;
      awaitingAnswer = true;
      const redirect = call.input?.command?.match(/>\s*([^\s;&|]+)/);
      if (redirect) answerFiles.add(resolve(call.input?.cwd ?? root, redirect[1].replace(/^['"]|['"]$/g, '')));
      update();
      return;
    }
    if ((!action.search && !action.read) || graphRead(call, action)) return;
    if (!answered && !firstRefused) {
      firstRefused = true;
      return refuse('First raw exploration in this session refused.');
    }
    if (action.search) counters.allowedSearches += 1;
    if (action.read) counters.allowedReads += 1;
    nudges.push(NUDGE);
    onNudge(NUDGE);
    update();
  }

  function afterToolCall(call) {
    const action = describe(call);
    if (!(action.queries > 0 || graphRead(call, action))) return;
    const text = textOutput(call.output);
    // Graphify serve.py:1382 announces partial answers. Complete-over-budget is not partial.
    if (/\[!\]\s*TRUNCATED:|output truncated|\[showing (?:last|first) \d+ of \d+ lines\]|\btruncated\s*[:=]\s*true/i.test(text)
      || call.output?.truncated === true) {
      counters.truncatedAnswers += 1;
      truncations.push({ id: counters.truncatedAnswers, query: call.input?.command ?? call.input?.path ?? call.toolName, resolved: false });
      truncated = true;
      awaitingAnswer = true;
      update();
      return;
    }
    if (call.error || call.output?.isError || call.output?.error || (call.output?.exitCode !== undefined && call.output.exitCode !== 0)
      || /(?:^|\n)Exit code:\s*(?!0(?:\s|$))-?\d+/.test(text) || !/^Graph:.*\bnodes?\b/m.test(text)) return;
    if (truncated) counters.resolutions += 1;
    for (const item of truncations) {
      if (!item.resolved) {
        item.resolved = true;
        item.resolvedBy = call.input?.command ?? call.input?.path ?? call.toolName;
        item.remedy = /--budget/.test(item.resolvedBy) ? 'budget-or-narrower-query' : 'complete-answer';
      }
    }
    answered = true;
    awaitingAnswer = false;
    truncated = false;
    update();
  }

  return {
    hooks: { beforeToolCall, afterToolCall },
    snapshot,
  };
}
