import { existsSync, statSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function runFrameworkLint(targetDir = 'graph/langgraph') {
  const resolvedTarget = resolve(process.cwd(), targetDir);

  if (!existsSync(resolvedTarget)) {
    console.log(`${targetDir} does not exist yet; passing.`);
    return { passed: true, skippedFolder: true, results: [], skips: [] };
  }

  const { ESLint } = await import('eslint');
  const { frameworkConfig } = await import('../eslint.config.mjs');

  const isDirectory = statSync(resolvedTarget).isDirectory();
  const patterns = isDirectory
    ? [join(targetDir, '**/*.{js,mjs,cjs,jsx,ts,tsx}')]
    : [targetDir];

  let eslint;
  if (targetDir === 'graph/langgraph' || targetDir.startsWith('graph/langgraph/')) {
    eslint = new ESLint();
  } else {
    // When running against fixture paths outside graph/langgraph, apply the framework config
    eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [
        {
          ...frameworkConfig,
          files: ['**/*'],
        },
      ],
    });
  }

  let results;
  try {
    results = await eslint.lintFiles(patterns);
  } catch (err) {
    if (err.messageTemplate === 'all-matched-files-ignored' || err.message?.includes('No files matching')) {
      console.log(`No files found in ${targetDir}; passing.`);
      return { passed: true, results: [], skips: [] };
    }
    throw err;
  }

  if (results.length === 0) {
    console.log(`No files found in ${targetDir}; passing.`);
    return { passed: true, results: [], skips: [] };
  }

  const formatter = await eslint.loadFormatter('stylish');
  const formattedText = formatter.format(results);
  if (formattedText.trim()) {
    console.log(formattedText);
  }

  const skips = [];
  for (const result of results) {
    for (const msg of result.suppressedMessages ?? []) {
      for (const sup of msg.suppressions ?? []) {
        skips.push({
          file: relative(process.cwd(), result.filePath),
          line: msg.line,
          column: msg.column,
          ruleId: msg.ruleId,
          reason: sup.justification ? sup.justification.trim() : '',
        });
      }
    }
  }

  if (skips.length > 0) {
    console.log(`Framework lint skips (${skips.length}) [JUL-115]:`);
    for (const s of skips) {
      console.log(`  - ${s.file}:${s.line} (${s.ruleId}): ${s.reason}`);
    }
  } else {
    console.log(`No framework lint skips found in ${targetDir}.`);
  }

  const errorCount = results.reduce((acc, r) => acc + r.errorCount, 0);
  const passed = errorCount === 0;

  return { passed, results, skips, errorCount };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const targetDir = process.argv[2] ?? 'graph/langgraph';
  try {
    const { passed } = await runFrameworkLint(targetDir);
    if (!passed) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Error running framework lint:', err);
    process.exit(1);
  }
}
