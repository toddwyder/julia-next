import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { createTool } from '@mastra/core/tools';
import { resolveModelConfig } from '@mastra/core/llm';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { LibSQLStore } from '@mastra/libsql';
import { MastraStorageExporter, Observability, SensitiveDataFilter } from '@mastra/observability';
import { z } from 'zod/v4';
import { execFile } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { checkQuotes } from './quote-check.mjs';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const spikeRoot = resolve(here, '..');
// The spike lives at <repository>/ops/mastra-reviewer-spike.
const repoRoot = resolve(spikeRoot, '..', '..');
const tracePath = resolve(spikeRoot, 'traces', 'mastra-reviewer-spike.db');
const outputPath = resolve(spikeRoot, 'artifacts', 'run-282.json');
const head = process.env.PR_HEAD ?? '8a0d87cbc9c56458c367a2cd2b6bae4083c48722';
const criteria = [
  'When browser verification fails, CI retains test output, test exit code, report, trace, and screenshot as an artifact.',
  'The web job and aggregate checks fail when browser verification fails.',
  'The existing web job, artifact upload, and aggregate checks are used; no runner or Factory change is introduced.'
];
const Evidence = z.object({ source: z.string().regex(/^(diff|file:[^\\/][^\n]*)$/), quote: z.string().min(1), reasoning: z.string().min(1) });
const Review = z.object({ verdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']), criteria: z.array(z.object({ criterion: z.string(), status: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']), evidence: z.array(Evidence).min(1) })).length(criteria.length) });

async function gh(args) { return (await exec('gh', args, { cwd: repoRoot, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })).stdout; }
function safePath(path) { if (!path || path.includes('..') || path.startsWith('/') || path.startsWith('\\')) throw new Error('unsafe repository path'); return path; }
const tools = {
  list_pr_files: createTool({ id: 'list_pr_files', description: 'List files changed in pull request 282 only. Read-only.', inputSchema: z.object({}), execute: async () => JSON.parse(await gh(['pr', 'view', '282', '--json', 'files'])).files.map(file => file.path) }),
  show_pr_diff: createTool({ id: 'show_pr_diff', description: 'Show the diff for pull request 282 at its supplied head commit. Read-only.', inputSchema: z.object({}), execute: async () => (await exec('git', ['diff', `${head}^`, head, '--'], { cwd: repoRoot, windowsHide: true })).stdout }),
  read_file_at_commit: createTool({ id: 'read_file_at_commit', description: 'Read one repository file at the supplied PR head commit. Read-only.', inputSchema: z.object({ path: z.string().min(1) }), execute: async ({ path }) => (await exec('git', ['show', `${head}:${safePath(path)}`], { cwd: repoRoot, windowsHide: true })).stdout })
};

function checkedFetch(input, init) {
  if (init?.body) {
    const body = JSON.parse(String(init.body));
    for (const forbidden of ['max_tokens', 'max_completion_tokens', 'max_output_tokens']) if (forbidden in body) throw new Error(`forbidden request field emitted: ${forbidden}`);
  }
  return fetch(input, init);
}
async function runMode(mode) {
  const apiKey = process.env.COMMANDCODE_API_KEY;
  if (!apiKey || apiKey.startsWith('op://')) throw new Error('CommandCode credential was not resolved by the 1Password launcher');
  const connection = createOpenAICompatible({
    name: 'commandcode', apiKey, baseURL: 'https://api.commandcode.ai/provider/v1', supportsStructuredOutputs: true,
    fetch: checkedFetch,
    transformRequestBody: body => {
      delete body.max_tokens; delete body.max_completion_tokens; delete body.max_output_tokens;
      return body;
    }
  });
  // Resolve the custom OpenAI-compatible model through Mastra's standard resolver.
  const model = await resolveModelConfig(connection.chatModel('deepseek/deepseek-v4.1-flash'));
  const storage = new LibSQLStore({ id: 'mastra-reviewer-spike', url: `file:${tracePath.replace(/\\/g, '/')}` });
  const mastra = new Mastra({ storage, observability: new Observability({ sensitiveDataFilter: false, configs: { local: { serviceName: 'mastra-reviewer-spike', exporters: [new MastraStorageExporter()], spanOutputProcessors: [new SensitiveDataFilter({ redactionStyle: 'full', sensitiveFields: ['apiKey', 'authorization', 'token', 'COMMANDCODE_API_KEY'] })] } } }) });
  const reviewer = new Agent({ id: 'pr-282-reviewer', name: 'PR 282 read-only reviewer', model, tools, mastra, instructions: `Review only PR #282 at commit ${head}. You have exactly three read-only tools. Do not assume files not read. Acceptance criteria:\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\nEvery evidence quote must be exact text from a named changed file or from the diff. Use source 'file:path' or 'diff'.` });
  const result = await reviewer.generate('Review the PR against every acceptance criterion. Use tools before deciding.', { structuredOutput: { schema: Review, ...(mode === 'jsonPromptInjection' ? { jsonPromptInjection: true } : {}), ...(mode === 'structuringModel' ? { model } : {}) } });
  return { report: result.object, providerModel: result.response?.modelId ?? result.response?.model ?? null, responseId: result.response?.id ?? result.response?.responseId ?? null };
}

async function main() {
  await mkdir(dirname(tracePath), { recursive: true }); await mkdir(dirname(outputPath), { recursive: true });
  const modes = ['native', 'jsonPromptInjection', 'structuringModel']; let result; const failures = [];
  for (const mode of modes) { try { result = { mode, ...(await runMode(mode)) }; break; } catch (error) { failures.push({ mode, error: error.message }); } }
  if (!result) throw new Error(`no tools-plus-schema mode worked: ${JSON.stringify(failures)}`);
  const quotes = await checkQuotes(repoRoot, head, result.report);
  const trace = await stat(tracePath).catch(() => ({ size: 0 }));
  await writeFile(outputPath, JSON.stringify({ pr: 282, head, mode: result.mode, ...result, quoteChecks: quotes, allQuotesPass: quotes.every(check => check.ok), traceBytes: trace.size, failures }, null, 2));
  console.log(JSON.stringify({ mode: result.mode, verdict: result.report.verdict, allQuotesPass: quotes.every(check => check.ok), providerModel: result.providerModel, responseId: result.responseId, traceBytes: trace.size }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
