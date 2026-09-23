// Bad fixture importing file write and timer functions directly instead of framework state
import { writeFile } from 'node:fs';
import { appendFile } from 'fs/promises';
import { setTimeout } from 'node:timers/promises';
import { setInterval } from 'timers';

export async function writeProgress() {
  writeFile('progress.json', '{}', () => {});
  await appendFile('progress.log', 'done\n');
  await setTimeout(100);
  setInterval(() => {}, 100);
}
