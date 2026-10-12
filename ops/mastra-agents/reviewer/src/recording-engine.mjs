import { createTool } from '@mastra/core/tools';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod/v4';
import { durableWrite } from './run-file.mjs';

const toolError = problems => ({
  error: true,
  message: Array.isArray(problems) ? problems.join('\n') : String(problems),
});

export { durableWrite } from './run-file.mjs';

const fileForKey = (directory, key) => join(directory, `${createHash('sha256').update(key).digest('hex')}.json`);

function schemaProblems(error) {
  return error.issues.map(issue => {
    const location = issue.path.length ? `${issue.path.join('.')}: ` : '';
    return `${location}${issue.message}`;
  });
}

export async function createRecordingEngine({
  runDirectory,
  pieceSchema,
  reportSchema,
  keyOf,
  requiredKeys,
  checks = [],
  assemble,
  validate = async () => [],
  submit,
  onAccepted = async () => {},
  onProgress = async () => {},
  onComplete = async () => {},
}) {
  if (!runDirectory || !pieceSchema || !reportSchema || typeof keyOf !== 'function' || typeof assemble !== 'function' || typeof submit !== 'function') {
    throw new Error('recording engine needs a run folder, schemas, key function, assembler, and submitter');
  }
  const piecesDirectory = join(runDirectory, 'pieces');
  await mkdir(piecesDirectory, { recursive: true });
  const pieces = new Map();
  for (const file of await readdir(piecesDirectory)) {
    if (!file.endsWith('.json')) continue;
    const stored = JSON.parse(await readFile(join(piecesDirectory, file), 'utf8'));
    const parsed = pieceSchema.parse(stored.piece);
    if (stored.key !== keyOf(parsed)) throw new Error(`recorded piece key mismatch in ${file}`);
    pieces.set(stored.key, parsed);
  }

  const required = () => typeof requiredKeys === 'function' ? requiredKeys(pieces) : requiredKeys;
  const missing = () => required().filter(key => !pieces.has(key));
  const accepted = () => [...pieces.keys()].sort();
  let mutation = Promise.resolve();
  const serialize = operation => {
    const result = mutation.then(operation, operation);
    mutation = result.catch(() => {});
    return result;
  };

  async function checkedPiece(input) {
    const parsed = pieceSchema.safeParse(input);
    if (!parsed.success) return { failure: toolError(schemaProblems(parsed.error)) };
    const key = keyOf(parsed.data);
    if (typeof key !== 'string' || !key) return { failure: toolError('Piece key must be a nonempty string') };
    const problems = [];
    for (const check of checks) problems.push(...await check(parsed.data, new Map(pieces)) ?? []);
    if (problems.length) return { failure: toolError(problems) };
    return { key, piece: parsed.data };
  }

  async function store(input, replace) {
    const checked = await checkedPiece(input);
    if (checked.failure) return checked.failure;
    const exists = pieces.has(checked.key);
    if (exists !== replace) {
      return toolError(exists
        ? `Piece ${checked.key} already exists. Use replace_piece to change it.`
        : `Piece ${checked.key} does not exist. Use record_piece to add it.`);
    }
    await durableWrite(fileForKey(piecesDirectory, checked.key), `${JSON.stringify({ key: checked.key, piece: checked.piece })}\n`);
    pieces.set(checked.key, checked.piece);
    await onAccepted(checked.piece, checked.key, accepted());
    await onProgress(accepted());
    return { accepted: true, key: checked.key, ...(replace ? { replaced: true } : {}) };
  }

  const tools = {
    record_piece: createTool({
      id: 'record_piece',
      description: 'Validate and durably record one small report piece. Use replace_piece for an existing key.',
      inputSchema: pieceSchema,
      execute: input => serialize(() => store(input, false)),
    }),
    replace_piece: createTool({
      id: 'replace_piece',
      description: 'Validate and durably replace one previously recorded report piece.',
      inputSchema: pieceSchema,
      execute: input => serialize(() => store(input, true)),
    }),
    remove_piece: createTool({
      id: 'remove_piece',
      description: 'Remove one recorded report piece by the key returned when it was accepted.',
      inputSchema: z.object({ key: z.string().min(1) }),
      execute: ({ key }) => serialize(async () => {
        if (!pieces.has(key)) return toolError(`Piece ${key} does not exist.`);
        await rm(fileForKey(piecesDirectory, key), { force: true });
        pieces.delete(key);
        await onProgress(accepted());
        return { accepted: true, key, removed: true };
      }),
    }),
    show_missing: createTool({
      id: 'show_missing',
      description: 'List required report pieces that are still missing and keys already accepted.',
      inputSchema: z.object({}),
      execute: () => serialize(async () => ({ missing: missing(), accepted: accepted() })),
    }),
    submit_report: createTool({
      id: 'submit_report',
      description: 'Assemble, validate, and submit the report only after every required piece is recorded.',
      inputSchema: z.object({}),
      execute: (_input, context) => serialize(async () => {
        const absent = missing();
        if (absent.length) return toolError(`Report is incomplete. Missing: ${absent.join(', ')}`);
        let candidate;
        try { candidate = await assemble(new Map(pieces)); }
        catch (error) { return toolError(`Report assembly failed: ${error?.message ?? String(error)}`); }
        const parsed = reportSchema.safeParse(candidate);
        if (!parsed.success) return toolError(['Report schema validation failed:', ...schemaProblems(parsed.error)]);
        const problems = await validate(parsed.data, new Map(pieces));
        if (problems.length) return toolError(['Report completeness validation failed:', ...problems]);
        const result = await submit(parsed.data, context);
        if (result?.accepted === true) await onComplete();
        return result;
      }),
    }),
  };

  return {
    tools,
    acceptedKeys: accepted,
    missingKeys: missing,
    recordTechnicalFailure: async (path, reason, details = {}) => {
      const failure = { kind: 'technical-failure', reason, acceptedPieces: accepted(), ...details };
      await durableWrite(path, `${JSON.stringify(failure)}\n`);
      return failure;
    },
  };
}
