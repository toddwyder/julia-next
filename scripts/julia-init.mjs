// The local `$init` selection wrapper.  It only selects and records the two
// model jobs; JUL-196 owns real worker startup and handoff.
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { validateDeliveryToolSettings } from './delivery-tool-settings.mjs';

const ROLE_FLAGS = Object.freeze({ '--builder': 'builder', '--reviewer': 'reviewer' });
const ISSUE_ID = /^[A-Z][A-Z0-9]*-\d+$/;

export class SelectionRequiredError extends Error {
  constructor(roles, selections) {
    super(`$init needs a current ${roles.join(' and ')} selection`);
    this.name = 'SelectionRequiredError';
    this.roles = roles;
    this.selections = selections;
  }
}

function reject(message) {
  throw new Error(`$init: ${message}`);
}

function refusalReason(error) {
  if (error instanceof SelectionRequiredError) return 'missing-or-stale-selection';
  if (error.message.startsWith('$init:')) return 'invalid-command';
  if (/model reference .* is unknown|catalog reference .* is ambiguous|thinking .* is not supported|does not support thinking|must use different makers/.test(error.message)) {
    return 'invalid-selection';
  }
  return 'invalid-settings';
}

function tokenize(command) {
  if (typeof command !== 'string') reject('command must be text');
  const tokens = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(command))) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  if (tokens.join(' ') === '' || /(^|\s)["'](?:\s|$)/.test(command)) reject('contains an empty quoted value');
  return tokens;
}

export function parseInitCommand(command) {
  const tokens = tokenize(command);
  if (tokens[0] !== '$init') reject('must begin with the literal $init command, not /init');
  if (!ISSUE_ID.test(tokens[1] ?? '')) reject('must name an issue such as JUL-195');
  const choices = {};
  for (let index = 2; index < tokens.length;) {
    const role = ROLE_FLAGS[tokens[index]];
    if (!role) reject(`does not recognise ${JSON.stringify(tokens[index])}; use --builder or --reviewer`);
    if (choices[role]) reject(`names --${role} more than once`);
    const [model, thinking] = tokens.slice(index + 1, index + 3);
    if (!model || thinking === undefined) reject(`--${role} requires an exact model name or ID followed by a thinking level`);
    choices[role] = { model, thinking: thinking === 'none' ? null : thinking };
    index += 3;
  }
  return { issueId: tokens[1], choices };
}

async function readJson(path, { read = readFile, absent = null } = {}) {
  try {
    return JSON.parse(await read(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return absent;
    reject(`could not read ${path}`);
  }
}

async function writeJson(path, value, { mkdirImpl = mkdir, write = writeFile, renameImpl = rename } = {}) {
  await mkdirImpl(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await write(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await renameImpl(temporary, path);
}

async function recordEvent(path, event, { mkdirImpl = mkdir, append = appendFile } = {}) {
  await mkdirImpl(dirname(path), { recursive: true });
  await append(path, `${JSON.stringify(event)}\n`);
}

function snapshot(resolved) {
  return Object.fromEntries(['builder', 'reviewer'].map((role) => {
    const { model, thinking } = resolved[role];
    return [role, {
      identity: model.id,
      model: model.executableModelId,
      maker: model.maker,
      harness: model.harness,
      thinking,
      connection: { ...model.connection },
    }];
  }));
}

function isStaleChoice(choice, catalog) {
  if (!choice || typeof choice !== 'object' || typeof choice.model !== 'string') return true;
  const matches = catalog.filter((entry) => entry.id === choice.model || entry.displayName === choice.model);
  if (matches.length !== 1) return true;
  const [model] = matches;
  if (model.thinking.supported === false) return choice.thinking !== null;
  return !model.thinking.supported.includes(choice.thinking);
}

function resolveSelections(settings, defaults, explicit) {
  const selected = {
    builder: explicit.builder ?? (defaults === null ? settings.builder : defaults?.builder),
    reviewer: explicit.reviewer ?? (defaults === null ? settings.reviewer : defaults?.reviewer),
  };
  try {
    return { selected, resolved: validateDeliveryToolSettings({ catalog: settings.catalog, ...selected }) };
  } catch (error) {
    const missing = ['builder', 'reviewer'].filter((role) => !explicit[role] && isStaleChoice(selected[role], settings.catalog));
    if (missing.length) throw new SelectionRequiredError(missing, selected);
    throw error;
  }
}

// `dispatch` is intentionally injected. Tests use a fake; JUL-196 will be
// the only caller that supplies real startup/handoff behaviour.
export async function runInit(command, {
  settingsPath = new URL('../delivery-tools.json', import.meta.url),
  stateDirectory = '.julia/runs',
  dispatch = async () => {},
  logger = () => {},
  read = readFile,
  ...writers
} = {}) {
  const eventsPath = join(stateDirectory, 'events.jsonl');
  let parsed;
  try {
    parsed = parseInitCommand(command);
  } catch (error) {
    const event = { event: 'selection-refused', issueId: null, reason: refusalReason(error) };
    await recordEvent(eventsPath, event, writers);
    logger(event);
    throw error;
  }
  const { issueId, choices } = parsed;
  const runPath = join(stateDirectory, `${issueId}.json`);
  const saved = await readJson(runPath, { read });
  if (saved) {
    if (Object.keys(choices).length) reject(`run ${issueId} already has a saved configuration; resume without role flags`);
    const event = { event: 'resume', issueId, builder: saved.configuration.builder.identity, reviewer: saved.configuration.reviewer.identity };
    await recordEvent(eventsPath, event, writers);
    logger(event);
    await dispatch(saved.configuration);
    return { issueId, configuration: saved.configuration, resumed: true };
  }

  const settings = await readJson(settingsPath, { read });
  const defaultsPath = join(stateDirectory, 'defaults.json');
  const defaults = await readJson(defaultsPath, { read });
  let selected;
  let resolved;
  try {
    ({ selected, resolved } = resolveSelections(settings, defaults, choices));
  } catch (error) {
    const event = { event: 'selection-refused', issueId, reason: refusalReason(error), roles: error.roles ?? [] };
    await recordEvent(eventsPath, event, writers);
    logger(event);
    throw error;
  }

  const configuration = snapshot(resolved);
  // Both files are written only after the pair is valid. Dispatch comes last,
  // so an invalid pair can neither mutate defaults nor partially start work.
  await writeJson(defaultsPath, selected, writers);
  await writeJson(runPath, { issueId, configuration }, writers);
  const event = { event: 'selection-saved', issueId, builder: configuration.builder.identity, reviewer: configuration.reviewer.identity };
  await recordEvent(eventsPath, event, writers);
  logger(event);
  await dispatch(configuration);
  return { issueId, configuration, resumed: false };
}

export async function runInitCli(command, { ask, ...options } = {}) {
  try {
    return await runInit(command, options);
  } catch (error) {
    if (!(error instanceof SelectionRequiredError) || !ask) throw error;
    let amended = command;
    for (const role of error.roles) {
      const answer = await ask(role);
      if (!String(answer).trim()) reject(`--${role} requires an exact model name or ID followed by a thinking level`);
      amended += ` --${role} ${answer}`;
    }
    return runInit(amended, options);
  }
}

// This diagnostic entry point deliberately supplies no real dispatcher. It
// makes the selection/run-file behaviour testable on a Windows laptop; JUL-196
// will provide real startup and handoff after consuming the saved snapshot.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const prompts = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const result = await runInitCli(process.argv.slice(2).join(' '), {
      logger: (event) => console.error(JSON.stringify(event)),
      ask: (role) => prompts.question(`$init needs ${role}; enter its exact model name or ID and thinking level: `),
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    prompts.close();
  }
}
