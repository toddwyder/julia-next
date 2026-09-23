// Bad fixture importing file write functions directly instead of framework state
import { writeFile } from 'node:fs';
import { appendFile } from 'fs/promises';

export async function writeProgress() {
  writeFile('progress.json', '{}', () => {});
  await appendFile('progress.log', 'done\n');
}
