#!/usr/bin/env node
// Checks formal/flow/TwoWriters.tla with TLC, the TLA+ model checker.
//
// Three configurations run on every invocation. The shipped one must pass. Each
// broken one models a specific regression of the two-writers rule and must fail
// the invariant it guards, so a passing run also proves the checks can fail.
//
// Exit codes: 0 = the model matches the design, 1 = a check disagreed or the
// tool is missing.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modelDir = join(root, 'formal', 'flow');
const toolsDir = join(root, 'formal', '.tools');

const TLA_VERSION = '1.8.0';
const TLA_URL = `https://github.com/tlaplus/tlaplus/releases/download/v${TLA_VERSION}/tla2tools.jar`;
const TLA_SHA256 = '7e53aa636dac8a3cb0533f343115c0548e03fc0ce5edc7739becf58d3d0fb84f';
const TLA_JAR = join(toolsDir, `tla2tools-${TLA_VERSION}.jar`);

const CHECKS = [
  { config: 'shipped.cfg', expect: 'pass', says: 'the design in machine/flow/start.mjs keeps the two-writers rule' },
  { config: 'open-tracedb-while-studio-runs.cfg', expect: 'SingleWriter', says: 'opening trace.duckdb while Studio runs collides on the lock' },
  { config: 'sidecar-trace-file.cfg', expect: 'NoSidecar', says: 'opening trace-resume-<pid>.duckdb creates orphan sidecars' },
];

const TLC_INVARIANT_VIOLATED = 12;

async function checker() {
  await mkdir(toolsDir, { recursive: true });
  try {
    const jars = await readFile(TLA_JAR);
    if (createHash('sha256').update(jars).digest('hex') === TLA_SHA256) return TLA_JAR;
  } catch {
    // Not downloaded yet.
  }
  process.stdout.write(`Downloading TLA+ tools ${TLA_VERSION} once into formal/.tools/\n`);
  const response = await fetch(TLA_URL);
  if (!response.ok) throw new Error(`${TLA_URL} answered ${response.status}.`);
  const jar = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(jar).digest('hex');
  if (digest !== TLA_SHA256) throw new Error(`${TLA_URL} gave sha256 ${digest}, wanted ${TLA_SHA256}.`);
  await writeFile(TLA_JAR, jar);
  return TLA_JAR;
}

function run(jar, config) {
  const args = ['-cp', jar, 'tlc2.TLC', '-cleanup', '-config', config, 'TwoWriters.tla'];
  return new Promise((settle, fail) => {
    const child = spawn('java', args, { cwd: modelDir });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => fail(new Error(error.code === 'ENOENT'
      ? 'java is missing. Install a JDK (openjdk-21-jre-headless) and run this again.'
      : error.message)));
    child.on('close', code => settle({ code, output }));
  });
}

function verdict({ code, output }, expect) {
  if (expect === 'pass') {
    if (code === 0) return null;
    const violated = output.match(/Invariant (\w+) is violated/);
    return violated ? `${violated[1]} is violated by the design` : `TLC exited ${code}\n${output}`;
  }
  if (code !== TLC_INVARIANT_VIOLATED) return `TLC exited ${code}, so the check did not catch the break`;
  if (!output.includes(`Invariant ${expect} is violated`)) return `caught a break, but not ${expect}`;
  return null;
}

async function main() {
  const jar = await checker();
  let failed = false;
  for (const check of CHECKS) {
    const result = await run(jar, check.config);
    const problem = verdict(result, check.expect);
    const mark = problem ? 'FAIL' : 'ok';
    const detail = problem ?? (check.expect === 'pass'
      ? 'all invariants hold in every reachable state'
      : `${check.expect} catches it`);
    process.stdout.write(`${mark.padEnd(4)} ${check.config.padEnd(38)} ${check.says}: ${detail}\n`);
    if (problem) failed = true;
  }
  if (failed) {
    process.stdout.write('\nSee formal/flow/TwoWriters.tla. Each failing run prints its shortest path there.\n');
    process.exitCode = 1;
  }
}

await main();
