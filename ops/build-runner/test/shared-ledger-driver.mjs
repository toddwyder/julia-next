import { readFile } from 'node:fs/promises';
import { openRunner } from '../adapter.mjs';

const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
const runner = await openRunner(input);
try {
  await fetch(input.endpoint, { method: 'POST', body: JSON.stringify({ model: 'fixture', messages: [{ role: 'user', content: 'hello' }] }) });
  console.log(JSON.stringify(runner.snapshot()));
} catch (error) {
  console.log(JSON.stringify({ error: error.message, account: runner.snapshot() }));
} finally {
  await runner.close();
}
